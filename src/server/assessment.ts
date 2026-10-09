import { FeatherlessAssessmentModel } from '../data/assessment/featherless.ts';
import { SupabaseAssessmentRepository } from '../data/repositories/supabase-assessment.ts';
import { SupabaseEvidenceRepository } from '../data/repositories/supabase-evidence.ts';
import type { HttpOptions } from '../data/http.ts';
import { DefaultClimateAssessmentService } from '../services/climate-assessment.ts';
import { assessmentModelConfig, supabaseConfig } from './config.ts';
import { createEvidenceServices } from './evidence.ts';

/** Read wiring deliberately needs neither embedding nor generation configuration. */
export function createAssessmentReader(env: Record<string, string | undefined>, http: HttpOptions = {}) {
  const config = supabaseConfig(env);
  const repository = new SupabaseAssessmentRepository(config, http);
  const evidence = new SupabaseEvidenceRepository(config, http);
  const unused = { model: 'read-only', complete: async (): Promise<never> => { throw new Error('Generation unavailable on read path'); } };
  const retrieval = { findByChunkId: (id: string) => evidence.findByChunkId(id), findByChunkIds: (ids: string[]) => evidence.findByChunkIds(ids),
    search: async (): Promise<never> => { throw new Error('Retrieval unavailable on read path'); } };
  return new DefaultClimateAssessmentService(repository, retrieval, unused);
}
export function createAssessmentServices(env: Record<string, string | undefined>, http: HttpOptions = {}) {
  const evidence = createEvidenceServices(env, { http });
  const repository = new SupabaseAssessmentRepository(evidence.config.supabase, http);
  const model = new FeatherlessAssessmentModel(assessmentModelConfig(env), http);
  return { repository, model, retrieval: evidence.retrieval, evidenceRepository: evidence.repository,
    service: new DefaultClimateAssessmentService(repository, evidence.retrieval, model) };
}
