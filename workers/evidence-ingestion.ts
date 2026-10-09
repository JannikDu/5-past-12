import { createEvidenceServices } from '../src/server/evidence.ts';
import { assessmentHttp } from '../src/server/assessment-http.ts';
import { createEventJob } from '../src/server/climate-events.ts';

interface ScheduledController { scheduledTime: number; cron: string }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
export default {
  fetch(request: Request, env: Record<string, string | undefined>) { return assessmentHttp(request, env); },
  scheduled(controller: ScheduledController, env: Record<string, string | undefined>, context: ExecutionContext) {
    if (controller.cron === '*/10 * * * *') {
      context.waitUntil(createEventJob(env).run().then(summary=>{console.info(JSON.stringify({operation:'climate-event-job',...summary}));}));
      return;
    }
    context.waitUntil(createEvidenceServices(env).job.run().then(summary => {
      if (summary.providers.some(provider => provider.status === 'failed')) throw new Error('Evidence ingestion has unresolved failures; inspect provider summaries');
    }));
  },
};
