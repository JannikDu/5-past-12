/** Small live provider diagnostic; synthetic evidence, no database writes. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessmentModelConfig } from '../src/server/config.ts';
import { AssessmentError, object } from '../src/domain/climate-assessment.ts';
import { draftPrompt, reviewPrompt } from '../src/services/assessment-prompts.ts';
import { parseDraft, parseReview, resolveClaims } from '../src/services/assessment-validation.ts';
import { event, citation } from '../tests/helpers/assessment-fixtures.ts';

const config = assessmentModelConfig(process.env);
const model = process.argv.find(a => a.startsWith('--model='))?.slice(8) || 'Qwen/Qwen3-32B';
const selected = process.argv.find(a => a.startsWith('--mode='))?.slice(7);
const probe = process.argv.includes('--probe');
const modes = ['baseline', 'json', 'json-no-thinking'] as const;
type Mode = typeof modes[number];
if (selected && !modes.includes(selected as Mode)) throw new Error('Unknown --mode');
const source = citation(1, { sourceType: 'scientific_report',
  content: 'Under conditions with available vegetation, higher temperatures can increase atmospheric evaporative demand and dry vegetation. This is a general physical mechanism; this passage provides no observations or attribution analysis for the Cedar Ridge Wildfire.' });
const input = { testOnly: 'Synthetic fixture, not real scientific evidence.', event: {
  title: event.title, location: event.location.label, observedAt: event.time.firstObservedAt, summary: event.summary,
}, passages: [{ chunkId: source.chunkId, sourceType: source.sourceType, content: source.content }] };
const results: Record<string, unknown>[] = [];
const outputDirectory = resolve('.devswarm-temp/featherless-json');
await mkdir(outputDirectory, { recursive: true });
const outputFile = resolve(outputDirectory, `responses-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const redact = (v: string) => v.replaceAll(config.apiKey, '[REDACTED]');
function safeContent(content: string): string {
  // Never publish private reasoning, even if this model embeds it in content.
  return redact(content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '[reasoning omitted]'));
}
async function generate<T>(mode: Mode, phase: string, system: string, data: unknown, validate: (v: unknown) => T, maxAttempts = 3): Promise<T | null> {
  let previousValidationFailure: string | undefined;
  let previousResponse: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    const body = { model, messages: [{ role: 'system', content: system }, { role: 'user',
      content: JSON.stringify({ ...input, data, previousValidationFailure, previousResponse }) }],
      temperature: 0.1, max_tokens: 1536,
      ...(mode !== 'baseline' ? { response_format: { type: 'json_object' } } : {}),
      ...(mode === 'json-no-thinking' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    };
    const record: Record<string, unknown> = { mode, phase, attempt, model,
      responseFormat: mode !== 'baseline', thinkingDisabled: mode === 'json-no-thinking',
      previousValidationFailure: previousValidationFailure ?? null };
    console.info(JSON.stringify({ mode, phase, attempt, state: 'requesting' }));
    let retry = false;
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(90000), headers: { Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json', 'X-Title': 'Five Past Twelve JSON diagnostic' }, body: JSON.stringify(body) });
      record.httpStatus = response.status;
      const raw = await response.text();
      if (!response.ok) {
        record.error = redact(raw.slice(0, 2000));
      } else {
        const envelope = JSON.parse(raw);
        const choice = envelope.choices?.[0];
        const content = choice?.message?.content;
        record.responseModel = envelope.model;
        record.finishReason = choice?.finish_reason;
        record.messageKeys = Object.keys(choice?.message ?? {});
        const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
        record.reasoningCharacters = typeof reasoning === 'string' ? reasoning.length : 0;
        record.usage = envelope.usage;
        record.content = typeof content === 'string' ? safeContent(content) : null;
        if (choice?.finish_reason !== 'stop') throw new Error(`Incomplete response: finish_reason=${choice?.finish_reason}`);
        if (typeof content !== 'string' || !content.trim()) throw new Error('Missing response content');
        // Validate original content; do not silently repair markdown or thinking tags.
        previousResponse = safeContent(content);
        let parsed: unknown;
        try { parsed = JSON.parse(content); record.jsonValid = true; }
        catch { record.jsonValid = false; throw new Error('Response content is not valid JSON'); }
        const result = validate(parsed);
        record.schemaValid = true;
        record.elapsedMs = Date.now() - startedAt;
        results.push(record);
        await writeFile(outputFile, JSON.stringify({ fixture: 'synthetic', results }, null, 2));
        console.info(JSON.stringify(record));
        return result;
      }
    } catch (error) {
      record.schemaValid = false;
      record.error = redact(error instanceof Error ? error.message : String(error));
      retry = error instanceof AssessmentError && error.code === 'validation'
        && error.message.startsWith('Missing required JSON fields:');
    }
    record.elapsedMs = Date.now() - startedAt;
    record.retryScheduled = retry && attempt < maxAttempts;
    results.push(record);
    await writeFile(outputFile, JSON.stringify({ fixture: 'synthetic', results }, null, 2));
    console.info(JSON.stringify(record));
    previousValidationFailure = String(record.error);
    if (!retry) break;
  }
  return null;
}
for (const mode of modes.filter(mode => !selected || mode === selected)) {
  if (probe) {
    // A 200 + JSON-looking answer alone cannot establish that JSON mode is enforced.
    await generate(mode, 'format-probe', 'Follow the user data.instruction exactly.',
      { instruction: 'Reply with exactly the word READY, as plain text, without JSON or quotation marks.' }, object, 1);
    continue;
  }
  const draft = await generate(mode, 'draft', draftPrompt, { instruction: 'Return one qualified general_mechanism claim supported by the supplied passage.' }, parseDraft);
  if (!draft) continue;
  await generate(mode, 'review', reviewPrompt, { draft }, value => {
    const review = parseReview(value);
    const assessment = resolveClaims(draft, review, event, [source]);
    if (assessment.claims.length !== 1 || assessment.humanInfluence !== 'none' || assessment.evidenceStrength !== 'low')
      throw new Error('Expected one mechanism claim, Human Influence none, Evidence Strength low');
    return review;
  });
}
console.info(JSON.stringify({ report: outputFile, attempts: results.length }));
