import { isClimateEvent, type ClimateEvent } from '../../domain/climate-event.ts';
import { AssessmentError, assessmentVersion, object, parseAssessment, uuid, type ClimateAssessment } from '../../domain/climate-assessment.ts';
import { parseClimateEventFeed, type ClimateEventFeed } from '../../domain/climate-event-feed.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';
export interface CatalogLease { leaseId: string; historyEnd: string|null }
export interface CatalogItem { event: ClimateEvent; fingerprint: string; priority: number }
export interface ClimateEventCatalog {
  acquire(): Promise<CatalogLease|null>;
  upsert(lease: CatalogLease,items: CatalogItem[]): Promise<void>;
  checkpoint(lease: CatalogLease,historyEnd: string): Promise<void>;
  pending(lease: CatalogLease,model: string): Promise<ClimateEvent[]>;
  begin(lease: CatalogLease,eventId: string,fingerprint: string,model: string): Promise<void>;
  finish(lease: CatalogLease,eventId: string,fingerprint: string,model: string,assessment?: ClimateAssessment,errorCode?: string): Promise<void>;
  release(lease: CatalogLease,summary: object,historyEnd?: string,refreshed?: boolean): Promise<void>;
  feed(): Promise<ClimateEventFeed>;
}
export class SupabaseClimateEventCatalog implements ClimateEventCatalog {
  private readonly http: EvidenceHttpClient;
  constructor(private readonly config: {url: string;secretKey: string}, options: HttpOptions={}) { this.http=new EvidenceHttpClient({...options,maxBytes:8*1024*1024}); }
  private async control(action: string,payload: object={}): Promise<unknown> {
    const r=await this.http.request(`${this.config.url}/rest/v1/rpc/climate_event_control`,{method:'POST',redirect:'error',
      headers:{apikey:this.config.secretKey,'Content-Type':'application/json'},body:JSON.stringify({action,payload:{version:assessmentVersion,...payload}})});
    if(r.status<200||r.status>=300) throw new AssessmentError('database',`Event catalog operation failed (${r.status})`);
    try{return JSON.parse(r.text);}catch{throw new AssessmentError('database','Invalid event catalog response');}
  }
  async acquire() { const value=await this.control('acquire',{leaseId:crypto.randomUUID()}); if(value===null)return null;
    const row=object(value); const leaseId=uuid(row.leaseId);
    if(row.historyEnd!==null&&(typeof row.historyEnd!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.historyEnd)))throw new AssessmentError('database','Invalid catalog cursor');
    return {leaseId,historyEnd:row.historyEnd as string|null};
  }
  async upsert(lease: CatalogLease,items: CatalogItem[]) {if(items.some(i=>!isClimateEvent(i.event)))throw new AssessmentError('validation','Invalid catalog event');await this.control('upsert',{...lease,items});}
  async checkpoint(lease: CatalogLease,historyEnd: string) {
    const r=await this.http.request(`${this.config.url}/rest/v1/rpc/climate_event_checkpoint`,{method:'POST',redirect:'error',
      headers:{apikey:this.config.secretKey,'Content-Type':'application/json'},body:JSON.stringify({payload:{leaseId:lease.leaseId,historyEnd}})});
    if(r.status<200||r.status>=300)throw new AssessmentError('database',`Event checkpoint failed (${r.status})`);
  }
  async pending(lease: CatalogLease,model: string) {const result=await this.control('pending',{...lease,model});
    if(!Array.isArray(result)||result.length>30||!result.every(isClimateEvent))throw new AssessmentError('database','Invalid pending events');return result as ClimateEvent[];}
  async begin(lease: CatalogLease,eventId: string,fingerprint: string,model: string) {await this.control('begin',{...lease,eventId,fingerprint,model});}
  async finish(lease: CatalogLease,eventId: string,fingerprint: string,model: string,assessment?: ClimateAssessment,errorCode?: string) {
    await this.control('finish',{...lease,eventId,fingerprint,model,assessmentId:assessment?.id??null,errorCode:errorCode??null});}
  async release(lease: CatalogLease,summary: object,historyEnd?: string,refreshed=false) {await this.control('release',{...lease,summary,historyEnd,refreshed});}
  async feed() {const row=object(await this.control('feed'));if(!Array.isArray(row.items))throw new AssessmentError('database','Invalid catalog feed');
    const events: ClimateEvent[]=[];const indicators: ClimateEventFeed['indicators']=[];
    for(const raw of row.items) {const item=object(raw);if(!isClimateEvent(item.event))throw new AssessmentError('database','Invalid stored event');
      const a=parseAssessment(item.assessment);if(a.eventId!==item.event.id||a.status!=='completed'||!a.claims.length||a.assessmentVersion!==assessmentVersion)throw new AssessmentError('support','Invalid stored connection');
      events.push(item.event);indicators.push({eventId:a.eventId,humanInfluence:a.humanInfluence,evidenceStrength:a.evidenceStrength,stale:item.stale as boolean});}
    return parseClimateEventFeed({events,indicators,counts:row.counts,updatedAt:row.updatedAt,historyEnd:row.historyEnd});}
}
