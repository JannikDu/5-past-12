-- Additive, service-only evidence pipeline. Apply manually after reviewing.
begin;
set local lock_timeout = '5s';
select set_config('search_path', format('pg_catalog, public, %I', n.nspname), true)
from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector';

create function public.evidence_valid_profile(profile jsonb) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
select coalesce(jsonb_typeof(profile)='object' and profile->'embedding'->>'dimensions'='1536'
  and length(profile->'embedding'->>'provider')>0 and length(profile->'embedding'->>'model')>0
  and length(profile->'embedding'->>'endpoint')>0 and length(profile->'embedding'->>'documentPolicy')>0
  and length(profile->'embedding'->>'queryPolicy')>0 and length(profile->'chunking'->>'version')>0
  and (profile->'chunking'->>'size')::integer between 1 and 10000
  and (profile->'chunking'->>'overlap')::integer>=0 and (profile->'chunking'->>'minSize')::integer>0
  and (profile->'chunking'->>'overlap')::integer+(profile->'chunking'->>'minSize')::integer<=(profile->'chunking'->>'size')::integer,false)
$$;
create table public.evidence_processing_generations (
  id uuid primary key default gen_random_uuid(),
  profile jsonb not null check (public.evidence_valid_profile(profile)),
  status text not null check (status in ('ready','staging','retired','aborted')),
  created_at timestamptz not null default now()
);
create table public.evidence_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.evidence_sources(id),
  metadata jsonb not null,
  normalized_text text,
  content_hash text,
  normalization_profile text,
  provider_id text,
  item_id text,
  legacy boolean not null default false,
  created_at timestamptz not null default now(),
  unique (source_id,content_hash),
  check (legacy or (normalized_text is not null and content_hash is not null and normalization_profile is not null and provider_id is not null and item_id is not null
    and length(btrim(normalized_text)) > 0 and content_hash ~ '^[a-f0-9]{64}$' and length(normalization_profile) > 0 and length(provider_id) > 0 and length(item_id) > 0))
);
create table public.evidence_version_chunks (
  id uuid primary key default gen_random_uuid(),
  source_version_id uuid not null references public.evidence_source_versions(id),
  generation_id uuid references public.evidence_processing_generations(id),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) > 0),
  embedding vector(1536),
  span_start integer, span_end integer,
  created_at timestamptz not null default now(),
  unique (source_version_id,generation_id,chunk_index),
  check (embedding is null or vector_norm(embedding) > 0),
  check ((span_start is null and span_end is null) or (span_start >= 0 and span_end > span_start))
);
create table public.evidence_corpus_state (
  singleton boolean primary key default true check (singleton),
  active_generation_id uuid references public.evidence_processing_generations(id),
  maintenance boolean not null default false,
  target_generation_id uuid references public.evidence_processing_generations(id),
  rebuild_owner uuid, rebuild_expires_at timestamptz,
  last_rebuild_owner uuid, last_rebuild_generation_id uuid, last_rebuild_outcome text,
  manifest uuid[] not null default '{}', completed uuid[] not null default '{}'
);
insert into public.evidence_corpus_state(singleton) values(true);
create table public.evidence_ingestion_state (
  provider_id text primary key check (length(provider_id) between 1 and 100),
  owner uuid, expires_at timestamptz,
  last_checkpoint_owner uuid,
  progress jsonb not null default '{"since":null,"state":{},"pending":[],"recheckAfter":null,"recheckCursor":null,"recheckThrough":null}'::jsonb
);
alter table public.evidence_sources
  add column current_version_id uuid references public.evidence_source_versions(id),
  add column generation_id uuid references public.evidence_processing_generations(id),
  add column content_hash text,
  add column ingestion_profile text,
  add column embedding_profile jsonb,
  add column source_updated_at timestamptz;
alter table public.evidence_chunks
  add column source_version_id uuid references public.evidence_source_versions(id),
  add column generation_id uuid references public.evidence_processing_generations(id),
  add column search_text tsvector generated always as (to_tsvector('english', content)) stored;
create index evidence_chunks_search_idx on public.evidence_chunks using gin(search_text);
create index evidence_versions_provider_item_idx on public.evidence_source_versions(provider_id,item_id);

