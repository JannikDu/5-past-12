import { AssessmentError, hash, object, parseAssessment, uuid, type ClimateAssessment } from '../../domain/climate-assessment.ts';
import { EvidenceHttpClient, type HttpOptions } from '../http.ts';
import type { AssessmentRepository, CorpusSnapshot } from './assessment-repository.ts';

export class SupabaseAssessmentRepository implements AssessmentRepository {
  private readonly http: EvidenceHttpClient;
  constructor(private readonly config: { url: string; secretKey: string }, options: HttpOptions = {}) {
    this.http = new EvidenceHttpClient({ ...options, maxBytes: options.maxBytes ?? 512 * 1024 });
  }
  private async rpc(name: string, input: unknown): Promise<unknown> {
    const response = await this.http.request(`${this.config.url}/rest/v1/rpc/${name}`, { method: 'POST', redirect: 'error',
      headers: { apikey: this.config.secretKey, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!response.status || response.status < 200 || response.status >= 300) {
      throw new AssessmentError(response.text.includes('assessment:conflict') ? 'conflict' : 'database', `Assessment database operation failed (${response.status})`);
    }
    if (!response.text.trim()) return null;
    try { return JSON.parse(response.text); } catch { throw new AssessmentError('database', 'Invalid assessment database response'); }
  }
  async snapshot(): Promise<CorpusSnapshot> {
    const r = object(await this.rpc('climate_assessment_snapshot', {}));
    if (typeof r.maintenance !== 'boolean') throw new AssessmentError('database', 'Invalid corpus state');
    return { fingerprint: hash(r.fingerprint), generationId: r.generationId === null ? null : uuid(r.generationId), maintenance: r.maintenance };
  }
  async latest(eventId: string) {
    const value = await this.rpc('climate_assessment_latest', { event_id: eventId }); if (value === null) return null;
    const r = object(value); if (typeof r.stale !== 'boolean') throw new AssessmentError('database', 'Invalid stale flag');
    if (typeof r.generationFailed !== 'boolean') throw new AssessmentError('database', 'Invalid generation status');
    return { assessment: r.assessment === null ? null : parseAssessment(r.assessment), stale: r.stale, generationFailed: r.generationFailed };
  }
  async save(assessment: ClimateAssessment) { await this.rpc('climate_assessment_save', { payload: parseAssessment(assessment) }); }
  async recordFailure(eventId: string) { await this.rpc('climate_assessment_failed', { event_id: eventId }); }
}
