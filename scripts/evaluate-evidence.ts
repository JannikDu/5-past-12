import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createEvidenceServices } from '../src/server/evidence.ts';
import { fingerprint } from '../src/services/evidence-identity.ts';
import { EventCategory } from '../src/domain/climate-event.ts';
import { EvidenceError } from '../src/domain/evidence.ts';

interface EvaluationCase {
  id: string; text: string; eventType?: EventCategory; region?: string; eventDate?: string;
  expected: { url: string; usefulPassage: string; metadataMismatch?: string }[];
}
try {
  const cases: EvaluationCase[] = JSON.parse(await readFile(process.argv[2] ?? 'docs/evidence-evaluation.json', 'utf8'));
  const { retrieval, repository, profile, config } = createEvidenceServices(process.env);
  const generation = await repository.ensureGeneration(profile);
  const results = [];
  for (const item of cases) {
    const matches = await retrieval.search({ text: item.text, eventType: item.eventType, region: item.region,
      eventDate: item.eventDate ? new Date(item.eventDate) : undefined, limit: 10 });
    const citations = await Promise.all(matches.map(match => repository.findByChunkId(match.chunkId)));
    results.push({ id: item.id, query: item, publicationCount: new Set(matches.map(m => m.sourceId)).size,
      expected: item.expected.map(expected => ({ ...expected, ranks: matches.flatMap((match, i) => match.sourceUrl === expected.url ? [i + 1] : []) })),
      matches: matches.map((match, i) => ({ rank: i + 1, ...match, citationVerified: citations[i]?.content === match.content && citations[i]?.sourceVersionId === match.sourceVersionId })),
      humanReview: { usefulPassages: null, historicalContextRecall: null, diversity: null, shortcomings: null } });
  }
  const report = { executedAt: new Date().toISOString(), reviewStatus: 'pending-human-review', generationId: generation.id,
    profile, profileFingerprint: await fingerprint(profile), resultLimit: 10, publicationCap: config.publicationCap, results };
  await mkdir('.devswarm-temp/evidence', { recursive: true });
  const path = '.devswarm-temp/evidence/retrieval-evaluation.json';
  await writeFile(path, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ report: path, cases: results.length, reviewStatus: report.reviewStatus }));
} catch (error) { console.error(error instanceof EvidenceError ? `${error.code}: ${error.message}` : 'Evidence evaluation failed'); process.exitCode = 1; }
