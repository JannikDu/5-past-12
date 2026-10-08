import { findEvent } from '../src/data/events.ts';
import { DataKind } from '../src/domain/climate-event.ts';
import { createAssessmentServices } from '../src/server/assessment.ts';
import { AssessmentError } from '../src/domain/climate-assessment.ts';
import { EvidenceError } from '../src/domain/evidence.ts';
import { mkdir, writeFile } from 'node:fs/promises';

try {
  const id = process.argv[2];
  if (!id || process.argv.slice(3).some(arg => arg !== '--force')) throw new Error('Usage: pnpm climate:assess <namespaced-event-id> [--force]');
  const event = await findEvent(id);
  if (!event || event.provenance.dataKind === DataKind.Demo) throw new Error('Select a real provider event ID from the globe.');
  const assessment = await createAssessmentServices(process.env).service.assess(event, { force: process.argv.includes('--force') });
  await mkdir('.devswarm-temp/assessments', { recursive: true });
  const report = `.devswarm-temp/assessments/${assessment.id}.json`;
  await writeFile(report, JSON.stringify({ event, assessment, humanReview: 'pending' }, null, 2));
  console.info(JSON.stringify({ id: assessment.id, eventId: assessment.eventId, status: assessment.status,
    humanInfluence: assessment.humanInfluence, evidenceStrength: assessment.evidenceStrength, claims: assessment.claims.length, report }));
} catch (error) {
  console.error(error instanceof AssessmentError || error instanceof EvidenceError ? `${error.code}: ${error.message}` : (error as Error).message);
  process.exitCode = 1;
}
