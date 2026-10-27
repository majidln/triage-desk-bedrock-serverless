# Step 1 Guide: It Said PROCESSED, but Bedrock Failed

This guide coaches you rather than handing over code. It says what to build and why; you write the TypeScript and the YAML.

**Goal (from [PLANNING.md](../PLANNING.md)):** a ticket either gets a real answer or fails *visibly and retryably*. No failure is ever disguised as success, no ticket is silently lost, and someone is told when things break.

**The point: a failure must be visible and retryable, never disguised as success.**

This step doesn't touch the model, the prompt or the reply quality. Those are Steps 2–4. If urgency accuracy moves in this step, it's noise or a side effect, and the evaluation's run-to-run variance from Step 0 tells you which.

---

## 0. Before you deploy anything: the v0 baseline

The official v0 baseline has to run against **v0's code**. The moment you `sam deploy` Step 1, the stack isn't v0 any more.

Two ways to handle it:
- **Wait.** Write and unit-test Step 1 locally, and deploy it only after the v0 baseline is recorded. This is the simplest option.
- **Redeploy v0 later.** `git checkout v0-naive-llm-call -- lambdas template.yaml`, deploy, run the baseline, then deploy Step 1 again. It works, but it's easy to get wrong.

Pick one before your first deploy, and write it down.

---

## 1. Map every way a ticket can fail

Before fixing anything, list what can go wrong. A table like this is worth keeping in the guide's notes:

| Where | What fails | What v0 does today | What it should do |
|---|---|---|---|
| Receiver | Lambda throttled (concurrency limit) | API returns `503`, ticket lost, no alarm (Step 0 finding) | Customer gets a clear error; an alarm fires |
| Receiver | DynamoDB `PutItem` fails | `500` | `500`, and nothing half-written |
| Receiver | SQS `SendMessage` fails after the put | `500`, ticket stuck in `RECEIVED` forever (G4) | No orphan tickets |
| Receiver | Body isn't JSON | `500` (G5) | `400` |
| Processor | Lambda throttled | Message waits out the 30 s visibility timeout (Step 0: 8 tickets at ~31 s) | Same retry, but on purpose and bounded |
| Processor | Bedrock throttles or has a 5xx | Canned reply saved as `PROCESSED` (G1) | Retry, then the DLQ |
| Processor | Bedrock rejects the request (bad model id, no access) | Canned reply saved as `PROCESSED` (G1) | Fail fast, alarm. Retrying won't help |
| Processor | The model's answer can't be parsed | Canned reply saved as `PROCESSED` | Marked as failed, not as an answer |
| Processor | One bad record in a batch | Whole batch retried, duplicate emails (G2) | Only that record retried |
| Processor | DynamoDB update or SNS publish fails | Whole batch retried | Retried without double-notifying |
| Fetch | Unknown ticket | `200 {}` (G5) | `404` |

Every row should end up either **retried** or **visibly failed**. Nothing in the last column says "pretend it worked".

---

## 2. Retryable vs. permanent errors

The core skill of this step: **not every error deserves a retry.**

| Kind | Bedrock examples | Retrying helps? | What to do |
|---|---|---|---|
| **Transient** | `ThrottlingException`, `ServiceUnavailableException`, `ModelTimeoutException`, `InternalServerException` | Yes, a bit later | Throw, so SQS retries and eventually sends the message to the DLQ |
| **Permanent** | `ValidationException`, `AccessDeniedException`, `ResourceNotFoundException` | No: the same request fails the same way | Mark the ticket `FAILED` with the reason, and don't retry |
| **Bad output** | The model answered, but not in the expected shape | Maybe, but it's not an infrastructure problem | Mark `FAILED` (reason: unparseable). Step 2 removes most of these |

Questions to settle while writing it:
- Where does this decision live? A small `classifyError(err)` function in `shared/` is easy to unit-test.
- `TicketStatus.FAILED` already exists in `shared/types.ts` and is never used. What should a `FAILED` ticket store so someone can act on it: the error name, the message, the attempt count?
- Should the fallback reply survive at all? If it does, it must be **marked** as a fallback (a field, not just its text), so nobody mistakes it for an answer. The Step 0 runner's fallback detection should then become unnecessary.

---

## 3. Partial batch responses

Today the processor loops over up to 10 records and throws on the first failure, so SQS retries **all 10**, including the ones that already succeeded. That causes duplicate Bedrock calls and duplicate emails (G2).

