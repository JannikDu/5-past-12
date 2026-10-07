import { htmlText } from './normalizers/evidence-text.ts';

/** Raw source contract shared by WWA fetching and normalization. */
export interface WwaPublication {
  guid: string; url: string; title: string; html: string; publishedAt: string | null;
  updatedAt: string | null; categories: string[]; region: string | null;
  fullArticle?: boolean;
  eventStart?: string | null; eventEnd?: string | null;
}

export function eligibleWwa(title: string, categories: string[], html: string): boolean {
  if (/\b(recruitment|vacancy|vacancies|hiring|fundraising|job opportunity|job opening)\b/i.test(title)) return false;
  return /\b(heat|heatwaves?|temperatures?|droughts?|rainfall|floods?|storms?|wildfires?|fire weather|warming|cold|geohazards?|attribution)\b/i.test(`${title} ${categories.join(' ')}`) &&
    /\b(climate|warming|weather|temperature|attribution)\b/i.test(htmlText(html) || title);
}
