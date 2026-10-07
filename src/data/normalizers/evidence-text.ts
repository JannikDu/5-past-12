import { parseHTML } from 'linkedom';
import { EventCategory } from '../../domain/climate-event.ts';

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\t \u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function htmlText(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const element of document.querySelectorAll('script,style,nav,header,footer,aside,button,figure,.more-link,.screen-reader-text,.wp-block-buttons')) element.remove();
  const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'TD', 'TR', 'DIV', 'SECTION', 'ARTICLE']);
  function text(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    const content = [...element.childNodes].map(text).join('');
    return blockTags.has(element.tagName) ? `\n\n${content}\n\n` : content;
  }
  return normalizeText([...document.body.childNodes].map(text).join(''));
}
const hazards: Record<string, EventCategory> = {
  wildfire: EventCategory.Wildfire, wildfires: EventCategory.Wildfire, 'fire weather': EventCategory.Wildfire,
  storm: EventCategory.Storm, 'tropical cyclone': EventCategory.Storm, storms: EventCategory.Storm, 'severe storm': EventCategory.Storm,
  flood: EventCategory.Flood, floods: EventCategory.Flood, flooding: EventCategory.Flood, 'extreme rainfall': EventCategory.Flood,
  drought: EventCategory.Drought, droughts: EventCategory.Drought,
  heat: EventCategory.Heat, 'extreme heat': EventCategory.Heat, heatwave: EventCategory.Heat, 'heat wave': EventCategory.Heat,
  'ocean heat': EventCategory.Temperature, 'temperature extremes': EventCategory.Temperature,
  cold: EventCategory.Temperature, 'cold spell': EventCategory.Temperature, 'cold spells': EventCategory.Temperature, 'extreme cold': EventCategory.Temperature,
  landslide: EventCategory.Landslide, snow: EventCategory.Snow,
};
export function eventTags(labels: string[]): EventCategory[] {
  return [...new Set(labels.map(label => hazards[label.trim().toLowerCase()]).filter(Boolean))];
}
/** Explicit subject terms in a WWA headline can supplement missing categories. */
export function headlineEventTags(title: string): EventCategory[] {
  const labels = Object.keys(hazards).filter(label => new RegExp(`\\b${label}s?\\b`, 'i').test(title));
  if (/\b(ocean temperatures?|marine heatwaves?|sea.surface temperatures?)\b/i.test(title)) labels.push('ocean heat');
  // Ocean heat and cold subjects must not gain an unsupported extreme-heat tag.
  if (/\b(ocean heat|cold|temperature extremes|ocean temperatures?|marine heatwaves?|sea.surface temperatures?)\b/i.test(title)) return eventTags(labels.filter(label => !['heat', 'extreme heat', 'heatwave', 'heat wave'].includes(label)));
  return eventTags(labels);
}
export function dateOrNull(date: string | null | undefined): string | null {
  if (!date?.trim()) return null;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
