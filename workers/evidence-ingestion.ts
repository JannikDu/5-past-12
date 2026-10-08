import { createEvidenceServices } from '../src/server/evidence.ts';
import { assessmentHttp } from '../src/server/assessment-http.ts';

interface ScheduledController { scheduledTime: number; cron: string }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
export default {
  fetch(request: Request, env: Record<string, string | undefined>) { return assessmentHttp(request, env); },
  scheduled(_controller: ScheduledController, env: Record<string, string | undefined>, context: ExecutionContext) {
    context.waitUntil(createEvidenceServices(env).job.run().then(summary => {
      if (summary.providers.some(provider => provider.status === 'failed')) throw new Error('Evidence ingestion has unresolved failures; inspect provider summaries');
    }));
  },
};
