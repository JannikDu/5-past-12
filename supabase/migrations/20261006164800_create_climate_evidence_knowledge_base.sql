-- Climate evidence storage only: no application integration or event relationships.
-- Review before running `supabase db push`; this repository does not deploy SQL in CI.
-- Embedding space: 1536 dimensions by default, with no model/provider selected yet.
-- Change BOTH vector(1536) below and the RPC dimension guard if choosing another
-- dimension before deployment. After deployment, use a new migration and re-embed.

begin;
set local lock_timeout = '5s';

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- Reuse pgvector in its existing schema instead of relocating an installed extension.
-- The RPC receives the same search path below; relations are always qualified.
select pg_catalog.set_config(
  'search_path',
  pg_catalog.format('pg_catalog, public, %I', n.nspname),
  true
)
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = 'vector';

do $enums$
begin
  if pg_catalog.to_regtype('public.evidence_type') is null then
    create type public.evidence_type as enum (
      'direct_attribution', 'event_context', 'analogue_attribution', 'general_context'
    );
  end if;
  if (
    select array_agg(e.enumlabel::text order by e.enumsortorder)
    from pg_catalog.pg_enum e
    where e.enumtypid = 'public.evidence_type'::regtype
  ) is distinct from array[
    'direct_attribution', 'event_context', 'analogue_attribution', 'general_context'
  ]::text[] then
    raise exception 'Existing public.evidence_type does not match the expected enum; review the schema before applying';
  end if;

  if pg_catalog.to_regtype('public.source_type') is null then
    create type public.source_type as enum (
      'attribution_study', 'scientific_report', 'observation', 'dataset', 'article'
    );
  end if;
  if (
    select array_agg(e.enumlabel::text order by e.enumsortorder)
    from pg_catalog.pg_enum e
    where e.enumtypid = 'public.source_type'::regtype
  ) is distinct from array[
    'attribution_study', 'scientific_report', 'observation', 'dataset', 'article'
  ]::text[] then
    raise exception 'Existing public.source_type does not match the expected enum; review the schema before applying';
  end if;
end;
$enums$;

comment on type public.evidence_type is
  'Evidence relationship: concrete-event attribution, current-event context, historical analogue attribution, or general scientific context. This classification alone does not establish evidence sufficiency.';
comment on type public.source_type is
  'Provider-independent source format; articles are not automatically scientific attribution evidence.';

create table if not exists public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  publisher text not null check (length(btrim(publisher)) > 0),
  url text not null,
  source_type public.source_type not null,
  evidence_type public.evidence_type not null,
  event_types text[] not null default '{}'::text[],
  region text,
  event_start timestamptz,
  event_end timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_sources_url_key unique (url),
  constraint evidence_sources_url_check check (
    url = btrim(url) and url ~ '^https?://[^[:space:]]+$'
  ),
  constraint evidence_sources_event_time_check check (
    event_start is null or event_end is null or event_end >= event_start
  ),
  constraint evidence_sources_region_check check (
    region is null or (region = btrim(region) and length(region) > 0)
  )
);

comment on column public.evidence_sources.event_types is
  'EventCategory values from src/domain/climate-event.ts (e.g. Wildfire, Flood, Extreme heat). Stored as text[] because the vocabulary currently exists only in TypeScript; no parallel PostgreSQL EventType enum or event relationship is introduced.';
comment on column public.evidence_sources.url is
  'Unique canonical HTTP(S) source URL. Ingestion must canonicalize equivalent URLs before upsert; URL syntax checks here are intentionally not a complete URL parser.';

create table if not exists public.evidence_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.evidence_sources(id) on delete cascade,
  content text not null check (length(btrim(content)) > 0),
  embedding vector(1536),
  chunk_index integer not null check (chunk_index >= 0),
  created_at timestamptz not null default now(),
  constraint evidence_chunks_source_chunk_key unique (source_id, chunk_index),
  constraint evidence_chunks_embedding_nonzero_check check (
    embedding is null or vector_norm(embedding) > 0
  )
);

comment on column public.evidence_chunks.embedding is
  '1536-dimensional default, not a provider/model commitment. NULL supports ingestion before embedding; NULL vectors are excluded from retrieval. Use one consistent embedding space, and re-embed all chunks when changing models.';
comment on column public.evidence_chunks.chunk_index is
  'Zero-based position within the source, unique per source.';

create index if not exists evidence_sources_evidence_type_idx
  on public.evidence_sources (evidence_type);
