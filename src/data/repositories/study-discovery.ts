import { AssessmentError, assessmentVersion, object, uuid } from '../../domain/climate-assessment.ts';
import { isClimateEvent, type ClimateEvent } from '../../domain/climate-event.ts';
import { validateSource, type NormalizedEvidenceSource } from '../../domain/evidence.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';
import type { CatalogLease } from './climate-event-catalog.ts';

export interface DiscoveryStudy { id: string; sourceId: string; source: NormalizedEvidenceSource }
export interface StudyLookup { studyVersionId: string; outcome: 'matched' | 'no_match' | 'not_eligible' | 'incomplete'; eventIds: string[]; query: object | null; errorCode?: string }
export interface StudyDiscoveryRepository {
  next(lease: CatalogLease): Promise<DiscoveryStudy[]>;
  record(lease: CatalogLease, lookup: StudyLookup): Promise<void>;
  pending(lease: CatalogLease, model: string): Promise<ClimateEvent[]>;
}
export class SupabaseStudyDiscoveryRepository implements StudyDiscoveryRepository {
  private readonly http: EvidenceHttpClient;
  constructor(private readonly config: { url: string; secretKey: string }, options: HttpOptions = {}) {
    this.http = new EvidenceHttpClient({ ...options, maxBytes: 8 * 1024 * 1024 });
  }
  private async control(action: string, lease: CatalogLease, payload: object = {}): Promise<unknown> {
    const response = await this.http.request(`${this.config.url}/rest/v1/rpc/climate_study_control`, {
      method: 'POST', redirect: 'error', headers: { apikey: this.config.secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload: { leaseId: lease.leaseId, version: assessmentVersion, ...payload } }),
    });
    if (response.status < 200 || response.status >= 300) throw new AssessmentError('database', `Study discovery operation failed (${response.status})`);
    try { return JSON.parse(response.text); } catch { throw new AssessmentError('database', 'Invalid study discovery response'); }
  }
  async next(lease: CatalogLease): Promise<DiscoveryStudy[]> {
    const result = await this.control('next', lease);
    if (!Array.isArray(result) || result.length > 2) throw new AssessmentError('database', 'Invalid discovery studies');
    return result.map(value => {
      const row = object(value); const source = object(row.source) as unknown as NormalizedEvidenceSource;
      validateSource(source);
      if (source.sourceType !== 'attribution_study') throw new AssessmentError('database', 'Discovery requires an attribution study');
      return { id: uuid(row.id), sourceId: uuid(row.sourceId), source };
    });
  }
  async record(lease: CatalogLease, lookup: StudyLookup) { await this.control('record', lease, lookup); }
  async pending(lease: CatalogLease, model: string): Promise<ClimateEvent[]> {
    const result = await this.control('pending', lease, { model });
    if (!Array.isArray(result) || result.length > 30 || !result.every(isClimateEvent)) throw new AssessmentError('database', 'Invalid study-matched events');
    return result;
  }
}
