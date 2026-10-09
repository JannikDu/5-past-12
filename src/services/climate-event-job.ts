import { AssessmentError, type ClimateAssessment } from '../domain/climate-assessment.ts';
import type { ClimateEvent } from '../domain/climate-event.ts';
import type { ClimateEventCatalog } from '../data/repositories/climate-event-catalog.ts';
import type { EventSourceProvider } from '../data/providers/event-source.ts';
import { assessmentWindow, withinAssessmentWindow } from './assessment-window.ts';
import { eventFingerprint } from './assessment-context.ts';
import { discoveryPriority } from './assessment-discovery.ts';
function previousDay(day: string) {const date=new Date(`${day}T00:00:00Z`);date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);}
/** Bisect saturated date windows; never advance a cursor after incomplete discovery. */
export async function fetchCompleteEventWindow(provider: EventSourceProvider,start: string,end: string,maxRequests=16): Promise<ClimateEvent[]> {
  const events=new Map<string,ClimateEvent>();let requests=0;
  async function read(first: string,last: string): Promise<void> {
    if(++requests>maxRequests)throw new AssessmentError('budget','Historical event window exceeded the provider request budget');
    const batch=await provider.fetchEvents({start:first,end:last,limit:200});
    if(batch.events.length+batch.skipped>=200) {
      if(first===last)throw new AssessmentError('budget','A single EONET day is saturated; catalog discovery is incomplete');
      const middle=new Date(Math.floor((Date.parse(`${first}T00:00:00Z`)+Date.parse(`${last}T00:00:00Z`))/2));
      const day=middle.toISOString().slice(0,10);const next=new Date(`${day}T00:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
      await read(first,day);await read(next.toISOString().slice(0,10),last);return;
    }
    for(const event of batch.events)events.set(event.id,event);
  }
  await read(start,end);return [...events.values()];
}
export interface EventJobSummary {status:'completed'|'busy';discovered:number;attempted:number;completed:number;insufficient:number;failed:number;modelCalls:number;historyEnd?:string;discoveryError?:string}
export class ClimateEventJob {
  constructor(private readonly catalog: ClimateEventCatalog,private readonly provider: EventSourceProvider,
    private readonly service: {assess(event: ClimateEvent): Promise<ClimateAssessment>},private readonly budget: {model:string;readonly remaining:number;readonly used:number},
    private readonly titles: ()=>Promise<string[]>,private readonly now=()=>new Date(),private readonly clock=()=>Date.now()) {}
  async run(options:{refreshOnly?:boolean}={}):Promise<EventJobSummary> {
    const lease=await this.catalog.acquire();const summary:EventJobSummary={status:lease?'completed':'busy',discovered:0,attempted:0,completed:0,insufficient:0,failed:0,modelCalls:0};
    if(!lease)return summary;
    const started=this.clock();const now=this.now();const window=assessmentWindow(now);let historyEnd:string|undefined;let refreshed=false;
    try {
      try {
        const titles=await this.titles();
        // Daily recent refresh plus one week of backfill, across all event categories.
        const recentStart=previousDay(window.end);
        const end=lease.historyEnd??window.end;
        const first=new Date(`${end}T00:00:00Z`);first.setUTCDate(first.getUTCDate()-6);
        const start=first.toISOString().slice(0,10)<window.start?window.start:first.toISOString().slice(0,10);
        const recent=await fetchCompleteEventWindow(this.provider,recentStart,window.end);
        const historical=end>=window.start?await fetchCompleteEventWindow(this.provider,start,end):[];
        const events=[...new Map([...recent,...historical].filter(e=>withinAssessmentWindow(e,now)).map(e=>[e.id,e])).values()];
        const items=await Promise.all(events.map(async event=>({event,fingerprint:await eventFingerprint(event),priority:discoveryPriority(event,titles)})));
        for(let index=0;index<items.length;index+=100)await this.catalog.upsert(lease,items.slice(index,index+100));
        historyEnd=end>=window.start?previousDay(start):end;summary.historyEnd=historyEnd;summary.discovered=events.length;refreshed=true;
      }catch(error) {summary.discoveryError=error instanceof AssessmentError?error.code:'provider_unavailable';}
      if(!options.refreshOnly)for(const event of await this.catalog.pending(lease,this.budget.model)) {
        if(this.budget.remaining<2||this.clock()-started>=9*60*1000)break;
        if(!withinAssessmentWindow(event,now))continue;
        const fingerprint=await eventFingerprint(event);
        await this.catalog.begin(lease,event.id,fingerprint,this.budget.model);summary.attempted++;
        try {const assessment=await this.service.assess(event);
          await this.catalog.finish(lease,event.id,fingerprint,this.budget.model,assessment);
          if(assessment.status==='completed')summary.completed++;else summary.insufficient++;
        }catch(error) {summary.failed++;await this.catalog.finish(lease,event.id,fingerprint,this.budget.model,undefined,error instanceof AssessmentError?error.code:'unavailable');}
      }
      return summary;
    }finally {summary.modelCalls=this.budget.used;await this.catalog.release(lease,summary,historyEnd,refreshed);}
  }
}