create index if not exists evidence_sources_source_type_idx
  on public.evidence_sources (source_type);
create index if not exists evidence_sources_published_at_idx
  on public.evidence_sources (published_at desc);
create index if not exists evidence_sources_region_idx
  on public.evidence_sources (lower(region)) where region is not null;
-- The UNIQUE (source_id, chunk_index) index already supports source_id lookups
-- and cascading deletes; a second source_id-only index would be redundant.
create index if not exists evidence_chunks_embedding_hnsw_idx
  on public.evidence_chunks using hnsw (embedding vector_cosine_ops);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create or replace trigger evidence_sources_set_updated_at
before update on public.evidence_sources
for each row execute function public.set_updated_at();

create or replace function public.match_evidence_chunks(
  query_embedding vector,
  match_count integer default 10,
  match_threshold double precision default null,
  filter_evidence_type public.evidence_type default null,
  filter_source_type public.source_type default null,
  filter_event_type text default null,
  filter_region text default null
)
returns table (
  chunk_id uuid,
  source_id uuid,
  content text,
  similarity double precision,
  source_title text,
  publisher text,
  source_url text,
  evidence_type public.evidence_type,
  source_type public.source_type,
  published_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions
set hnsw.ef_search = '100'
set hnsw.iterative_scan = 'strict_order'
as $function$
begin
  -- PostgreSQL does not enforce vector typmods on function arguments.
  if query_embedding is null or vector_dims(query_embedding) <> 1536
    or vector_norm(query_embedding) = 0 then
    raise exception using errcode = '22023',
      message = 'query_embedding must be a nonzero 1536-dimensional vector';
  end if;
  if match_count is null or match_count < 1 or match_count > 100 then
    raise exception using errcode = '22023', message = 'match_count must be between 1 and 100';
  end if;
  if match_threshold is not null and (match_threshold < -1 or match_threshold > 1) then
    raise exception using errcode = '22023', message = 'match_threshold must be between -1 and 1, or NULL';
  end if;

  return query
  select
    c.id, c.source_id, c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    s.title, s.publisher, s.url, s.evidence_type, s.source_type, s.published_at
  from public.evidence_chunks c
  join public.evidence_sources s on s.id = c.source_id
  where c.embedding is not null
    and (match_threshold is null or 1 - (c.embedding <=> query_embedding) >= match_threshold)
    and (filter_evidence_type is null or s.evidence_type = filter_evidence_type)
    and (filter_source_type is null or s.source_type = filter_source_type)
    and (filter_event_type is null or s.event_types @> array[filter_event_type])
    and (filter_region is null or lower(s.region) = lower(btrim(filter_region)))
  -- Order by the distance operator directly so pgvector can use the HNSW index.
  order by c.embedding <=> query_embedding
  limit match_count;
end;
$function$;

-- Match the RPC to the actual pgvector schema, including an existing installation.
do $vector_schema$
declare
  vector_schema text;
begin
  select n.nspname into vector_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'vector';

  execute pg_catalog.format(
    'alter function public.match_evidence_chunks(%I.vector, integer, double precision, public.evidence_type, public.source_type, text, text) set search_path = pg_catalog, public, %I',
    vector_schema, vector_schema
  );
  execute pg_catalog.format('grant usage on schema %I to service_role', vector_schema);
end;
$vector_schema$;

comment on function public.match_evidence_chunks(
  vector, integer, double precision, public.evidence_type, public.source_type, text, text
) is
  'Service-only evidence retrieval by cosine similarity. Filters are optional and combined with AND; event tags are exact, regions are case-insensitive exact matches. Semantic relevance never establishes climate attribution.';

-- A public information website does not require exposing its raw knowledge base.
-- No existing database read convention exists: keep raw evidence and RPC server-only
-- until a reviewed public read model is introduced. Supabase service_role bypasses
-- RLS, so it requires grants but no permissive policies. Do not alter global defaults
-- or existing policies, and do not rely on automatic RLS enablement alone.
alter table public.evidence_sources enable row level security;
alter table public.evidence_chunks enable row level security;

revoke all on table public.evidence_sources, public.evidence_chunks from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.evidence_sources, public.evidence_chunks to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;
revoke all on function public.match_evidence_chunks(
  vector, integer, double precision, public.evidence_type, public.source_type, text, text
) from public, anon, authenticated;
grant execute on function public.match_evidence_chunks(
  vector, integer, double precision, public.evidence_type, public.source_type, text, text
) to service_role;

commit;
