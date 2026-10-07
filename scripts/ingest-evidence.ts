import { createEvidenceServices } from '../src/server/evidence.ts';
import { EvidenceError } from '../src/domain/evidence.ts';
try {
  const summary = await createEvidenceServices(process.env).job.run();
  console.info(JSON.stringify(summary));
  if (summary.providers.some(p => p.status === 'failed' || p.status === 'maintenance')) process.exitCode = 1;
} catch (error) { console.error(error instanceof EvidenceError ? `${error.code}: ${error.message}` : 'Evidence ingestion failed'); process.exitCode = 1; }
