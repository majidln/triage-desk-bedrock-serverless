# Step 2 Guide: The Model Answers in Prose, and We Parse It with a Regex

This guide coaches you rather than handing over code. It says what to build and why; you write the TypeScript and the YAML.

**Goal (from [PLANNING.md](../PLANNING.md)):** the model's answer is a contract, not a request in the prompt. The output is checked against a schema, the model is a parameter, and every ticket knows what it cost.

**The point: if the shape of the answer matters, enforce it with a schema, not with a sentence in the prompt.**

This step doesn't try to make the answers *better*. Grounding is Step 4 and model choice is Step 5. Urgency accuracy may move a little because the output format changes; the Step 0 run-to-run variance tells you whether it's real.

---

## 1. What's wrong today

All of it lives in [triage-model.ts](../lambdas/shared/triage-model.ts), which Step 1 kept separate for exactly this step.

| Today | Why it hurts |
|---|---|
| `InvokeModel` with a Nova-specific body (`max_new_tokens`, `output.message.content[0].text`) | Swapping to Claude or another model means rewriting the request and the response parsing |
| The JSON format is asked for in the prompt | The model can add prose, wrap it in markdown, or rename a field |
| A regex pulls out `{…}` (G6) | Works until the reply itself contains a brace |
| Token counts come from account-wide CloudWatch metrics | No cost per ticket, and the evaluation can't share the model with anything else |

---

## 2. The Converse API

`ConverseCommand` is one request and response shape for every Bedrock model.

- `messages`, an optional `system` prompt, and `inferenceConfig` (`maxTokens`, `temperature`, `topP`) are the same whatever the model.
- The response has `output.message.content`, `stopReason` and **`usage`** (`inputTokens`, `outputTokens`).
- IAM: Converse is authorized by `bedrock:InvokeModel`, so the policy action doesn't change.

Question to settle: does anything model-specific remain? If it does, write down where and why.

---

## 3. The answer is a tool call

Instead of asking for JSON in prose, describe the answer as a **tool** with a JSON schema, and force the model to call it.

- `toolConfig.tools`: one tool, say `record_triage`, with an `inputSchema` holding `urgency` (an `enum` of the four values) and `response` (a string). Mark both `required`.
- `toolConfig.toolChoice: { tool: { name: 'record_triage' } }` forces that tool. Check that every model you plan to use supports a forced tool choice; if one doesn't, `any` is the fallback.
- The answer is now the `toolUse.input` block in the response content: an object, not text. No `JSON.parse`, no regex.
- Move the instructions into `system`, and keep the ticket in the user message. It isn't the Step 3 prompt-injection work yet, but it's the start of it.

Think about `stopReason`: what does `max_tokens` mean for a half-written tool call?

---

## 4. Validate anyway

A schema in the request is a strong hint, not a guarantee. Check `toolUse.input` before trusting it.

- Same rules as today's `parseModelAnswer`: urgency in the enum, response a non-empty string.
- A small hand-written check is enough for two fields. A library like `zod` earns its place only if it also produces the tool's schema, so the two can't drift apart.
- A missing tool call or an invalid input is still a `PermanentError`. Step 1's failure handling doesn't change.

---

## 5. The model is a parameter

**Exit criterion:** switching the model is a parameter change only.

- Add a `ModelId` parameter to `template.yaml` and feed it to `BEDROCK_MODEL_ID` and to the IAM resource. The ARN is hardcoded today.
- Some models, Claude Haiku and the newer Nova models included, are called through a **cross-region inference profile** (`us.…` ids). The policy then needs the profile ARN *and* the foundation model in each region it can route to.
- **Proof:** deploy once with a second model (`sam deploy --parameter-overrides ModelId=…`), process a ticket, then deploy back. Only the parameter changes, no code.

---

## 6. Tokens and cost per ticket

- Store `usage.inputTokens` and `usage.outputTokens` with the triage, plus the `modelId` that answered.
- Cost: keep the per-million-token prices next to the model ids (one small table in code or config), and store the computed cost too. Prices change; record the price you used.
- Log them on `TicketProcessed` as well, so Logs Insights can sum cost by day.
- **Evaluation:** read tokens and cost from the tickets instead of CloudWatch. Keep the CloudWatch numbers for this run and compare: they should agree.

---

## 7. Tests

In `lambdas/tests/unit/`, mocking `ConverseCommand` with `aws-sdk-client-mock`:
- A `toolUse` with valid input → the triage, with tokens and cost.
- An urgency outside the enum, or an empty response → `PermanentError`.
- A text answer with no `toolUse` → `PermanentError`.
- `stopReason: max_tokens` → whatever you decided in section 3.
- The request: `toolChoice` names the tool, and the ticket text is in the user message, not in `system`.

---

## 8. Suggested order

1. Converse with a forced tool call in `triage-model.ts`, and its tests
2. Validation, then tokens and cost on the triage
3. Processor stores the new fields; `npm test` green
4. `ModelId` parameter and IAM; deploy
5. The proofs, then `npx tsx run.ts --label step-2`
6. `git tag step-2-complete`

---

## 9. Definition of done

- [ ] No regex and no `JSON.parse` of model text; the output is validated against the schema.
- [ ] A second model deployed and used by changing only the `ModelId` parameter.
- [ ] Input/output tokens, model id and cost stored on every processed ticket.
- [ ] Unit tests for the above; `npm test` green.
- [ ] Evaluation re-run, `step-2` row and findings in [RESULTS.md](../RESULTS.md).
- [ ] Tagged `step-2-complete`.

*Free at rest. The second-model proof costs a few cents.*
