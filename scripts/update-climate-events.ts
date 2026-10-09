import { createEventJob } from '../src/server/climate-events.ts';
import { AssessmentError } from '../src/domain/climate-assessment.ts';
import { EvidenceError } from '../src/domain/evidence.ts';
try {
  const args=process.argv.slice(2);
  if(args.length>1||(args.length===1&&args[0]!=='--refresh-only'))throw new Error('Usage: pnpm climate:update [--refresh-only]');
  const summary=await createEventJob(process.env).run({refreshOnly:args.includes('--refresh-only')});
  console.info(JSON.stringify(summary));
  if(summary.discoveryError)process.exitCode=1;
}catch(error){console.error(error instanceof AssessmentError||error instanceof EvidenceError?`${error.code}: ${error.message}`:(error as Error).message);process.exitCode=1;}
