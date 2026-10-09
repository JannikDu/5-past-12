import { createEventJob } from '../src/server/climate-events.ts';
import { AssessmentError } from '../src/domain/climate-assessment.ts';
import { EvidenceError } from '../src/domain/evidence.ts';
try {
  const args=process.argv.slice(2);
  const runsArg=args.find(arg=>/^--runs=\d+$/.test(arg));const runs=runsArg?Number(runsArg.slice(7)):1;
  if(args.filter(arg=>arg==='--refresh-only').length>1||args.some(arg=>arg!=='--refresh-only'&&arg!==runsArg)
    ||args.filter(arg=>arg===runsArg).length>1||!Number.isInteger(runs)||runs<1||runs>30)
    throw new Error('Usage: pnpm climate:update [--refresh-only] [--runs=1..30]');
  for(let run=1;run<=runs;run++) {
    const summary=await createEventJob(process.env).run({refreshOnly:args.includes('--refresh-only')});
    console.info(JSON.stringify({run,runs,...summary}));
    if(summary.discoveryError)process.exitCode=1;
    if(summary.status==='busy')break;
  }
}catch(error){console.error(error instanceof AssessmentError||error instanceof EvidenceError?`${error.code}: ${error.message}`:(error as Error).message);process.exitCode=1;}
