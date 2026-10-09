import { AssessmentError, type ClimateAssessment } from '../domain/climate-assessment.ts';
import type { ClimateEvent } from '../domain/climate-event.ts';
import type { ClimateEventCatalog } from '../data/repositories/climate-event-catalog.ts';
import type { EventSourceProvider } from '../data/providers/event-source.ts';
import { withinAssessmentWindow } from './assessment-window.ts';
import { eventFingerprint } from './assessment-context.ts';
import { discoverStudyEvents } from './study-event-discovery.ts';
import type { StudyDiscoveryRepository, StudyLookup } from '../data/repositories/study-discovery.ts';
export { fetchCompleteEventWindow } from './event-window.ts';
export interface EventJobSummary {status:'completed'|'busy';selection:'study-first';discovered:number;attempted:number;completed:number;insufficient:number;failed:number;modelCalls:number;studyLookups?:StudyLookup[];discoveryError?:string;
  results?: {eventId:string;title:string;status:ClimateAssessment['status']|'failed';assessmentId?:string;humanInfluence?:ClimateAssessment['humanInfluence'];evidenceStrength?:ClimateAssessment['evidenceStrength'];errorCode?:string}[]}
export class ClimateEventJob {
  constructor(private readonly catalog: ClimateEventCatalog,private readonly provider: EventSourceProvider,
    private readonly service: {assess(event: ClimateEvent): Promise<ClimateAssessment>},private readonly budget: {model:string;readonly remaining:number;readonly used:number},
    private readonly studies: StudyDiscoveryRepository,private readonly now=()=>new Date(),private readonly clock=()=>Date.now(),
    private readonly canStartAssessment=()=>true) {}
  async run(options:{refreshOnly?:boolean}={}):Promise<EventJobSummary> {
    const lease=await this.catalog.acquire();const summary:EventJobSummary={status:lease?'completed':'busy',selection:'study-first',discovered:0,attempted:0,completed:0,insufficient:0,failed:0,modelCalls:0};
    if(!lease)return summary;
    const started=this.clock();const now=this.now();let refreshed=false;
    try {
      try {
        const discovery=await discoverStudyEvents(this.catalog,this.studies,this.provider,lease,now);
        summary.discovered=discovery.discovered;summary.studyLookups=discovery.lookups;refreshed=true;
        summary.discoveryError=discovery.lookups.find(lookup=>lookup.outcome==='incomplete')?.errorCode;
      }catch(error) {summary.discoveryError=error instanceof AssessmentError?error.code:'provider_unavailable';}
      if(!options.refreshOnly)for(const event of await this.studies.pending(lease,this.budget.model)) {
        if(this.budget.remaining<2||!this.canStartAssessment()||this.clock()-started>=9*60*1000)break;
        if(!withinAssessmentWindow(event,now))continue;
        const fingerprint=await eventFingerprint(event);
        await this.catalog.begin(lease,event.id,fingerprint,this.budget.model);summary.attempted++;
        try {const assessment=await this.service.assess(event);
          await this.catalog.finish(lease,event.id,fingerprint,this.budget.model,assessment);
          if(assessment.status==='completed')summary.completed++;else summary.insufficient++;
          (summary.results??=[]).push({eventId:event.id,title:event.title,status:assessment.status,assessmentId:assessment.id,
            humanInfluence:assessment.humanInfluence,evidenceStrength:assessment.evidenceStrength});
        }catch(error) {const errorCode=error instanceof AssessmentError?error.code:'unavailable';summary.failed++;
          await this.catalog.finish(lease,event.id,fingerprint,this.budget.model,undefined,errorCode);
          (summary.results??=[]).push({eventId:event.id,title:event.title,status:'failed',errorCode});}
      }
      return summary;
    }finally {summary.modelCalls=this.budget.used;await this.catalog.release(lease,summary,undefined,refreshed);}
  }
}
