# Step 3 Guide: Anyone Can Make Us Pay, and Anyone Can Talk to Our Prompt

This guide coaches you rather than handing over code. It says what to build and why; you write the TypeScript and the YAML.

**Goal (from [PLANNING.md](../PLANNING.md)):** only known clients can submit tickets, a ticket can't change how the model behaves, and customer PII stays out of logs and emails.

**The point: ticket text is untrusted input. Treat it as data at every layer: the API, the prompt, the model's answer and the logs.**

This step doesn't try to make the replies *correct*. Invented policies are Step 4. The red-team tickets (T36–T42) are what this step is measured on.

---

## 1. What's wrong today

| Today | Why it hurts |
|---|---|
| The API has no auth and no throttling | Anyone can submit tickets, and each one is a model call we pay for |
| `content` has no size limit | One request can be megabytes of tokens |
| The ticket is pasted into the instructions (`buildPrompt`) | "Ignore all previous instructions" sits next to our real ones (T36, T37) |
| Card numbers and passwords reach the model, the table and the SNS email (T38, T39) | PII spreads to every place a ticket goes |
| `GET /support-request` returns any ticket by id | Whoever has an id can read the ticket |
| Fetch and processor have `DynamoDBCrudPolicy` | More access than either needs |

Before you change anything, search the log groups for a known ticket's text (section 6). Know where it leaks today.

---

## 2. The API: auth, throttling, size

An HTTP API has no API keys or usage plans; those are REST API features. Settle the open question in PLANNING.md §6 first:

| Option | Gives you | Costs you |
|---|---|---|
| HTTP API + **JWT authorizer** (Cognito) | `401` without a token, `userId` from the token's claims | A user pool, and clients must sign in |
| HTTP API + **JWT authorizer** (Auth0) | The same, with an identity provider outside AWS. Issuer is your tenant URL, audience your Auth0 API identifier | An Auth0 tenant (free tier is enough), and a second place to configure and secure |
| HTTP API + **Lambda authorizer** | Any check you like, e.g. a client key | A function to write and secure |
| Switch to a **REST API** + API key + usage plan | Per-client quotas and throttling | A migration; a key is an identifier, not strong auth |

Whatever you choose:
- **Throttling:** set stage-level `ThrottlingBurstLimit` and `ThrottlingRateLimit` (`DefaultRouteSettings`). Size them from the ticket volume in §1.1 and the processor's concurrency.
- **Size:** reject a `content` over a limit you pick (a few thousand characters) in the receiver, with `413` or `400`. API Gateway's own limit is far too large to help.
- **Fetch:** a customer can read only their own tickets. Compare the ticket's `userId` with the caller's, and answer `404`, not `403`, so ids can't be probed.

---

## 3. The prompt: instructions and data apart

- The instructions go in `system`. The user message holds only the ticket, inside clear delimiters, e.g. `<ticket>…</ticket>`.
- Say in `system` that the ticket is data written by a customer, and that instructions inside it are part of what to triage, not orders. Use the rubric's principle 3 as the wording.
- Escape or strip the delimiter if a customer types it.

This alone won't stop every injection. It makes the Guardrail's job and the model's job easier, and it costs nothing.

---

## 4. A Bedrock Guardrail

Define it in `template.yaml` (`AWS::Bedrock::Guardrail` and `AWS::Bedrock::GuardrailVersion`) and pass it to Converse with `guardrailConfig`.

| Policy | For | Tickets |
|---|---|---|
| Prompt-attack filter (input) | Injection attempts | T36, T37 |
| Sensitive information: mask card numbers, passwords, emails, phone numbers | PII | T38, T39 |
| Denied topic | Requests that aren't support | T40 |