-- Preserve existing citation IDs/known metadata, without claiming reconstructed
-- chunks are an original document or guessing an embedding profile.
insert into public.evidence_source_versions(source_id,metadata,legacy)
select id,jsonb_build_object('title',title,'publisher',publisher,'url',url,
  'evidenceType',evidence_type,'sourceType',source_type,'eventTypes',event_types,
  'region',region,'eventStart',event_start,'eventEnd',event_end,'publishedAt',published_at,'sourceUpdatedAt',null),true
from public.evidence_sources;
update public.evidence_sources s set current_version_id=v.id
from public.evidence_source_versions v where v.source_id=s.id and v.legacy;
insert into public.evidence_version_chunks(id,source_version_id,chunk_index,content,embedding,created_at)
select c.id,s.current_version_id,c.chunk_index,c.content,c.embedding,c.created_at
from public.evidence_chunks c join public.evidence_sources s on s.id=c.source_id;
update public.evidence_chunks c set source_version_id=s.current_version_id
from public.evidence_sources s where s.id=c.source_id;

create function public.evidence_immutable() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin raise exception 'evidence:contract immutable evidence record'; end $$;
create trigger evidence_versions_immutable before update or delete on public.evidence_source_versions
for each row execute function public.evidence_immutable();
create trigger evidence_journal_immutable before update or delete on public.evidence_version_chunks
for each row execute function public.evidence_immutable();

