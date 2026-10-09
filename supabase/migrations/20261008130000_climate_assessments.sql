-- Additive assessment history and immutable citations. Review before applying.
begin;
set local lock_timeout = '5s';

create table public.climate_assessments (
  id uuid primary key,
  event_id text not null check (length(event_id) between 3 and 240 and event_id ~ '^[a-z][a-z0-9-]*:.+$'),
  status text not null check (status in ('completed','insufficient_evidence')),
  human_influence text not null check (human_influence in ('none','low','medium','high')),
  evidence_strength text not null check (evidence_strength in ('none','low','medium','high')),
  summary text not null check (length(btrim(summary)) > 0),
  immediate_cause text, climate_connection text,
  assessment jsonb not null check (jsonb_typeof(assessment) = 'object'),
  model text not null check (length(btrim(model)) > 0),
  assessment_version text not null check (length(btrim(assessment_version)) > 0),
  event_fingerprint text not null check (event_fingerprint ~ '^[a-f0-9]{64}$'),
  corpus_fingerprint text not null check (corpus_fingerprint ~ '^[a-f0-9]{64}$'),
  assessed_at timestamptz not null,
  saved_at timestamptz not null default clock_timestamp(),
  check (status <> 'insufficient_evidence' or (human_influence = 'none' and evidence_strength = 'none'))
);
create index climate_assessments_latest_idx on public.climate_assessments(event_id, saved_at desc, id);
create table public.climate_assessment_failures (
  event_id text primary key check (length(event_id) between 3 and 240 and event_id ~ '^[a-z][a-z0-9-]*:.+$'),
  failed_at timestamptz not null default clock_timestamp()
);
create table public.climate_assessment_citations (
  assessment_id uuid not null references public.climate_assessments(id),
  claim_index integer not null check (claim_index between 0 and 7),
  chunk_id uuid not null references public.evidence_version_chunks(id),
  source_id uuid not null references public.evidence_sources(id),
  source_version_id uuid not null references public.evidence_source_versions(id),
  relation public.evidence_type not null,
  passage text not null check (length(btrim(passage)) > 0),
  primary key (assessment_id, claim_index, chunk_id)
);

create function public.climate_assessment_snapshot() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('generationId',s.active_generation_id,'maintenance',s.maintenance,
    'fingerprint',encode(sha256(convert_to(coalesce(s.active_generation_id::text,'none') || ':' ||
      coalesce((select string_agg(id::text || '=' || coalesce(current_version_id::text,'none'),',' order by id) from public.evidence_sources),''),'UTF8')),'hex'))
  from public.evidence_corpus_state s where s.singleton
$$;

create function public.climate_assessment_latest(event_id text) returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select case when a.id is null and f.failed_at is null then null else jsonb_build_object(
    'assessment',a.assessment,'stale',a.id is not null and a.corpus_fingerprint is distinct from public.climate_assessment_snapshot()->>'fingerprint',
    'generationFailed',f.failed_at is not null and (a.id is null or f.failed_at>a.saved_at)) end
  from (select 1) seed
  left join lateral (select * from public.climate_assessments a where a.event_id=climate_assessment_latest.event_id order by a.saved_at desc,a.id limit 1) a on true
  left join public.climate_assessment_failures f on f.event_id=climate_assessment_latest.event_id
$$;

create function public.climate_assessment_failed(event_id text) returns void
language sql security invoker set search_path=pg_catalog,public as $$
  insert into public.climate_assessment_failures(event_id) values(climate_assessment_failed.event_id)
  on conflict(event_id) do update set failed_at=clock_timestamp()
$$;

