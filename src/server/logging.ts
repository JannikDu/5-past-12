export interface EvidenceLogger { info(event: string, fields: Record<string, unknown>): void }
const allowed = new Set(['runId', 'providerId', 'itemId', 'status', 'error', 'fetched', 'normalized', 'skipped', 'stored', 'insertedSources', 'updatedSources', 'retainedVersions', 'unchanged', 'invalid', 'failed', 'chunks', 'durationMs', 'lanes', 'lane', 'generationId', 'completed', 'total']);
export const consoleEvidenceLogger: EvidenceLogger = {
  info(event, fields) { console.info(JSON.stringify({ event, ...Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key))) })); },
};
