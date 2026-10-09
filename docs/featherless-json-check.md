# Featherless JSON diagnostic

Run the isolated live test with the existing `FEATHERLESS_API_KEY` in `.env`:

```sh
pnpm climate:check-json
pnpm climate:check-json --mode=json
pnpm climate:check-json --probe
```

The default model is `Qwen/Qwen3-32B`; override with `--model=<model-id>`.
The test uses one short, explicitly synthetic mechanism passage and the existing
assessment draft/review validators. It makes no database writes and does not
change the production assessment integration. Zod is not installed in this project.

Final response content, HTTP status, finish reason, validation result and timing
are saved under `.devswarm-temp/featherless-json/`. API credentials and private
reasoning are excluded. Requests have a 90-second timeout and 1,536 output tokens.

## Live observations on 2026-10-08

| Request | Draft | Review |
| --- | --- | --- |
| Prompt requesting JSON, no JSON mode | Valid JSON and schema on first attempt | Passed |
| `response_format: { type: 'json_object' }` | Valid JSON; first response added `previousReview` and `previousValidationFailure`, violating the strict schema | Passed after draft repair |
| JSON mode plus `chat_template_kwargs: { enable_thinking: false }` | Valid JSON and schema on first attempt | Passed |

The initial experiment repaired the extra-field response before the retry policy
was restricted. The current diagnostic retries **only missing required JSON
fields**, with the exact missing-field error and previous final answer, up to
three total attempts per phase. Extra fields, malformed JSON, wrong values,
scientific rejection, timeouts and HTTP errors do not trigger retries. The final
integration discards unknown fields and validates all required fields; discarded
model metadata and reasoning never enter the domain output.

A follow-up JSON-mode run using the restricted policy passed both draft and
review on their first attempt (two API calls total).

A separate format probe asked for the plain word `READY`. Without JSON mode,
the model returned `READY`. Both JSON-mode variants returned JSON objects even
though plain text was requested, providing evidence that the format option affects
output for this model and endpoint. One actual response was:

```json
{"error":"The response must be exactly the word READY, as plain text, without JSON or quotation marks."}
```

The validated mechanism assessment had Human Influence `none` and Evidence
Strength `low`. Its review cited `general_context` and did not establish direct
event attribution. Passing this small diagnostic verifies formatting and basic
schema handling; it does not establish scientific reliability or successful
processing of the full evidence context. The baseline also added ignition wording
absent from the supplied passage, which the model review accepted; JSON mode cannot
prevent unsupported scientific additions.

Provider references: [chat completions](https://featherless.ai/docs/completions)
and [chat template kwargs](https://featherless.ai/docs/chat-template-kwargs).

## Integration follow-up

The larger prompt produced a syntactically valid response with 22 citations on
one claim. It was rejected without automatic retry. A tiny subsequent probe using
`response_format: { type: 'json_schema', json_schema: { name: 'probe', strict: true,
schema: ... } }` required `{"answer":"READY"}` and disallowed extra keys. Despite
instructions asking for a different answer and an extra key, the provider returned
HTTP 200 and exactly `{"answer":"READY"}`. The service therefore uses JSON Schema
constraints for the real draft/review calls, while retaining the runtime and
scientific checks. The small comparison script still tests JSON-object mode.