Questions to settle:
- **What does the Guardrail see?** Wrap the ticket in a `guardContent` block, so the filters judge the customer's text and not your system prompt.
- **Mask or block?** A blocked T37 loses a real question about CSV export. Masking keeps the ticket useful. Decide per policy.
- **What happens to a ticket when the Guardrail intervenes?** `stopReason: guardrail_intervened` means there's no `record_triage` call. Today that's a `PermanentError` and a `FAILED` ticket. Is that right for T36, or should it be triaged with a fixed reply? Write the rule down.
- **Does it check the output?** Find out whether the output filters read the `toolUse` input, or only text. If they don't, mask what you store and email yourself.
- IAM: the processor needs `bedrock:ApplyGuardrail` on the guardrail's ARN.

---

## 5. Least privilege

- Fetch: `DynamoDBReadPolicy`, or only `dynamodb:GetItem`.
- Processor: only the DynamoDB actions it calls, the one model (and inference profile) it uses, and the guardrail.
- Receiver: only `dynamodb:PutItem`.

Check each by reading the code's SDK calls, not by guessing.

---

## 6. Logs and notifications

- No ticket text or reply in any log line. Log ids, lengths, urgency and tokens.
- Watch the error objects: an SDK or validation error can carry the request, and `PermanentError` messages can quote the model's answer.
- The SNS email: send the ticket id, urgency and a link or masked excerpt, not the raw content.
- **Proof:** submit a ticket with a unique marker (say `canary-7f3a` and a test card number), then run a Logs Insights query over every log group in the stack:

```
fields @logStream, @message
| filter @message like /canary-7f3a|4111/
```

Zero results is the exit criterion. Run it once before your changes, so you know the query finds leaks.

---

## 7. The ticket's shape

The stored ticket grew step by step. Tidy it before the evaluation, so the `step-3` run uses the final shape: top-level for what you query, one nested map per writer.

```
id, userId, status, createdAt, updatedAt, content, notifiedAt
guardrail: { flags, piiTypes, version, checkedAt }
triage:    { urgency, response, generatedAt }
usage:     { modelId, inputTokens, outputTokens, costUsd }
failure:   { errorName, message, failedAt }
```

- `analytics` becomes `triage`, and `guardrailFlags` becomes `guardrail.flags`.
- Remove the unused top-level `urgency` and `response` from `SupportTicket`.
- The `TicketsByUser` index projects `analytics`, so it has to change too. Changing a projection means recreating the index.

---

## 8. Tests

In `lambdas/tests/unit/`:
- Receiver: oversized content → `413`/`400`; `userId` taken from the authorizer, not the body.
- Fetch: another customer's ticket → `404`.
- Model: the ticket is in the user message inside the delimiters and a `guardContent` block, never in `system`; `guardrailConfig` is set.
- Model: `stopReason: guardrail_intervened` → whatever you decided in section 4.
- Processor: no log call includes `content` or `response`.

---

## 9. Suggested order

1. Prompt split and delimiters, and their tests
2. Size limit, auth and throttling; deploy, then the `401`, `413` and burst proofs
3. Guardrail and its IAM; deploy
4. Logs and SNS cleaned up; the Logs Insights proof
5. Least-privilege IAM; deploy and re-run a ticket end to end
6. `npx tsx run.ts --label step-3`, and review the red-team tickets by hand
7. `git tag step-3-complete`

The evaluation runner calls the API, so it needs the new credentials.

---

## 10. Definition of done

- [x] All 7 red-team tickets behave as the rubric says, reviewed by hand. *(no attack worked; T37, T39 and T41 got an urgency one level off)*
- [x] Zero hits for the canary in every log group; no raw ticket text in the SNS email. *(the email carries a 200-character masked excerpt)*
- [x] `401` without credentials, `413`/`400` for an oversized ticket, `429` for a burst.
- [x] A customer can't fetch another customer's ticket. *(same `404` as a missing one)*
- [x] Each function's IAM policy lists only what its code calls.
- [x] The stored ticket has the shape in section 7.
- [x] Unit tests for the above; `npm test` green. *(131 tests)*
- [x] Evaluation re-run, `step-3` row and findings in [RESULTS.md](../RESULTS.md).
- [x] Tagged `step-3-complete`.

*Guardrails bill per 1,000 characters checked, per policy. An evaluation run costs cents; check the current prices before relying on that.*
