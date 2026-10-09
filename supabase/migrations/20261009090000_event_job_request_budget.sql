-- Batch immutable citation reads and checkpoint discovery before model generation.
begin;
set local lock_timeout = '5s';
create function public.evidence_citations(chunk_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if chunk_ids is null or cardinality(chunk_ids)>100 then raise exception 'evidence:validation invalid citation batch'; end if;
  select coalesce(jsonb_agg(citation),'[]'::jsonb) into result from (
    select public.evidence_citation(id) as citation from (select distinct unnest(chunk_ids) as id) ids
  ) citations where citation is not null and citation <> 'null'::jsonb;
  return result;
end $$;
create function public.climate_event_checkpoint(payload jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare job public.climate_event_job_state;
begin
  select * into strict job from public.climate_event_job_state where singleton for update;
  if job.lease_id is null or payload->>'leaseId' is null or job.lease_id is distinct from (payload->>'leaseId')::uuid
    or job.lease_until <= clock_timestamp() then raise exception 'catalog:lease lost'; end if;
  if payload->>'historyEnd' is null then raise exception 'catalog:cursor required'; end if;
  update public.climate_event_job_state set history_end=(payload->>'historyEnd')::date,refreshed_at=clock_timestamp() where singleton;
end $$;
revoke all on function public.evidence_citations(uuid[]),public.climate_event_checkpoint(jsonb) from public,anon,authenticated;
grant execute on function public.evidence_citations(uuid[]),public.climate_event_checkpoint(jsonb) to service_role;
commit;
