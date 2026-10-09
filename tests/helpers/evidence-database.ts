import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFile } from 'node:fs/promises';
import { SupabaseEvidenceRepository } from '../../src/data/repositories/supabase-evidence.ts';

export async function evidenceDatabase(beforeAdditions?: (db: PGlite) => Promise<void>, vectorSchema = 'extensions', assessments = false) {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  try {
    if (vectorSchema !== 'extensions') {
      if (!/^[a-z_]+$/.test(vectorSchema)) throw new Error('Invalid test schema');
      await db.exec(`create schema ${vectorSchema}; create extension vector with schema ${vectorSchema};`);
    }
    await db.exec(await readFile(new URL('../../supabase/migrations/20261006164800_create_climate_evidence_knowledge_base.sql', import.meta.url), 'utf8'));
    await beforeAdditions?.(db);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261007120000_evidence_ingestion_retrieval.sql', import.meta.url), 'utf8'));
    if (assessments) {
      await db.exec(await readFile(new URL('../../supabase/migrations/20261008130000_climate_assessments.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../../supabase/migrations/20261009010000_climate_event_catalog.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../../supabase/migrations/20261009013000_assessment_publication_guards.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../../supabase/migrations/20261009090000_event_job_request_budget.sql', import.meta.url), 'utf8'));
      await db.exec(await readFile(new URL('../../supabase/migrations/20261009120000_study_first_event_discovery.sql', import.meta.url), 'utf8'));
    }
  } catch (error) { await db.close(); throw error; }
  const diagnostics: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const name = new URL(String(input)).pathname.split('/').at(-1)!;
    const body = JSON.parse(String(init?.body));
    const signatures: Record<string, { sql: string; args: unknown[] }> = {
      evidence_control: { sql: 'select public.evidence_control($1,$2::jsonb) result', args: [body.action, JSON.stringify(body.payload)] },
      store_evidence_source: { sql: 'select public.store_evidence_source($1::jsonb) result', args: [JSON.stringify(body.payload)] },
      hybrid_match_evidence_chunks: { sql: 'select public.hybrid_match_evidence_chunks($1::jsonb) result', args: [JSON.stringify(body.payload)] },
      evidence_citation: { sql: 'select public.evidence_citation($1::uuid) result', args: [body.chunk_id] },
      evidence_citations: { sql: 'select public.evidence_citations($1::uuid[]) result', args: [body.chunk_ids] },
      climate_event_checkpoint: { sql: 'select public.climate_event_checkpoint($1::jsonb) result', args: [JSON.stringify(body.payload)] },
      climate_assessment_snapshot: { sql: 'select public.climate_assessment_snapshot() result', args: [] },
      climate_assessment_latest: { sql: 'select public.climate_assessment_latest($1) result', args: [body.event_id] },
      climate_assessment_save: { sql: 'select public.climate_assessment_save($1::jsonb) result', args: [JSON.stringify(body.payload)] },
      climate_assessment_failed: { sql: 'select public.climate_assessment_failed($1) result', args: [body.event_id] },
      climate_event_control: {sql:'select public.climate_event_control($1,$2::jsonb) result',args:[body.action,JSON.stringify(body.payload)]},
      climate_study_control: {sql:'select public.climate_study_control($1,$2::jsonb) result',args:[body.action,JSON.stringify(body.payload)]},
    };
    const query = signatures[name]; if (!query) throw new Error('Unexpected test RPC');
    try {
      // PGlite serializes transaction callbacks, including concurrent RPC calls.
      const result = await db.transaction(async tx => {
        await tx.exec('set local role service_role;');
        return tx.query<{ result: unknown }>(query.sql, query.args);
      });
      return Response.json(result.rows[0].result);
    } catch (error) {
      diagnostics.push(`${name}: ${(error as Error).message}`);
      if (!/(evidence:|assessment:|catalog:|climate_assessment_citations_pkey)/.test((error as Error).message)) console.error('Unexpected local SQL error:', (error as Error).message);
      return Response.json({ message: (error as Error).message }, { status: 400 });
    }
  };
  return { db, diagnostics, fetch: fetcher, repository: new SupabaseEvidenceRepository({ url: 'https://database.test', secretKey: 'fake' }, { fetch: fetcher, retries: 0 }) };
}
export async function count(db: PGlite, table: string): Promise<number> {
  if (!/^evidence_[a-z_]+$/.test(table)) throw new Error('Invalid test table');
  return Number((await db.query<{ n: number }>(`select count(*) n from public.${table}`)).rows[0].n);
}
