import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { citation, draft, event, id, review } from './helpers/assessment-fixtures.ts';
import { resolveClaims } from '../src/services/assessment-validation.ts';
import { assessmentVersion, type ClimateAssessment } from '../src/domain/climate-assessment.ts';

// Native Node transforms TypeScript, but not JSX. Compile the actual UI for SSR
// assertions with the project's existing compiler; leave artifacts in ignored temp.
const original = new URL('../src/components/ClimateAssessmentPanel.tsx', import.meta.url);
const source = (await readFile(original, 'utf8')).replace(/from '([^']+)'/g, (match, specifier: string) =>
  specifier.startsWith('.') ? `from '${new URL(specifier, original).href}'` : match);
const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const directory = new URL('../.devswarm-temp/assessment-tests/', import.meta.url); await mkdir(directory, { recursive: true });
const compiled = new URL(`panel-${process.pid}.mjs`, directory); await writeFile(compiled, output);
const { AssessmentContents, AssessmentState, evidenceGroups } = await import(compiled.href) as typeof import('../src/components/ClimateAssessmentPanel.tsx');
function assessment(): ClimateAssessment {
  return { ...resolveClaims(draft(), review(), event, [citation()]), id: id(500), eventId: event.id,
    summary: draft().claims[0].statement, immediateCause: null, climateConnection: draft().claims[0].statement,
    uncertainties: ['Ignition remains unknown.'], status: 'completed', assessedAt: '2026-10-08T00:00:00Z', model: 'fixture',
    assessmentVersion, eventFingerprint: 'a'.repeat(64), corpusFingerprint: 'b'.repeat(64) };
}
test('rendered panel prominently distinguishes influence and evidence with passages and links', () => {
  const html = renderToStaticMarkup(createElement(AssessmentContents, { assessment: assessment(), stale: false }));
  assert.match(html, /Human Influence/); assert.match(html, /Evidence Strength/); assert.match(html, /not quantified probabilities/);
  assert.match(html, /Direct Evidence/); assert.match(html, /Indirect Evidence/);
  assert.match(html, /Fixture scientific publisher/); assert.match(html, /https:\/\/example.org\/study/);
  assert.match(html, /<blockquote>/); assert.match(html, /Scientific Findings/); assert.match(html, /Uncertainties/);
});
test('indirect findings explicitly show missing attribution; dedup studies preserves findings', () => {
  const value = assessment(); value.humanInfluence = 'none'; value.evidenceStrength = 'low'; value.claims[0].type = 'general_mechanism';
  value.claims[0].citations[0].relation = 'general_context';
  value.claims.push({ ...value.claims[0], statement: 'Another qualified finding.', citations: value.claims[0].citations });
  assert.equal(evidenceGroups(value, false).length, 1); assert.equal(evidenceGroups(value, false)[0].findings.length, 2);
  const html = renderToStaticMarkup(createElement(AssessmentContents, { assessment: value, stale: true }));
  assert.match(html, /No direct event-specific attribution evidence was found in the available knowledge base\./);
  assert.match(html, /do not establish attribution for this specific event/); assert.match(html, /outdated/);
  assert.match(html, /Another qualified finding/); assert.match(html, /does not mean influence is physically absent/);
});
test('a publication spanning both relationships appears once and retains indirect qualifiers', () => {
  const value = assessment();
  value.claims.push({ ...value.claims[0], type: 'general_mechanism', statement: 'Contextual finding within the same study.',
    citations: [{ ...value.claims[0].citations[0], relation: 'general_context' }] });
  assert.equal(evidenceGroups(value, true).length, 1); assert.equal(evidenceGroups(value, true)[0].findings.length, 2);
  assert.equal(evidenceGroups(value, false).length, 0);
  const html = renderToStaticMarkup(createElement(AssessmentContents, { assessment: value, stale: false }));
  assert.match(html, /This contextual finding is indirect support/);
  assert.equal((html.match(/class="ca-source"/g) ?? []).length, 1);
});
test('every empty/failure lifecycle state displays unavailable labels without fabricated findings', () => {
  for (const kind of ['loading', 'unavailable', 'invalid_citations', 'generation_failed', 'error'] as const) {
    const html = renderToStaticMarkup(createElement(AssessmentState, { state: { kind } }));
    assert.match(html, /Human Influence/); assert.match(html, /Evidence Strength/); assert.match(html, /Unavailable/);
    assert.doesNotMatch(html, /Scientific Findings/);
  }
  const value = assessment(); value.claims = []; value.status = 'insufficient_evidence'; value.humanInfluence = 'none'; value.evidenceStrength = 'none';
  const html = renderToStaticMarkup(createElement(AssessmentContents, { assessment: value, stale: false }));
  assert.match(html, /Insufficient scientific evidence/); assert.match(html, /No direct event-specific/);
});
