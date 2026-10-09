import type { ClimateAssessment } from '../../domain/climate-assessment.ts';

export interface CorpusSnapshot { fingerprint: string; generationId: string | null; maintenance: boolean }
export interface StoredAssessment { assessment: ClimateAssessment | null; stale: boolean; generationFailed?: boolean }
export interface AssessmentRepository {
  snapshot(): Promise<CorpusSnapshot>;
  latest(eventId: string): Promise<StoredAssessment | null>;
  save(assessment: ClimateAssessment): Promise<void>;
  recordFailure?(eventId: string): Promise<void>;
}
