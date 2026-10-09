-- Study-first discovery; retain the old event catalog, history and cursor.
begin;
set local lock_timeout = '5s';
create table public.climate_study_lookups (
  source_version_id uuid primary key references public.evidence_source_versions(id),
  outcome text not null check (outcome in ('matched','no_match','not_eligible','incomplete')),
  event_ids text[] not null default '{}',
  query jsonb,
  error_code text,
  checked_at timestamptz not null default clock_timestamp(),
  check (case when outcome='matched' then cardinality(event_ids)>0 when outcome='incomplete' then true else cardinality(event_ids)=0 end)
);
create index climate_study_lookups_events on public.climate_study_lookups using gin(event_ids);

create function public.climate_study_control(action text, payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job public.climate_event_job_state; result jsonb; ids text[]; version_id uuid;
begin
  select * into strict job from public.climate_event_job_state where singleton for update;
  if job.lease_id is null or payload->>'leaseId' is null or job.lease_id is distinct from (payload->>'leaseId')::uuid
    or job.lease_until <= clock_timestamp() then raise exception 'catalog:lease lost'; end if;
  if action='next' then
    select coalesce(jsonb_agg(x.study),'[]'::jsonb) into result from (
      select jsonb_build_object('id',v.id,'sourceId',v.source_id,
        'source',v.metadata||jsonb_build_object('normalizedText',v.normalized_text,'normalizationProfile',v.normalization_profile)) study
      from public.evidence_sources s join public.evidence_source_versions v on v.id=s.current_version_id
      left join public.climate_study_lookups l on l.source_version_id=v.id
      where s.source_type='attribution_study' and v.normalized_text is not null
        and (l.checked_at is null or l.checked_at < clock_timestamp()-
          case when l.outcome='incomplete' then interval '1 hour' else interval '7 days' end)
      order by l.checked_at nulls first,
        (s.title ~* '\m(hurricane|typhoon|cyclone|storm)\M') desc,
        s.published_at desc nulls last,s.id limit 2
    ) x;
    return result;
  elsif action='record' then
    version_id := (payload->>'studyVersionId')::uuid;
    if not exists(select 1 from public.evidence_sources s where s.current_version_id=version_id and s.source_type='attribution_study')
      then raise exception 'catalog:changed study'; end if;
    if jsonb_typeof(payload->'eventIds') is distinct from 'array' or jsonb_array_length(payload->'eventIds')>200
      then raise exception 'catalog:invalid study events'; end if;
    select coalesce(array_agg(distinct value),'{}'::text[]) into ids from jsonb_array_elements_text(payload->'eventIds');
    if exists(select 1 from unnest(ids) id where not exists(select 1 from public.climate_event_catalog c where c.event_id=id))
      then raise exception 'catalog:unknown study event'; end if;
    insert into public.climate_study_lookups(source_version_id,outcome,event_ids,query,error_code)
      values(version_id,payload->>'outcome',ids,payload->'query',left(payload->>'errorCode',100))
      on conflict(source_version_id) do update set outcome=excluded.outcome,
        event_ids=case when excluded.outcome='incomplete' then climate_study_lookups.event_ids else excluded.event_ids end,
        query=excluded.query,error_code=excluded.error_code,checked_at=clock_timestamp();
    return 'null'::jsonb;
  elsif action='pending' then
    if payload->>'version' is null or payload->>'model' is null then raise exception 'catalog:policy required'; end if;
    select coalesce(jsonb_agg(x.event),'[]'::jsonb) into result from (
      select c.event from public.climate_event_catalog c
      where c.first_observed_at::date >= (current_date-interval '3 years')::date and c.first_observed_at::date <= current_date
        and exists(select 1 from public.climate_study_lookups l join public.evidence_sources s on s.current_version_id=l.source_version_id
          where l.outcome in ('matched','incomplete') and c.event_id=any(l.event_ids))
        and (c.state='pending' or c.attempted_fingerprint is distinct from c.event_fingerprint
          or c.attempted_version is distinct from payload->>'version' or c.attempted_model is distinct from payload->>'model')
      order by c.priority desc,c.attempted_at nulls first,c.last_observed_at desc,c.event_id limit 30
    ) x;
    return result;
  else raise exception 'catalog:unknown study action'; end if;
end $$;
alter table public.climate_study_lookups enable row level security;
revoke all on public.climate_study_lookups from public,anon,authenticated;
grant select,insert,update,delete on public.climate_study_lookups to service_role;
revoke all on function public.climate_study_control(text,jsonb) from public,anon,authenticated;
grant execute on function public.climate_study_control(text,jsonb) to service_role;
commit;
