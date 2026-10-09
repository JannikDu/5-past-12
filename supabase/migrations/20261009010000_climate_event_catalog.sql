-- Persistent event snapshots and a bounded cron cursor; no public database grants.
begin;
set local lock_timeout = '5s';
create table public.climate_event_catalog (
  event_id text primary key check (event_id ~ '^eonet:EONET_[A-Za-z0-9_-]+$'),
  event jsonb not null check (jsonb_typeof(event) = 'object' and event->>'id' = event_id),
  event_fingerprint text not null check (event_fingerprint ~ '^[a-f0-9]{64}$'),
  first_observed_at timestamptz not null, last_observed_at timestamptz not null,
  priority integer not null default 0 check (priority between 0 and 1),
  state text not null default 'pending' check (state in ('pending','completed','insufficient_evidence','failed')),
  attempted_fingerprint text, attempted_version text, attempted_model text,
  assessment_id uuid references public.climate_assessments(id), failure_code text,
  attempted_at timestamptz, updated_at timestamptz not null default clock_timestamp(),
  check (first_observed_at <= last_observed_at)
);
create index climate_event_catalog_pending on public.climate_event_catalog(state, priority desc, last_observed_at desc);
create table public.climate_event_job_state (
  singleton boolean primary key default true check (singleton),
  history_end date, refreshed_at timestamptz, lease_id uuid, lease_until timestamptz,
  last_run jsonb
);
insert into public.climate_event_job_state(singleton) values (true);