-- All transitions/writes/searches lock the singleton first. This also fences
-- operations that started before a maintenance transition.
create function public.evidence_retain_chunks(version_id uuid, generation_id uuid, chunks jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare v public.evidence_source_versions; g public.evidence_processing_generations;
  chunk jsonb; position integer:=0; vec public.evidence_version_chunks.embedding%type; a integer; b integer;
begin
  select * into strict v from public.evidence_source_versions where id=version_id;
  select * into strict g from public.evidence_processing_generations where id=generation_id;
  if v.normalized_text is null then raise exception 'evidence:legacy verified original text is required'; end if;
  if jsonb_typeof(chunks) is distinct from 'array' or jsonb_array_length(chunks) not between 1 and 10000 then raise exception 'evidence:validation invalid chunk array'; end if;
  for chunk in select value from jsonb_array_elements(chunks) loop
    if (chunk->>'chunkIndex')::integer is distinct from position or chunk->>'content' is null or length(btrim(chunk->>'content'))=0 then raise exception 'evidence:validation noncontiguous or empty chunks'; end if;
    if jsonb_typeof(chunk->'embedding') is distinct from 'array' or jsonb_array_length(chunk->'embedding')<>1536 then raise exception 'evidence:embedding expected 1536 values'; end if;
    if exists(select 1 from jsonb_array_elements(chunk->'embedding') n where jsonb_typeof(n)<>'number') then raise exception 'evidence:embedding finite numeric vectors required'; end if;
    vec:=(chunk->'embedding')::text::vector;
    if vector_dims(vec)<>1536 or vector_norm(vec)=0 then raise exception 'evidence:embedding nonzero 1536 vector required'; end if;
    a:=(chunk->>'start')::integer; b:=(chunk->>'end')::integer;
    if a is null or b is null or a<0 or b<=a or b>length(v.normalized_text)
      or b-a>(g.profile->'chunking'->>'size')::integer
      or substring(v.normalized_text from a+1 for b-a) is distinct from chunk->>'content'
      then raise exception 'evidence:validation invalid retained passage spans'; end if;
    -- Replays validate the whole supplied set but reuse its existing immutable IDs.
    insert into public.evidence_version_chunks(source_version_id,generation_id,chunk_index,content,embedding,span_start,span_end)
    values(version_id,generation_id,position,chunk->>'content',vec,a,b) on conflict do nothing;
    if not exists(select 1 from public.evidence_version_chunks c where c.source_version_id=version_id and c.generation_id=evidence_retain_chunks.generation_id
      and c.chunk_index=position and c.content=chunk->>'content' and c.span_start=a and c.span_end=b) then raise exception 'evidence:conflict retained representation differs'; end if;
    position:=position+1;
  end loop;
  if position<>(select count(*) from public.evidence_version_chunks c where c.source_version_id=version_id and c.generation_id=evidence_retain_chunks.generation_id)
    or (chunks->0->>'start')::integer<>0 or (chunks->(position-1)->>'end')::integer<>length(v.normalized_text)
    or exists(select 1 from jsonb_array_elements(chunks) with ordinality x(value,n)
      where n>1 and (value->>'start')::integer>(chunks->(n::integer-2)->>'end')::integer)
    then raise exception 'evidence:validation incomplete passage representation'; end if;
end $$;

create function public.evidence_project(version_id uuid, generation_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare v public.evidence_source_versions; p jsonb;
begin
  select * into strict v from public.evidence_source_versions where id=version_id; p:=v.metadata;
  if not exists(select 1 from public.evidence_version_chunks c where c.source_version_id=version_id and c.generation_id=evidence_project.generation_id) then raise exception 'evidence:contract missing complete representation'; end if;
  update public.evidence_sources set title=p->>'title',publisher=p->>'publisher',source_type=(p->>'sourceType')::public.source_type,
    evidence_type=(p->>'evidenceType')::public.evidence_type,event_types=array(select jsonb_array_elements_text(p->'eventTypes')),
    region=p->>'region',event_start=(p->>'eventStart')::timestamptz,event_end=(p->>'eventEnd')::timestamptz,
    published_at=(p->>'publishedAt')::timestamptz,source_updated_at=(p->>'sourceUpdatedAt')::timestamptz,
    current_version_id=v.id,generation_id=evidence_project.generation_id,content_hash=v.content_hash,
    ingestion_profile=v.normalization_profile,embedding_profile=(select profile->'embedding' from public.evidence_processing_generations where id=evidence_project.generation_id)
  where id=v.source_id;
  delete from public.evidence_chunks where source_id=v.source_id;
  insert into public.evidence_chunks(id,source_id,content,embedding,chunk_index,created_at,source_version_id,generation_id)
  select id,v.source_id,content,embedding,chunk_index,created_at,source_version_id,c.generation_id
  from public.evidence_version_chunks c where c.source_version_id=version_id and c.generation_id=evidence_project.generation_id;
end $$;

create function public.store_evidence_source(payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare corpus public.evidence_corpus_state; current_source public.evidence_sources;
  lease public.evidence_ingestion_state; version_id uuid; p jsonb:=payload->'source';
  generation_id uuid:=(payload->>'generationId')::uuid; desired_hash text:=payload->>'contentHash';
  inserted_sources integer; inserted_versions integer;
begin
  select * into strict corpus from public.evidence_corpus_state where singleton for update;
  if corpus.maintenance then raise exception 'evidence:maintenance corpus rebuild in progress'; end if;
  if corpus.active_generation_id is distinct from generation_id then raise exception 'evidence:generation stale processing generation'; end if;
  select * into lease from public.evidence_ingestion_state where provider_id=payload->'lease'->>'providerId' for update;
  if lease.owner is distinct from (payload->'lease'->>'owner')::uuid or lease.expires_at<=clock_timestamp() or lease.owner is null then raise exception 'evidence:lease provider ownership expired'; end if;
  if desired_hash is null or p->>'normalizedText' is null or p->>'normalizationProfile' is null or payload->>'itemId' is null
    or desired_hash !~ '^[a-f0-9]{64}$' or length(btrim(p->>'normalizedText'))=0 or length(btrim(p->>'title'))=0 or length(btrim(p->>'publisher'))=0
    or length(btrim(p->>'normalizationProfile'))=0 or length(btrim(payload->>'itemId'))=0
    or jsonb_typeof(p->'eventTypes') is distinct from 'array' then raise exception 'evidence:validation invalid normalized publication'; end if;
  -- Empty enum/tag values and all dates are validated here as well as in TypeScript.
  if exists(select 1 from jsonb_array_elements_text(p->'eventTypes') t where t not in
    ('Wildfire','Storm','Flood','Drought','Extreme heat','Temperature extremes','Sea and lake ice','Volcano','Earthquake','Landslide','Dust and haze','Snow','Other'))
    then raise exception 'evidence:validation unsupported EventCategory'; end if;
  if p->>'url' !~ '^https?://[^[:space:]@]+$' then raise exception 'evidence:validation invalid canonical URL'; end if;
  insert into public.evidence_sources(title,publisher,url,source_type,evidence_type)
  values(p->>'title',p->>'publisher',p->>'url',(p->>'sourceType')::public.source_type,(p->>'evidenceType')::public.evidence_type)
  on conflict(url) do nothing;
  get diagnostics inserted_sources=row_count;
  select * into strict current_source from public.evidence_sources where url=p->>'url' for update;
  if current_source.content_hash=desired_hash and current_source.generation_id=generation_id then return jsonb_build_object('status','unchanged','sourceCreated',false,'versionCreated',false); end if;
  if current_source.current_version_id is distinct from (payload->>'expectedVersionId')::uuid then raise exception 'evidence:conflict current source version changed'; end if;
  insert into public.evidence_source_versions(source_id,metadata,normalized_text,content_hash,normalization_profile,provider_id,item_id)
  values(current_source.id,p-'normalizedText'-'normalizationProfile',p->>'normalizedText',desired_hash,p->>'normalizationProfile',lease.provider_id,payload->>'itemId')
  on conflict(source_id,content_hash) do nothing;
  get diagnostics inserted_versions=row_count;
  select id into strict version_id from public.evidence_source_versions where source_id=current_source.id and content_hash=desired_hash;
  perform public.evidence_retain_chunks(version_id,generation_id,payload->'chunks');
  perform public.evidence_project(version_id,generation_id);
  return jsonb_build_object('status','stored','sourceCreated',inserted_sources>0,'versionCreated',inserted_versions>0);
end $$;

create function public.evidence_rebuild_status() returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
  select case when s.maintenance then jsonb_build_object('generation',jsonb_build_object('id',g.id,'profile',g.profile),
    'previousGenerationId',s.active_generation_id,'owner',s.rebuild_owner,'expiresAt',s.rebuild_expires_at,
    'manifest',s.manifest,'completed',s.completed) else null end
  from public.evidence_corpus_state s left join public.evidence_processing_generations g on g.id=s.target_generation_id where singleton
$$;

create function public.evidence_control(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare corpus public.evidence_corpus_state; g public.evidence_processing_generations;
  lease public.evidence_ingestion_state; v public.evidence_source_versions;
  owner_id uuid:=(payload->>'owner')::uuid; provider text:=payload->>'providerId'; profile jsonb:=payload->'profile';
  seconds integer; target uuid; item jsonb;
begin
  select * into strict corpus from public.evidence_corpus_state where singleton for update;
  if action='generation' then
    if corpus.maintenance then raise exception 'evidence:maintenance corpus rebuild in progress'; end if;
    if corpus.active_generation_id is null then
      if exists(select 1 from public.evidence_sources) then raise exception 'evidence:legacy reconcile originals and profiles using evidence_adopt_legacy before ingestion'; end if;
      insert into public.evidence_processing_generations(profile,status) values(profile,'ready') returning id into target;
      update public.evidence_corpus_state set active_generation_id=target where singleton;
    else target:=corpus.active_generation_id; end if;
    select * into strict g from public.evidence_processing_generations where id=target;
    if g.profile is distinct from profile then raise exception 'evidence:generation configured profile requires an explicit rebuild'; end if;
    if exists(select 1 from public.evidence_sources s where s.generation_id is distinct from target or s.current_version_id is null
        or s.embedding_profile is distinct from g.profile->'embedding'
        or not exists(select 1 from public.evidence_chunks c where c.source_id=s.id))
      or exists(select 1 from public.evidence_chunks c join public.evidence_sources s on s.id=c.source_id
        where c.embedding is null or c.generation_id is distinct from target or c.source_version_id is distinct from s.current_version_id)
      then raise exception 'evidence:generation unknown or mixed current representations require reconciliation'; end if;
    return jsonb_build_object('id',g.id,'profile',g.profile);
  elsif action='find-source' then
    return (select jsonb_build_object('id',id,'sourceVersionId',current_version_id,'contentHash',content_hash) from public.evidence_sources where url=payload->>'url');
  elsif action='lease' then
    if corpus.maintenance then raise exception 'evidence:maintenance corpus rebuild in progress'; end if;
    seconds:=(payload->>'seconds')::integer;
    if seconds not between 1 and 3600 or owner_id is null then raise exception 'evidence:validation invalid lease'; end if;
    insert into public.evidence_ingestion_state(provider_id) values(provider) on conflict do nothing;
    select * into strict lease from public.evidence_ingestion_state where provider_id=provider for update;
    if lease.owner is not null and lease.expires_at>clock_timestamp() and lease.owner<>owner_id then return null; end if;
    update public.evidence_ingestion_state set owner=owner_id,expires_at=clock_timestamp()+make_interval(secs=>seconds) where provider_id=provider;
    return jsonb_build_object('providerId',provider,'owner',owner_id,'progress',lease.progress);
  elsif action='checkpoint' then
    select * into strict lease from public.evidence_ingestion_state where provider_id=provider for update;
    if lease.owner is null and lease.last_checkpoint_owner=owner_id and lease.progress=payload->'progress' then return '{}'::jsonb; end if;
    if lease.owner is distinct from owner_id or lease.expires_at<=clock_timestamp() then raise exception 'evidence:lease stale checkpoint owner'; end if;
    if jsonb_typeof(payload->'progress') is distinct from 'object' or jsonb_typeof(payload->'progress'->'pending') is distinct from 'array'
      or jsonb_typeof(payload->'progress'->'state') is distinct from 'object' or octet_length((payload->'progress')::text)>262144 then raise exception 'evidence:validation invalid checkpoint'; end if;
    update public.evidence_ingestion_state set progress=payload->'progress',last_checkpoint_owner=owner_id,owner=null,expires_at=null where provider_id=provider;
    return '{}'::jsonb;
  elsif action='known-items' then
    return (select coalesce(jsonb_agg(jsonb_build_object('itemId',item_id,'publishedAt',published_at) order by item_id),'[]'::jsonb) from (
      select distinct old.item_id,current_version.metadata->>'publishedAt' published_at
      from public.evidence_source_versions old join public.evidence_sources s on s.id=old.source_id
      join public.evidence_source_versions current_version on current_version.id=s.current_version_id
      where old.provider_id=provider and old.created_at<=(payload->>'through')::timestamptz
        and (payload->>'after' is null or old.item_id>payload->>'after')
      order by old.item_id limit least(100,greatest(1,(payload->>'limit')::integer))) items);
  elsif action='read-version' then
    select * into strict v from public.evidence_source_versions where id=(payload->>'id')::uuid;
    if v.normalized_text is null then raise exception 'evidence:legacy original normalized text is unknown'; end if;
    return jsonb_build_object('id',v.id,'sourceId',v.source_id,'providerId',v.provider_id,'itemId',v.item_id,
      'source',v.metadata||jsonb_build_object('normalizedText',v.normalized_text,'normalizationProfile',v.normalization_profile));
  elsif action='rebuild-status' then return public.evidence_rebuild_status();
  elsif action='rebuild-start' then
    if owner_id is null then raise exception 'evidence:validation rebuild owner required'; end if;
    if corpus.maintenance and corpus.rebuild_owner=owner_id and
      (select pg.profile from public.evidence_processing_generations pg where id=corpus.target_generation_id)=profile then return public.evidence_rebuild_status(); end if;
    if corpus.maintenance then raise exception 'evidence:maintenance resume or abort the existing rebuild'; end if;
    if corpus.active_generation_id is null or exists(select 1 from public.evidence_sources s join public.evidence_source_versions sv on sv.id=s.current_version_id where sv.normalized_text is null)
      then raise exception 'evidence:legacy corpus lacks verified originals/profile'; end if;
    insert into public.evidence_processing_generations(profile,status) values(profile,'staging') returning id into target;
    update public.evidence_corpus_state set maintenance=true,target_generation_id=target,rebuild_owner=owner_id,
      rebuild_expires_at=clock_timestamp()+interval '10 minutes',manifest=array(select current_version_id from public.evidence_sources order by id),completed='{}' where singleton;
    return public.evidence_rebuild_status();
  elsif action='rebuild-resume' then
    if not corpus.maintenance or owner_id is null then raise exception 'evidence:maintenance no resumable rebuild'; end if;
    if corpus.rebuild_owner<>owner_id and corpus.rebuild_expires_at>clock_timestamp() then raise exception 'evidence:lease rebuild is owned by another operator'; end if;
    if (select pg.profile from public.evidence_processing_generations pg where id=corpus.target_generation_id) is distinct from profile then raise exception 'evidence:generation resume configuration differs from target'; end if;
    update public.evidence_corpus_state set rebuild_owner=owner_id,rebuild_expires_at=clock_timestamp()+interval '10 minutes' where singleton;
    return public.evidence_rebuild_status();
  elsif action in ('rebuild-stage','rebuild-activate','rebuild-abort') then
    if not corpus.maintenance and corpus.last_rebuild_owner=owner_id and
      ((action='rebuild-activate' and corpus.last_rebuild_outcome='activated' and corpus.last_rebuild_generation_id=(payload->>'generationId')::uuid)
        or (action='rebuild-abort' and corpus.last_rebuild_outcome='aborted' and
          (select pg.profile from public.evidence_processing_generations pg where id=corpus.active_generation_id)=profile)) then return '{}'::jsonb; end if;
    if not corpus.maintenance then raise exception 'evidence:maintenance no active rebuild'; end if;
    if action='rebuild-abort' then
      if (select pg.profile from public.evidence_processing_generations pg where id=corpus.active_generation_id) is distinct from profile then raise exception 'evidence:generation abort requires previous compatible configuration'; end if;
      if owner_id is null or (corpus.rebuild_owner<>owner_id and corpus.rebuild_expires_at>clock_timestamp()) then raise exception 'evidence:lease rebuild owner required'; end if;
      if exists(select 1 from public.evidence_sources where generation_id is distinct from corpus.active_generation_id) then raise exception 'evidence:contract previous projection is incomplete'; end if;
      update public.evidence_processing_generations set status='aborted' where id=corpus.target_generation_id;
    else
      if owner_id is distinct from corpus.rebuild_owner or corpus.rebuild_expires_at<=clock_timestamp() then raise exception 'evidence:lease expired rebuild owner; resume explicitly'; end if;
      if (payload->>'generationId')::uuid is distinct from corpus.target_generation_id then raise exception 'evidence:generation stale rebuild generation'; end if;
      if action='rebuild-stage' then
        target:=(payload->>'versionId')::uuid;
        if not target=any(corpus.manifest) then raise exception 'evidence:validation version outside frozen manifest'; end if;
        perform public.evidence_retain_chunks(target,corpus.target_generation_id,payload->'chunks');
        update public.evidence_corpus_state set completed=array(select distinct unnest(completed||array[target])),rebuild_expires_at=clock_timestamp()+interval '10 minutes' where singleton;
        return '{}'::jsonb;
      end if;
      if cardinality(corpus.manifest)<>cardinality(corpus.completed) or not corpus.manifest<@corpus.completed
        or corpus.manifest is distinct from array(select current_version_id from public.evidence_sources order by id) then raise exception 'evidence:contract rebuild manifest is incomplete or changed'; end if;
      foreach target in array corpus.manifest loop perform public.evidence_project(target,corpus.target_generation_id); end loop;
      update public.evidence_processing_generations set status='retired' where id=corpus.active_generation_id;
      update public.evidence_processing_generations set status='ready' where id=corpus.target_generation_id;
      update public.evidence_corpus_state set active_generation_id=target_generation_id where singleton;
    end if;
    update public.evidence_corpus_state set last_rebuild_owner=owner_id,last_rebuild_generation_id=target_generation_id,
      last_rebuild_outcome=case when action='rebuild-abort' then 'aborted' else 'activated' end,
      maintenance=false,target_generation_id=null,rebuild_owner=null,rebuild_expires_at=null,manifest='{}',completed='{}' where singleton;
    return '{}'::jsonb;
  else raise exception 'evidence:validation unsupported control action'; end if;
end $$;

-- Explicit all-or-nothing legacy reconciliation. Operator supplies verified
-- originals and complete embeddings under the declared profile. Old IDs remain
-- in the legacy journal; unknown originals/profile are never fabricated.
create function public.evidence_adopt_legacy(profile jsonb, publications jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare corpus public.evidence_corpus_state; generation_id uuid; publication jsonb; lease jsonb; owner uuid:=gen_random_uuid();
begin
  select * into strict corpus from public.evidence_corpus_state where singleton for update;
  if corpus.active_generation_id is not null or corpus.maintenance then raise exception 'evidence:legacy adoption is only for an uninitialized corpus'; end if;
  if jsonb_typeof(publications)<>'array' or jsonb_array_length(publications)<>(select count(*) from public.evidence_sources)
    or (select count(distinct p->'source'->>'url') from jsonb_array_elements(publications) p)<>jsonb_array_length(publications)
    or exists(select 1 from jsonb_array_elements(publications) p where not exists(select 1 from public.evidence_sources s where s.url=p->'source'->>'url'))
    then raise exception 'evidence:legacy adoption must reconcile every existing source exactly once'; end if;
  insert into public.evidence_processing_generations(profile,status) values(profile,'ready') returning id into generation_id;
  update public.evidence_corpus_state set active_generation_id=generation_id where singleton;
  for publication in select value from jsonb_array_elements(publications) loop
    lease:=public.evidence_control('lease',jsonb_build_object('providerId',publication->>'providerId','owner',owner,'seconds',600));
    perform public.store_evidence_source(publication||jsonb_build_object('generationId',generation_id,'lease',lease,
      'expectedVersionId',(select current_version_id from public.evidence_sources where url=publication->'source'->>'url')));
    perform public.evidence_control('checkpoint',jsonb_build_object('providerId',publication->>'providerId','owner',owner,'progress',lease->'progress'));
  end loop;
end $$;

create function public.evidence_citation(chunk_id uuid) returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
select jsonb_build_object('chunk_id',c.id,'source_id',v.source_id,'source_version_id',v.id,'content',c.content,
  'source_title',v.metadata->>'title','publisher',v.metadata->>'publisher','source_url',v.metadata->>'url',
  'evidence_type',v.metadata->>'evidenceType','source_type',v.metadata->>'sourceType','published_at',v.metadata->>'publishedAt')
from public.evidence_version_chunks c join public.evidence_source_versions v on v.id=c.source_version_id where c.id=chunk_id
$$;

create function public.hybrid_match_evidence_chunks(payload jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,extensions
set hnsw.ef_search='500' set hnsw.iterative_scan='strict_order' as $$
declare corpus public.evidence_corpus_state; query_vector public.evidence_version_chunks.embedding%type:=(payload->'embedding')::text::vector;
  result_limit integer:=coalesce((payload->'query'->>'limit')::integer,10); candidates integer;
  cap integer:=coalesce((payload->>'publicationCap')::integer,2); ranked record; selected jsonb:='[]';
  counts jsonb:='{}'; redundant boolean; q jsonb:=payload->'query'; previous jsonb;
begin
  select * into strict corpus from public.evidence_corpus_state where singleton for share;
  if corpus.maintenance then raise exception 'evidence:maintenance corpus rebuild in progress'; end if;
  if corpus.active_generation_id is null or corpus.active_generation_id is distinct from (payload->>'generationId')::uuid then raise exception 'evidence:generation stale query generation'; end if;
  if vector_dims(query_vector)<>1536 or vector_norm(query_vector)=0 or result_limit not between 1 and 100 or cap not between 1 and 10 or length(btrim(q->>'text'))=0 then raise exception 'evidence:validation invalid hybrid query'; end if;
  candidates:=least(500,greatest(50,8*result_limit,4*cap*result_limit));
  for ranked in
    with semantic_pool as (
      -- Preserve/reuse the deployed semantic contract for pools within its limit.
      select m.chunk_id id,m.similarity from public.match_evidence_chunks(query_vector,least(candidates,100),null,null,null,null,null) m where candidates<=100
      union all
      select large.id,large.similarity from (
        select c.id,1-(c.embedding<=>query_vector) similarity from public.evidence_chunks c
        join public.evidence_sources s on s.id=c.source_id
        where candidates>100 and c.embedding is not null and c.generation_id=corpus.active_generation_id and c.source_version_id=s.current_version_id
        order by c.embedding<=>query_vector,c.id limit candidates
      ) large
    ), semantic as (select id,row_number() over(order by similarity desc,id) rank from semantic_pool),
    lexical_pool as (
      select c.id,ts_rank_cd(c.search_text,websearch_to_tsquery('english',q->>'text')) lexical_score
      from public.evidence_chunks c join public.evidence_sources s on s.id=c.source_id
      where c.embedding is not null and c.generation_id=corpus.active_generation_id and c.source_version_id=s.current_version_id
        and c.search_text@@websearch_to_tsquery('english',q->>'text')
      order by lexical_score desc,c.id limit candidates
    ), lexical as (select id,row_number() over(order by lexical_score desc,id) rank from lexical_pool),
    fused as (
      select coalesce(a.id,b.id) id,coalesce(1.0/(60+a.rank),0)+coalesce(1.0/(60+b.rank),0) fusion
      from semantic a full join lexical b using(id)
    )
    select c.id,c.source_id,c.source_version_id,c.content,1-(c.embedding<=>query_vector) similarity,
      j.span_start,j.span_end,v.metadata,
      fused.fusion
      + case when (v.metadata->'eventTypes') ? (q->>'eventType') then 0.001 else 0 end
      + case when lower(btrim(v.metadata->>'region'))=lower(btrim(q->>'region')) then 0.001 else 0 end
      + case when (q->'evidenceTypes') ? (v.metadata->>'evidenceType') then 0.001 else 0 end
      + case when (q->'sourceTypes') ? (v.metadata->>'sourceType') then 0.001 else 0 end
      + case when q->>'eventDate' is not null and (v.metadata->>'eventStart' is not null or v.metadata->>'eventEnd' is not null)
          and (v.metadata->>'eventStart' is null or (v.metadata->>'eventStart')::timestamptz < ((q->>'eventDate')::date::timestamp at time zone 'UTC')+interval '1 day')
          and (v.metadata->>'eventEnd' is null or (v.metadata->>'eventEnd')::timestamptz >= ((q->>'eventDate')::date::timestamp at time zone 'UTC')) then 0.001 else 0 end score
    from fused join public.evidence_chunks c using(id) join public.evidence_sources s on s.id=c.source_id
    join public.evidence_source_versions v on v.id=c.source_version_id join public.evidence_version_chunks j on j.id=c.id
    where c.generation_id=corpus.active_generation_id and s.current_version_id=c.source_version_id
    order by score desc,c.id
  loop
    if coalesce((counts->>ranked.source_id::text)::integer,0)>=cap then continue; end if;
    redundant:=false;
    for previous in select value from jsonb_array_elements(selected) loop
      if previous->>'content'=ranked.content or
        (previous->>'source_version_id'=ranked.source_version_id::text and ranked.span_start is not null and previous->>'span_start' is not null
          and greatest(0,least(ranked.span_end,(previous->>'span_end')::integer)-greatest(ranked.span_start,(previous->>'span_start')::integer))::numeric
            /least(ranked.span_end-ranked.span_start,(previous->>'span_end')::integer-(previous->>'span_start')::integer)>=0.7)
        then redundant:=true; exit; end if;
    end loop;
    if redundant then continue; end if;
    selected:=selected||jsonb_build_array(jsonb_build_object('chunk_id',ranked.id,'source_id',ranked.source_id,'source_version_id',ranked.source_version_id,
      'content',ranked.content,'similarity',ranked.similarity,'score',ranked.score,'span_start',ranked.span_start,'span_end',ranked.span_end,
      'source_title',ranked.metadata->>'title','publisher',ranked.metadata->>'publisher','source_url',ranked.metadata->>'url',
      'evidence_type',ranked.metadata->>'evidenceType','source_type',ranked.metadata->>'sourceType','published_at',ranked.metadata->>'publishedAt'));
    counts:=jsonb_set(counts,array[ranked.source_id::text],to_jsonb(coalesce((counts->>ranked.source_id::text)::integer,0)+1));
    if jsonb_array_length(selected)>=result_limit then exit; end if;
  end loop;
  return selected;
end $$;

-- Scope grants to these new objects only. Service invoker functions deliberately
-- require the service role; client roles get neither table nor RPC access.
do $security$
declare relation text; routine record; vector_schema text;
begin
  select n.nspname into vector_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector';
  foreach relation in array array['evidence_processing_generations','evidence_source_versions','evidence_version_chunks','evidence_corpus_state','evidence_ingestion_state'] loop
    execute format('alter table public.%I enable row level security',relation);
    execute format('revoke all on public.%I from public,anon,authenticated',relation);
    execute format('grant select,insert,update,delete on public.%I to service_role',relation);
  end loop;
  revoke update,delete on public.evidence_source_versions,public.evidence_version_chunks from service_role;
  for routine in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('evidence_valid_profile','evidence_immutable','evidence_retain_chunks','evidence_project','store_evidence_source',
      'evidence_control','evidence_rebuild_status','evidence_adopt_legacy','evidence_citation','hybrid_match_evidence_chunks') loop
    execute format('alter function %s set search_path=pg_catalog,public,%I',routine.signature,vector_schema);
    execute format('revoke all on function %s from public,anon,authenticated',routine.signature);
    execute format('grant execute on function %s to service_role',routine.signature);
  end loop;
end $security$;
commit;
