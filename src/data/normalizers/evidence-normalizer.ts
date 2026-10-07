import type { NormalizedEvidenceSource } from '../../domain/evidence.ts';
export interface EvidenceNormalizer<TRaw> {
  normalize(raw: TRaw): Promise<NormalizedEvidenceSource | null>;
}