The fix has two halves:
1. **Template:** add `FunctionResponseTypes: [ReportBatchItemFailures]` to the SQS event source.
2. **Handler:** wrap each record in its own try/catch, and return `{ batchItemFailures: [{ itemIdentifier: record.messageId }, …] }` for the ones that failed. SQS then retries **only those**.

Watch for one trap: if the handler *throws* instead of returning, SQS treats the whole batch as failed again. With partial responses, the handler should almost never throw.

Also reconsider `BatchSize: 10`. Ten sequential Bedrock calls in one invocation take a long time. What batch size makes the timeout math in section 4 comfortable?

---

## 4. Timeouts that fit together

Three numbers have to agree:

```
Lambda timeout   ×  6   ≤   SQS visibility timeout
time per record  ×  batch size   <   Lambda timeout
```

- **Visibility timeout:** how long SQS hides a message after handing it to the processor. If the function is still working when it expires, SQS hands the same message to *another* invocation, which means duplicate work. AWS recommends at least 6× the function's timeout for SQS-triggered functions.
- **v0 has both at 30 s** (G3). The Step 0 finding shows the effect: throttled messages reappeared after exactly 30 s.
- **`maxReceiveCount: 3`** decides how many tries a message gets before the DLQ. With a longer visibility timeout, how long does a doomed message now take to reach the DLQ? Is that acceptable?

Write the numbers you choose, and the reasons, into PLANNING.md's decisions table.

---

## 5. Idempotency: processing a ticket twice must be harmless

SQS delivers **at least once**. Even with everything right, a message can arrive twice. So "process ticket X" must be safe to repeat.

- Make the DynamoDB update **conditional**: only move a ticket to `PROCESSED` if it isn't already. Use a `ConditionExpression` on `status`.
- If the condition fails, the ticket was already handled. Treat that as success, and **don't** notify again.
- Think about the order: update DynamoDB first, then publish to SNS? What happens if the publish fails after the update succeeded? Is a missing email or a duplicate email worse here?

---

## 6. The receiver: no half-written tickets

The receiver writes to DynamoDB, then sends to SQS (G4). If the send fails, the ticket sits in `RECEIVED` forever.

There are a few honest options. Pick one and write down why:
- **Send to SQS first, then write to DynamoDB.** The processor must then cope with a ticket whose row doesn't exist yet.
- **Write, send, and on send failure mark the ticket `FAILED`.** That's simple, and the customer gets an error.
- **DynamoDB Streams, or EventBridge Pipes from the table to the queue.** No dual write at all, but it's more infrastructure.

**Chosen: a DynamoDB stream and an EventBridge Pipe.** The receiver only writes the ticket; the pipe reads `INSERT`s from the table's stream and puts each one on the queue. The other two options leave a gap: sending first races the processor's "ticket not found" check, and marking `FAILED` on a failed send can itself fail. Things to get right:
- **Filter on `INSERT`.** The processor's own updates are `MODIFY` records; without the filter they would queue every ticket again.
- **`StartingPosition: TRIM_HORIZON`**, not `LATEST`: a new pipe takes minutes to start polling and could miss tickets written meanwhile.
- **The message is now a stream record**, so the processor reads the ticket from `dynamodb.NewImage`.
- **The pipe has its own DLQ** for batches it gives up on; the tickets stay in the table as `RECEIVED`. Alarm on it (section 8).

Also: invalid JSON must return `400`, not `500`. Parse it in its own try/catch.

---

## 7. The API tells the truth

- `GET /support-request?ticketId=…` returns **`404`** for an unknown ticket.
- The response includes **`status`** (`RECEIVED`, `PROCESSED`, `FAILED`), so a client can tell "not ready yet" from "failed" from "doesn't exist".
- The handlers are typed with `APIGatewayProxyEvent` (REST, v1), but the API is an HTTP API sending v2 events. It works because the fields we use exist in both. Switch to `APIGatewayProxyEventV2` so the types describe reality.

---

## 8. Alarms on the symptom

v0 has one alarm: Bedrock errors in a custom log group. Step 1 needs alarms on what a **customer or the support team** would notice:

| Alarm | Metric | Why |
|---|---|---|
| Tickets dead-lettered | DLQ `ApproximateNumberOfMessagesVisible` > 0 | A ticket gave up. Someone must look |
| Tickets rejected at the door | Receiver `Throttles` > 0, or API `5xx` | The Step 0 finding: lost tickets, silently |
| Processor failing | Processor `Errors`, or a metric for `FAILED` tickets | Failures that don't reach the DLQ |

