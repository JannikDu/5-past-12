import { ClimateCentralEvidenceProvider } from '../data/providers/climate-central-evidence.ts';
import { WorldWeatherAttributionEvidenceProvider } from '../data/providers/world-weather-attribution-evidence.ts';
import { ClimateCentralEvidenceNormalizer } from '../data/normalizers/climate-central-evidence.ts';
import { WorldWeatherAttributionEvidenceNormalizer } from '../data/normalizers/world-weather-attribution-evidence.ts';
import { FeatherlessEmbeddingProvider } from '../data/embeddings/featherless.ts';
import { SupabaseEvidenceRepository } from '../data/repositories/supabase-evidence.ts';
import { EvidenceChunker } from '../services/evidence-chunker.ts';
import { EvidenceIngestionService, registerEvidenceProvider } from '../services/evidence-ingestion.ts';
import { EvidenceIngestionJob } from '../services/evidence-job.ts';
import { DefaultEvidenceRetrievalService } from '../services/evidence-retrieval.ts';
import { EvidenceRebuildService } from '../services/evidence-rebuild.ts';
import { evidenceConfig } from './config.ts';
import { consoleEvidenceLogger, type EvidenceLogger } from './logging.ts';
import type { HttpOptions } from '../data/http.ts';

/** Import only from backend entry points. The Astro frontend has no access to this registry. */
export function createEvidenceServices(env: Record<string, string | undefined>, options: { http?: HttpOptions; logger?: EvidenceLogger } = {}) {
  const config = evidenceConfig(env);
  const repository = new SupabaseEvidenceRepository(config.supabase, options.http);
  const embeddings = new FeatherlessEmbeddingProvider(config.featherless, options.http);
  const chunker = new EvidenceChunker(config.chunking);
  const profile = { embedding: embeddings.profile, chunking: chunker.profile };
  const ingestion = new EvidenceIngestionService(repository, embeddings, chunker);
  const providers = [registerEvidenceProvider(new ClimateCentralEvidenceProvider(options.http), new ClimateCentralEvidenceNormalizer(), ingestion),
    registerEvidenceProvider(new WorldWeatherAttributionEvidenceProvider(options.http), new WorldWeatherAttributionEvidenceNormalizer(), ingestion)];
  return { config, profile, repository, embeddings,
    job: new EvidenceIngestionJob(providers, repository, profile, options.logger ?? consoleEvidenceLogger, config),
    retrieval: new DefaultEvidenceRetrievalService(repository, embeddings, profile, config.publicationCap),
    rebuild: new EvidenceRebuildService(repository, embeddings, chunker, profile) };
}
