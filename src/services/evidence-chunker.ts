import { EvidenceError, type ChunkSpan, type ChunkingProfile } from '../domain/evidence.ts';

export class EvidenceChunker {
  readonly profile: ChunkingProfile;
  constructor(settings: Partial<Omit<ChunkingProfile, 'version'>> = {}) {
    this.profile = { version: 'codepoints-v1', size: 2400, overlap: 300, minSize: 400, ...settings };
    const { size, overlap, minSize } = this.profile;
    if (![size, overlap, minSize].every(Number.isInteger) || size < 1 || overlap < 0 || overlap >= size || minSize < 1 || minSize > size || overlap + minSize > size) {
      throw new EvidenceError('validation', 'Chunk sizes must be integers with 0 <= overlap < size and overlap + minSize <= size');
    }
  }
  chunk(text: string): ChunkSpan[] {
    if (!text.trim()) return [];
    const points = Array.from(text); const result: ChunkSpan[] = [];
    const { size, overlap, minSize } = this.profile;
    let start = 0;
    while (start < points.length) {
      let end = Math.min(start + size, points.length);
      if (end < points.length) {
        // Prefer paragraph, then sentence, then whitespace boundaries in the last third.
        const floor = start + Math.max(overlap + 1, Math.floor(size * 2 / 3));
        for (const boundary of [(i: number) => points[i - 1] === '\n' && points[i - 2] === '\n',
          (i: number) => /[.!?]/u.test(points[i - 2] ?? '') && /\s/u.test(points[i - 1] ?? ''),
          (i: number) => /\s/u.test(points[i - 1] ?? '')]) {
          let found = false;
          for (let i = end; i >= floor; i--) if (boundary(i)) { end = i; found = true; break; }
          if (found) break;
        }
        const remaining = points.length - end;
        if (remaining < minSize && points.length - start <= size) end = points.length;
        else if (remaining < minSize) end = Math.max(start + overlap + 1, points.length - minSize);
      }
      const content = points.slice(start, end).join('');
      if (content.trim()) result.push({ content, chunkIndex: result.length, start, end });
      if (end === points.length) break;
      start = Math.max(start + 1, end - overlap);
    }
    return result;
  }
}
