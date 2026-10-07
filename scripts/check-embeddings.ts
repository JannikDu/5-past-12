import { FeatherlessEmbeddingProvider } from '../src/data/embeddings/featherless.ts';
import { embeddingConfig } from '../src/server/config.ts';
import { EvidenceError, validateVector } from '../src/domain/evidence.ts';
try {
  const provider = new FeatherlessEmbeddingProvider(embeddingConfig(process.env));
  for (const purpose of ['document', 'query'] as const) {
    const vectors = await provider.embed(['Wildfire conditions in Spain and the Mediterranean.', 'Historical drought and extreme heat evidence.'], purpose);
    vectors.forEach(validateVector);
    console.info(JSON.stringify({ model: provider.profile.model, purpose, count: vectors.length, dimensions: 1536, nonzero: true }));
  }
} catch (error) { console.error(error instanceof EvidenceError ? `${error.code}: ${error.message}` : 'Embedding capability check failed'); process.exitCode = 1; }