create function public.climate_event_control(action text, payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job public.climate_event_job_state; item jsonb; result jsonb; e public.climate_event_catalog;
  saved_assessment public.climate_assessments; requested_lease uuid; policy text := payload->>'version';
begin
  if action='acquire' then
    select * into strict job from public.climate_event_job_state where singleton for update;
    if job.lease_until > clock_timestamp() then return null; end if;
    requested_lease := (payload->>'leaseId')::uuid;
    update public.climate_event_job_state set lease_id=requested_lease, lease_until=clock_timestamp()+interval '15 minutes' where singleton;
    return jsonb_build_object('leaseId',requested_lease,'historyEnd',job.history_end);
  end if;
  if action in ('upsert','pending','begin','finish','release','reset') then
    select * into strict job from public.climate_event_job_state where singleton for update;
    if job.lease_id is null or payload->>'leaseId' is null or job.lease_id is distinct from (payload->>'leaseId')::uuid or job.lease_until <= clock_timestamp()
      then raise exception 'catalog:lease lost'; end if;
  end if;
  if action='upsert' then
    if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items')>200 then raise exception 'catalog:invalid items'; end if;
    for item in select value from jsonb_array_elements(payload->'items') loop
      if item->'event'->'provenance'->>'provider' is distinct from 'eonet' or item->'event'->'provenance'->>'dataKind' is distinct from 'Reported event'
        then raise exception 'catalog:reported events required'; end if;
      insert into public.climate_event_catalog(event_id,event,event_fingerprint,first_observed_at,last_observed_at,priority)
      values(item->'event'->>'id',item->'event',item->>'fingerprint',(item->'event'->'time'->>'firstObservedAt')::timestamptz,
        (item->'event'->'time'->>'lastObservedAt')::timestamptz,(item->>'priority')::integer)
      on conflict(event_id) do update set event=excluded.event,event_fingerprint=excluded.event_fingerprint,
        first_observed_at=excluded.first_observed_at,last_observed_at=excluded.last_observed_at,priority=excluded.priority,
        state=case when climate_event_catalog.event_fingerprint=excluded.event_fingerprint then climate_event_catalog.state else 'pending' end,
        updated_at=clock_timestamp();
    end loop;
    return 'null'::jsonb;
  elsif action='pending' then
    if policy is null or payload->>'model' is null then raise exception 'catalog:policy required'; end if;
    select coalesce(jsonb_agg(x.event),'[]') into result from (
      select event from public.climate_event_catalog where
        first_observed_at::date >= (current_date-interval '3 years')::date and first_observed_at::date <= current_date
        and (state='pending' or attempted_fingerprint is distinct from event_fingerprint or attempted_version is distinct from policy or attempted_model is distinct from payload->>'model')
      order by priority desc, attempted_at nulls first,last_observed_at desc,event_id limit 30
    ) x;
    return result;
  elsif action='begin' then
    update public.climate_event_catalog set state='failed',failure_code='interrupted',attempted_at=clock_timestamp(),
      attempted_fingerprint=event_fingerprint,attempted_version=policy,attempted_model=payload->>'model'
      where event_id=payload->>'eventId' and event_fingerprint=payload->>'fingerprint';
    if not found then raise exception 'catalog:changed event'; end if;
    return 'null'::jsonb;
  elsif action='finish' then
    if payload->>'assessmentId' is not null then
      select * into strict saved_assessment from public.climate_assessments where id=(payload->>'assessmentId')::uuid;
      if saved_assessment.event_id is distinct from payload->>'eventId' or saved_assessment.event_fingerprint is distinct from payload->>'fingerprint'
        or saved_assessment.assessment_version is distinct from policy or saved_assessment.model is distinct from payload->>'model' then raise exception 'catalog:assessment mismatch'; end if;
    end if;
    update public.climate_event_catalog set state=coalesce(saved_assessment.status,'failed'),assessment_id=coalesce(saved_assessment.id,assessment_id),
      failure_code=case when saved_assessment.id is null then left(payload->>'errorCode',100) else null end
      where event_id=payload->>'eventId' and event_fingerprint=payload->>'fingerprint';
    return 'null'::jsonb;
  elsif action='release' then
    update public.climate_event_job_state set lease_id=null,lease_until=null,
      history_end=case when payload ? 'historyEnd' then (payload->>'historyEnd')::date else history_end end,
      refreshed_at=case when (payload->>'refreshed')::boolean then clock_timestamp() else refreshed_at end,
      last_run=payload->'summary' where singleton;
    return 'null'::jsonb;
  elsif action='reset' then
    update public.climate_event_catalog set state='pending' where event_id=payload->>'eventId';
    return 'null'::jsonb;
  elsif action='feed' then
    with current_events as (
      select c.*, a.assessment, a.status as assessment_status,a.corpus_fingerprint from public.climate_event_catalog c
      left join lateral (select * from public.climate_assessments a where a.event_id=c.event_id
        and a.event_fingerprint=c.event_fingerprint and a.assessment_version=policy order by a.saved_at desc,a.id limit 1) a on true
      where first_observed_at::date >= (current_date-interval '3 years')::date and first_observed_at::date <= current_date
    ), connections as (
      select event,assessment,corpus_fingerprint is distinct from public.climate_assessment_snapshot()->>'fingerprint' as stale
      from current_events where assessment_status='completed' and jsonb_array_length(assessment->'claims')>0
      order by last_observed_at desc,event_id limit 200
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(connections)) from connections),'[]'),
      'updatedAt',(select refreshed_at from public.climate_event_job_state where singleton),
      'historyEnd',(select history_end from public.climate_event_job_state where singleton),
      'counts',jsonb_build_object('total',(select count(*) from current_events),
        'pending',(select count(*) from current_events where state='pending' or attempted_version is distinct from policy),
        'failed',(select count(*) from current_events where state='failed' and attempted_version=policy),
        'insufficient',(select count(*) from current_events where state='insufficient_evidence' and attempted_version=policy),
        'connections',(select count(*) from current_events where assessment_status='completed' and jsonb_array_length(assessment->'claims')>0))) into result;
    return result;
  else raise exception 'catalog:unknown action';
  end if;
end $$;
alter table public.climate_event_catalog enable row level security;
alter table public.climate_event_job_state enable row level security;
revoke all on public.climate_event_catalog,public.climate_event_job_state from public,anon,authenticated;
grant select,insert,update,delete on public.climate_event_catalog,public.climate_event_job_state to service_role;
revoke all on function public.climate_event_control(text,jsonb) from public,anon,authenticated;
grant execute on function public.climate_event_control(text,jsonb) to service_role;
commit;
