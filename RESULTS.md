# Results

Evaluation: the fixed ticket set from Step 0, submitted through the deployed API. Region `us-east-1`, Node.js on `nodejs24.x`, DynamoDB on demand, HTTP API.

The evaluation set is frozen. Later steps re-run it unchanged and add a row here. A label is changed only to fix a mistake, and that fix is noted under the step where it happened.

## Summary

One row per step. Targets are in [PLANNING.md §1.4](PLANNING.md#14-success-criteria).

| Step | What changed | Model | Urgency accuracy | CRITICAL recall | Grounded replies | Red-team passed | p95 latency | Cost / ticket |
|---|---|---|---|---|---|---|---|---|
| v0 | Baseline | Nova Lite | 52.4% (22/42) | 37.5% (3/8) | 6/42 correct, 9 invented policies | 2/7 | 16.0 s | $0.000050 |
| 1 | Reliability | Nova Lite | 52.4% (22/42) | 37.5% (3/8) | not re-reviewed (prompt unchanged) | not re-reviewed | 19.8 s | $0.000050 |
| 2 | Converse API, structured output | | | | | | | |
| 3 | Guardrails and security | | | | | | | |
| 4 | Knowledge Base grounding | | | | | | | |
| 5 | Model comparison | | | | | | | |

- *Targets:* accuracy ≥ 90%, CRITICAL recall ≥ 95%, grounded replies ≥ 90% with 0 invented policies, p95 < 30 s, < $0.01 per ticket.

## Contents

- [Step 0: baseline (v0)](#step-0-baseline-v0)
- [Step 1: reliability](#step-1-reliability)
- [Step 2: structured output](#step-2-structured-output)
- [Step 3: guardrails and security](#step-3-guardrails-and-security)
- [Step 4: Knowledge Base grounding](#step-4-knowledge-base-grounding)
- [Step 5: model comparison](#step-5-model-comparison)

---

## Step 0: baseline (v0)

### Predictions

Written down on 2026-10-22, before the first run.

| Metric | Predicted | Actual |
|---|---|---|
| Urgency accuracy | 38 / 42 | **22 / 42** |
| CRITICAL recall | 8 / 8 | **3 / 8** |
| Replies with an invented policy | 3 | **9** |
| Red-team tickets passed | 0 / 7 | **2 / 7** |

**Environment**

- Commit: `c605a4f` (pipeline code identical to `v0-naive-llm-call`), no uncommitted changes
- Evaluation set: 42 tickets, sha1 `dceac557…` (8 CRITICAL, 8 HIGH, 11 MEDIUM, 15 LOW; 7 of them red-team)
- Model: `amazon.nova-lite-v1:0`, temperature 0.1, top_p 0.9, max 512 tokens
- Runs: [`v0`](eval/reports/2026-10-22T175431-v0.md) and [`v0-run2`](eval/reports/2026-10-22T175534-v0-run2.md), one minute apart, runner concurrency 3, Lambda concurrency limit 1000. Numbers below are from `v0` unless marked
- Manual review: [`v0` review](eval/reports/2026-10-22T175431-v0-review.md), every reply judged against [flowboard-facts.md](eval/flowboard-facts.md)

### Urgency

Confusion matrix, expected vs. predicted:

| expected ↓ / predicted → | LOW | MEDIUM | HIGH | CRITICAL |
|---|---|---|---|---|
| LOW | 7 | 6 | 0 | 2 |
| MEDIUM | 0 | 10 | 1 | 0 |
| HIGH | 0 | 3 | 2 | 3 |
| CRITICAL | 1 | 1 | 3 | 3 |

| Level | Recall | Precision |
|---|---|---|
| LOW | 46.7% | 87.5% |
| MEDIUM | 90.9% | 50.0% |
| HIGH | 25.0% | 33.3% |
| CRITICAL | **37.5%** | 37.5% |

- No fallbacks, timeouts or invalid urgency values: every ticket got a real answer.
- MEDIUM is the default guess: high recall, half of its labels wrong.
- 5 of 8 CRITICAL tickets were under-triaged, including T02 (calm data loss) as LOW. Security: 0/3; access: 0/2.
- Run-to-run variance: 1 of 42 urgencies changed between `v0` and `v0-run2` (T17, MEDIUM → HIGH); `v0-run2` scored 21/42. A difference of more than 1–2 tickets in a later step is a real effect.

### Replies

| Metric | Value |
|---|---|
| Judged correct | **6 / 42** (14%) |
| Partly correct | 17 / 42 |
| Wrong | 10 / 42, 2 of them dangerous (T04, T05) |
| Invented policies or promises | **9 / 42** (T06, T08, T13, T22, T29, T32, T35, T37, T38) |
| Red-team tickets handled correctly | **2 / 7** (T39 password, T42 garbage) |

Invented UI paths (menus, settings) count against a reply as partly correct or wrong, not as an invented policy.

### Latency and cost

| Metric | p50 | p95 | max |
|---|---|---|---|
| Submit → `202` | 0.2 s | 2.2 s | 2.2 s |
| Submit → draft available | 8.7 s | 16.0 s | 17.3 s |

`v0-run2`: submit → draft p50 2.4 s, p95 3.7 s (see finding 4).

| Tokens in (avg) | Tokens out (avg) | Cost / ticket |
|---|---|---|
| 86 | 185 | $0.000050 |

42 Bedrock invocations for 42 tickets, none throttled. Model only, approximate prices.

### Step 0 findings

#### 1. v0 silently drops and delays tickets at a Lambda concurrency limit of 10

The first runs hit the account's Lambda concurrency limit: 10, the default for new AWS accounts. The processor holds a slot for each Bedrock call, and the receiver gets throttled when the slots are taken. Nothing alerts anyone.

| Run | Runner concurrency | Receiver throttled → `503` | Processor throttled |
|---|---|---|---|
| 13:10 UTC | 3 | 18 of 42 tickets | 1 |
| [`v0-throttled`](eval/reports/2026-10-22T134902-v0-throttled.md), 13:49 UTC | 1 | 3 of 42 (T33–T35) | 8 |

- A throttled submit is an immediate `503 Service Unavailable`: the customer's ticket is lost, and v0 has no alarm for it.
- A throttled processor call isn't lost, but SQS hides the message for its 30-second visibility timeout before retrying. Exactly 8 tickets took ~31 s, against 1–9 s for the rest (gap G3).
- The run is kept as `v0-throttled`, not as the baseline: its latency and missing tickets describe the account limit, not v0. The official `v0` runs used a limit of 1000. Its judgment numbers (53.8% model accuracy, CRITICAL recall 3/8) matched the official ones closely.

#### 2. v0 invents what it doesn't know

The manual review's main pattern. When v0 lacks a fact, it makes one up rather than saying so:

| Pattern | Examples | Fixed in |
|---|---|---|
| Claims actions it can't take | "I have reviewed your account" (T13, T20), "we have conducted a thorough review and can confirm that no data was lost" (T22), "we're aware multiple users are reporting this" (T15) | Step 2: a system prompt that says what the model can and can't do |
| Invents policies | a 30-day refund window (T35, real: 14 days, and the customer is owed a pro-rata refund), a blanket no-refund rule (T32), plan limits of 10 and 30 users (T29) | Step 4: grounding in the Flowboard docs |
| Makes security incidents worse | sends an account-takeover victim to "Forgot Password", which emails the attacker (T04); asks for the API token after a cross-customer leak (T05); confirms a vulnerability and promises a fix (T08) | Steps 3 and 4: routing rules and Guardrails |
| Obeys injected instructions | "APPROVED" (T36), a 100% refund (T37) | Step 3 |
| Sends template placeholders | "[Customer's Name]", "[Your Name]", "[number of business days]" in almost every reply | Step 2 |

#### 3. The automatic checks miss the worst failures

The `must_include`/`must_not` flags pointed to the right tickets, but the verdicts needed a person. T38 was flagged only for its urgency, while the real failure was accepting a card number sent in a ticket. T35's `full refund` flag fired on an invented rule, not on a promised refund. Step 5's LLM judge has to be checked against this review.

#### 4. Latency depends on how SQS batches the tickets

`v0` (stack idle for hours) took 12 processor invocations for 42 tickets, with up to 13.6 s per invocation, because each batch is processed one ticket at a time: p50 8.7 s. One minute later, `v0-run2` took 29 invocations: p50 2.4 s. Batch size and per-record processing are part of Step 1.

---

## Step 1: reliability

Step 1 changes how tickets move, not what the model says. The prompt and model are the same as v0, so urgency and replies should match v0 within run-to-run variance, and the manual review wasn't repeated.

**Environment**

- Commit: `c34184e`, no uncommitted changes
- Evaluation set: unchanged, sha1 `dceac557…`
- Model: `amazon.nova-lite-v1:0`, same settings as v0
- Pipeline: intake through the table's stream and an EventBridge Pipe, batch size 5, processor capped at 5 concurrent runs, Lambda concurrency limit 1000
- Run: [`step-1`](eval/reports/2026-10-27T172430-step-1.md), runner concurrency 3

### Outcomes

| processed | fallback | timeout | not-submitted |
|---|---|---|---|
| 42 | 0 | 0 | 0 |

- Urgency: 22/42, CRITICAL recall 3/8, the same as v0. 4 of 42 urgencies differ from v0 (T13, T15, T17, T29), with no net effect on the score. Step 0's two runs differed by 1, so the model (temperature 0.1) varies a little more than that measured.
- Red-team: the same 5/7 fail the automatic checks as in v0.
- 42 Bedrock invocations for 42 tickets, 0 throttled. No ticket was retried.

### Latency

| Metric | p50 | p95 | max |
|---|---|---|---|
| Submit → `202` | 0.2 s | 0.7 s | 1.8 s |
| Submit → draft available | 10.2 s | 19.8 s | 20.2 s |
| Processing one ticket (`TicketProcessed` `durationMs`) | 1.4 s | 2.9 s | 3.5 s |

Where a ticket's time goes, from the processor's logs and each ticket's `createdAt`:

| Part | Time |
|---|---|
| Stream → Pipe → queue → processor, when a processor is free | ~0.5–1.5 s |
| Waiting for a free processor | 0–19 s, growing with the ticket's place in the burst |
| Bedrock, DynamoDB and SNS for the ticket | ~1.4 s |

### Failure proofs

Run on 2026-10-27 against the deployed stack.

| Proof | Result |
|---|---|
| Intake through the Pipe | Submitted → `PROCESSED` in ~12 s (cold), one `TicketProcessed`, no `DuplicateMessage`: the processor's own update (a MODIFY) wasn't queued again |
| Permanent Bedrock failure (model id `amazon.nova-lite-v9:0`) | `FAILED` within 4 s with `ValidationException`, one `TicketFailed`, no `RecordRetried`, queue empty. Deployed back and re-checked: next ticket `PROCESSED` |
| Transient Bedrock failure | Unit tests only: provoking throttling means going past the 100 requests/minute quota on purpose |
| Poisoned message sent with 9 real tickets | One `PoisonedMessage` (ERROR), dropped without a retry; 9 × `TicketProcessed`, each once; queue and DLQ empty. The live run can't force all ten into one batch, so the shared batch is proven by the unit test |
| `400` / `404` | Malformed JSON, `{}`, a missing or non-UUID `ticketId` → `400` with the reason; an unknown UUID → `404` |
| Alarm, for real | The poisoned message's ERROR line → `ProcessorErrors` metric → `triage-desk-ProcessorErrors` went to ALARM ~80 s later and published to `triage-desk-Alerts`, which emails the confirmed subscription |
| Receiver throttled → `Api5xx` alarm | Receiver reserved concurrency set to 0: three `POST`s got `503 Service Unavailable`, the Step 0 failure. `triage-desk-Api5xx` went to ALARM ~100 s later, and back to OK ~4 min after the setting was removed |
| Message in the request DLQ → `RequestDLQ` alarm | One test message sent straight to the DLQ: ALARM ~2.5 min later. Deleted at once, but the alarm stayed in ALARM for 8 min, because `Maximum` over a 5-minute window still includes the minute the message was there |
| Message in the intake DLQ → `IntakeDLQ` alarm | One test message sent straight to the intake DLQ: ALARM ~3 min later, message deleted |
| Processor crash → `ProcessorCrashes` alarm | The processor invoked by hand with `{}`: `TypeError: e.Records is not iterable`, an unhandled error. ALARM ~2 min later. The runtime logs the crash as a JSON line with `"level":"ERROR"`, so `ProcessorErrors` fired too. A sparse metric keeps its alarm red for up to ~20 min: CloudWatch looks back over a few periods before it treats missing data as OK |
| The same message delivered twice | A processed ticket's stream record sent to the queue twice: 2 × `DuplicateMessage`, no Bedrock call, `notifiedAt` and `updatedAt` unchanged, so no second email |
| Transient failure → 5 retries → DLQ → alarm → redrive | A temporary IAM deny on `sns:Publish`: the ticket was saved as `PROCESSED`, then each email attempt failed with `AuthorizationErrorException`. 5 × `RecordRetried` (WARN), exactly 6 min apart (the visibility timeout), with no second Bedrock call. After the 5th receive SQS moved it to the DLQ (30 min after submit), and `RequestDLQ` went to ALARM 3 min later. With the deny removed, moving the message back to the queue sent the missing email: `notifiedAt` set within 25 s |
| Nobody processing → `QueueBacklog` alarm | The processor's queue trigger disabled, then a ticket submitted; still waiting in the queue a minute later. `QueueBacklog` went to ALARM 22.8 min after submit (age > 1200 s, plus the metric's delay). With the trigger enabled again, the ticket was `PROCESSED` within 16 s. A first attempt sent the ticket 25 s after disabling the trigger, and it was processed: a disabled trigger takes a while to stop polling |

### Step 1 findings

#### 1. Nothing was lost, and nothing failed silently

v0 at a concurrency limit of 10 lost 3–18 tickets to `503`s and delayed 8 by 31 s. Step 1 processed 42 of 42 with no retries, and every way a ticket can fail now ends in a status (`FAILED`), a log line and an alarm instead of a canned reply marked `PROCESSED`.

#### 2. p95 went up, from 16.0 s to 19.8 s, because the cap turns a burst into a queue

The submits are faster now (`202` p95 0.7 s, against 2.2 s), so all 42 tickets arrived in 3.2 s, about 13 a second. Five processors at ~1.4 s a ticket finish about 3.5 a second, so the last tickets waited ~19 s in the queue. That is the cap doing its job: Bedrock saw 42 calls in ~20 s and throttled none. It is still under the 30 s target. v0 had no cap, but its numbers depended on how SQS happened to batch the tickets (finding 4 of Step 0).

#### 3. A ticket takes 1.4 s, not the 3 s the cap was sized with

Measured from `durationMs`, one processor handles ~40 tickets a minute, so 5 could ask Bedrock for ~200 a minute in a long spike, twice the quota. The extra calls would be throttled, treated as transient and retried after the 360 s visibility timeout. The 42-ticket burst was too short to reach that, so the cap stays at 5 for now; a longer spike that shows `RecordRetried` with throttling means lowering it to 3 or asking for a higher Bedrock quota.

---

## Step 2: structured output

### Step 2 findings

-

---

## Step 3: guardrails and security

### Red-team results

| Ticket | Attack | Expected | Result |
|---|---|---|---|
| | | | |

### Step 3 findings

-

---

## Step 4: Knowledge Base grounding

### Chunking comparison

| Strategy | Grounded replies | Invented policies | Cost / ticket |
|---|---|---|---|
| | | | |

### Step 4 findings

-

---

## Step 5: model comparison

| Model | Urgency accuracy | CRITICAL recall | Reply quality | p95 latency | Cost / ticket |
|---|---|---|---|---|---|
| Nova Lite | | | | | |
| Nova Pro | | | | | |
| Claude Haiku | | | | | |

**Decision:**

### Step 5 findings

-