Things to get right:
- **`TreatMissingData`.** No traffic at 3 a.m. means no datapoints. Should that be OK, or an alarm?
- **Someone has to receive them:** subscribe your email to the alert topic, and confirm the subscription.
- **G11:** the error logger calls `CreateLogGroup` and `CreateLogStream` on every error. The log group already exists in the template. Simplify it: structured `console.error` JSON plus a metric filter on the function's own log group is enough.

---

## 9. Concurrency, on purpose

The Step 0 finding was that the account limit decided who got throttled. After the quota increase, decide it yourself:
- **SQS event source `ScalingConfig: MaximumConcurrency`** caps how many processor invocations run at once (minimum 2). That keeps the processor from eating every slot and protects your Bedrock quota.
- **Reserved concurrency** guarantees slots for a function. Check first: AWS always keeps at least 10 unreserved, so at a limit of 10 you can't reserve anything.

Write the chosen numbers into PLANNING.md's decisions.

---

## 10. Tests

Unit tests in `lambdas/tests/unit/`, with `aws-sdk-client-mock` as in the Step 0 receiver test:
- `classifyError`: each Bedrock error name → transient or permanent.
- Processor, batch of 3 with the middle record failing transiently → returns exactly that `messageId` in `batchItemFailures`. The other two are written once.
- Processor, Bedrock `ValidationException` → ticket `FAILED`, no throw, no retry.
- Processor, conditional update fails (already processed) → no second SNS publish.
- Receiver, body `"not json"` → `400`.
- Fetch, unknown id → `404`; known id → includes `status`.

---

## 11. Suggested order

1. Decide section 0 (deploy timing) and write the decision down
2. The failure table (section 1): fill in your own last column
3. `classifyError` and its tests
4. Processor: per-record handling, partial batch response, `FAILED` status, conditional update
5. Template: `ReportBatchItemFailures`, timeouts, batch size, maximum concurrency
6. Receiver and fetch: `400`, `404`, `status`, v2 event types
7. Alarms, and simplify the error logger
8. `npm test` green, then deploy
9. The proofs (section 12), then the evaluation re-run
10. `git tag step-1-complete`

---

## 12. Proofs

Each exit criterion is proven by **breaking something on purpose** and watching the system handle it. Record each one in RESULTS.md's Step 1 table.

- **Bedrock failure:** deploy with a wrong `BEDROCK_MODEL_ID`. A permanent error should mark tickets `FAILED` without retries. To see the transient path, think about how you could provoke throttling, or test it with the unit test and say so.
- **Poisoned record:** send a batch of 10 where one message body isn't valid JSON. The other 9 are processed exactly once, with no duplicate emails.
- **API:** `GET` for an unknown id returns `404`, and malformed JSON returns `400`.
- **Alarm:** make one fire for real (for example, a message in the DLQ) and confirm the email arrives.
- **Evaluation:** `npx tsx run.ts --label step-1`. The `not-submitted`, `fallback` and `timeout` counts should be zero, and p95 latency should drop now that the 31-second redeliveries are gone.

---

## 13. Checkpoints

- **Before writing code:** for each row in section 1's table, can you say whether it's retried or visibly failed? Any row you can't answer is a design decision you haven't made yet.
- **After partial batch responses:** what happens if *every* record in a batch fails? Does the handler still return rather than throw?
- **After idempotency:** deliver the same SQS message twice by hand. One email or two?
- **After the alarms:** when did each alarm last fire? If the answer is "never", you haven't tested it.

---

## 14. Definition of done

- No code path stores the canned fallback as an answer, or a fallback is clearly marked as one.
- Transient failures retry and land in the DLQ; permanent failures mark the ticket `FAILED` without retrying.
- Partial batch responses: one bad record never retries the others.
- Timeouts, batch size and maximum concurrency chosen and recorded in PLANNING.md.
- The receiver leaves no orphan tickets; the API returns `400`, `404` and `status`.
- DLQ, throttle and processor alarms exist, and each has fired once on purpose.
- Unit tests for each of the above; `npm test` green.
- Evaluation re-run, `step-1` row in RESULTS.md.
- Tagged `step-1-complete`.

*Free at rest. Alarms cost about $0.10 each per month.*