create function public.climate_assessment_save(payload jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare corpus public.evidence_corpus_state; claim jsonb; citation jsonb; i integer:=0; n integer;
  version public.evidence_source_versions; chunk public.evidence_version_chunks; existing jsonb;
begin
  select * into strict corpus from public.evidence_corpus_state where singleton for share;
  if corpus.maintenance or payload->>'corpusFingerprint' is distinct from public.climate_assessment_snapshot()->>'fingerprint'
    then raise exception 'assessment:conflict evidence corpus changed'; end if;
  if jsonb_typeof(payload->'claims') is distinct from 'array' or jsonb_array_length(payload->'claims') > 8
    or jsonb_typeof(payload->'uncertainties') is distinct from 'array' or jsonb_array_length(payload->'uncertainties')=0
    then raise exception 'assessment:validation invalid assessment collections'; end if;
  n:=jsonb_array_length(payload->'claims');
  if (payload->>'status'='completed' and n=0) or (payload->>'status'='insufficient_evidence' and n<>0)
    then raise exception 'assessment:validation inconsistent assessment status'; end if;
  if n>0 and exists(select 1 from jsonb_each_text(jsonb_build_object('summary',payload->>'summary','cause',payload->>'immediateCause','connection',payload->>'climateConnection')) x
    where x.value is not null and not exists(select 1 from jsonb_array_elements(payload->'claims') c where c->>'statement'=x.value))
    then raise exception 'assessment:validation unsupported narrative'; end if;
  select assessment into existing from public.climate_assessments where id=(payload->>'id')::uuid;
  if found then
    if existing is distinct from payload then raise exception 'assessment:conflict assessment replay differs'; end if;
    return;
  end if;
  insert into public.climate_assessments(id,event_id,status,human_influence,evidence_strength,summary,immediate_cause,climate_connection,
    assessment,model,assessment_version,event_fingerprint,corpus_fingerprint,assessed_at)
  values((payload->>'id')::uuid,payload->>'eventId',payload->>'status',payload->>'humanInfluence',payload->>'evidenceStrength',payload->>'summary',
    payload->>'immediateCause',payload->>'climateConnection',payload,payload->>'model',payload->>'assessmentVersion',
    payload->>'eventFingerprint',payload->>'corpusFingerprint',(payload->>'assessedAt')::timestamptz);
  for claim in select value from jsonb_array_elements(payload->'claims') loop
    if claim->>'type' not in ('direct_finding','supported_synthesis','general_mechanism')
      or claim->>'statement' is null or length(btrim(claim->>'statement'))=0
      or jsonb_typeof(claim->'citations') is distinct from 'array' or jsonb_array_length(claim->'citations') not between 1 and 8
      then raise exception 'assessment:validation invalid claim'; end if;
    for citation in select value from jsonb_array_elements(claim->'citations') loop
      select * into chunk from public.evidence_version_chunks where id=(citation->>'chunkId')::uuid;
      if not found or chunk.source_version_id is distinct from (citation->>'sourceVersionId')::uuid
        or citation->>'passage' is null or length(btrim(citation->>'passage'))=0 or strpos(chunk.content,citation->>'passage')=0
        then raise exception 'assessment:validation citation passage or version mismatch'; end if;
      select * into strict version from public.evidence_source_versions where id=chunk.source_version_id;
      if version.source_id is distinct from (citation->>'sourceId')::uuid
        or not exists(select 1 from public.evidence_sources s where s.id=version.source_id and s.current_version_id=version.id)
        then raise exception 'assessment:validation citation source mismatch or superseded version'; end if;
      insert into public.climate_assessment_citations(assessment_id,claim_index,chunk_id,source_id,source_version_id,relation,passage)
      values((payload->>'id')::uuid,i,chunk.id,version.source_id,version.id,(citation->>'relation')::public.evidence_type,citation->>'passage');
    end loop;
    i:=i+1;
  end loop;
end $$;

-- Protect history from modification, including through direct service table writes.
create trigger climate_assessments_immutable before update or delete on public.climate_assessments
for each row execute function public.evidence_immutable();
create trigger climate_assessment_citations_immutable before update or delete on public.climate_assessment_citations
for each row execute function public.evidence_immutable();
alter table public.climate_assessments enable row level security;
alter table public.climate_assessment_citations enable row level security;
alter table public.climate_assessment_failures enable row level security;
revoke all on public.climate_assessments,public.climate_assessment_citations from public,anon,authenticated;
revoke all on public.climate_assessment_failures from public,anon,authenticated;
grant select,insert,update on public.climate_assessment_failures to service_role;
grant select,insert on public.climate_assessments,public.climate_assessment_citations to service_role;
revoke update,delete on public.climate_assessments,public.climate_assessment_citations from service_role;
revoke all on function public.climate_assessment_snapshot(),public.climate_assessment_latest(text),public.climate_assessment_save(jsonb),public.climate_assessment_failed(text) from public,anon,authenticated;
grant execute on function public.climate_assessment_snapshot(),public.climate_assessment_latest(text),public.climate_assessment_save(jsonb),public.climate_assessment_failed(text) to service_role;
commit;
