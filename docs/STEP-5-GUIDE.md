# Step 5 Guide: Is Nova Lite Actually Good Enough?

This guide coaches you rather than handing over code. It says what to build and why; you write the TypeScript and the YAML.

**Goal (from [PLANNING.md](../PLANNING.md)):** run the same evaluation across several models, and choose one in writing, with numbers behind the choice.

**The point: a model is a trade-off between accuracy, latency and cost, and only your own evaluation set can tell you where that trade-off sits for your tickets.**

Nothing else changes in this step: same prompt, same Knowledge Base, same guardrail. Only the model.

---

## 1. Why now

| Today (Step 4) | Why it points at the model |
|---|---|
| Retrieval finds 94% of the needed facts | The documents are no longer the bottleneck |
| T29 and T35 get the right chunk and misread it | A reading failure, not a retrieval one |
| Prompt rules didn't fix reading (finding 3) | More prompt tuning would overfit the 42 tickets |
| CRITICAL recall 5/8, accuracy 25/42 | Far from SC-3, and the urgency rules are already in the prompt |
| $0.000148 per ticket | ~70× under the $0.01 target: room to spend on a bigger model |

---

## 2. The candidates

| Model | Why it's in the race |
|---|---|
| Nova Lite | The baseline, everything so far |
| Mistral Large 3 | Much bigger, another family: does size fix the reading? |
| Claude Haiku | Another family at a similar price point |

*Nova Pro was the first pick, but this account allows it 13 requests a minute (25 cross-region), not adjustable through Service Quotas: an evaluation burst is throttled and times out. Mistral Large 3 allows 100, like Nova Lite. Check the quota before picking a model: `aws service-quotas list-service-quotas --service-code bedrock`.*

Before running anything:
- Enable access to each model in the Bedrock console, and check which ones need an **inference profile** ID (`us.…`) instead of a plain model ID.
- Add each one's price to `lambdas/shared/model-prices.ts` and `eval/src/config.ts`. A model missing from the table runs fine but records no cost.
- Check that each model supports the Converse tool call (`record_triage`) and works with your guardrail.

---

## 3. Switching models

`ModelId` is already a stack parameter. A run per model is: deploy with that model, run the evaluation with a label (`step-5-nova-pro`), repeat.

Questions to settle:
- Does the processor's IAM policy allow `bedrock:InvokeModel` on the new model's ARN (and on the inference profile, if it needs one)?
- Does the eval read the model ID from the ticket's `usage.modelId`, or from the hard-coded `MODEL_ID`? It should be the ticket, so a report can't mislabel a run.
- Run each model at least twice. Step 4 showed runs differ by a ticket or two, so a one-ticket gap is noise.

---

## 4. The judge

Reviewing 42 replies by hand per model doesn't scale. Add an **LLM-as-judge** to the eval: a separate model that reads the ticket, the retrieved documents and the reply, and scores it against the same rubric you used by hand.

- **Stronger than the models it judges** (PLANNING.md §6). Settle the open question there.
- **Structured output:** `correct | partly | wrong`, an `invented` boolean, and a one-line reason. Use a tool call, as in Step 2.
- **Give it the facts:** the ticket's `must_include` / `must_not` and the guide text, so it judges against Flowboard's policy, not its own idea of one.
- **Calibrate it first:** run it on the Step 4 replies, which you already reviewed by hand. Count where it disagrees with you. If it misses invented policies, fix the judge before trusting it.
- **Spot-check it per model:** read the replies it marked `invented` or `wrong`, plus a few marked `correct`.

The judge lives in `eval/`, not in the stack. It never touches a customer.

---

## 5. Choosing

Fill RESULTS.md's Step 5 table, then write the decision under it. A good decision says:
- Which model, and which criterion decided it (CRITICAL recall and invented policies first; latency and cost only break ties).
- What it costs against SC-6, including the guardrail.
- What you gave up, and what result would make you switch.

If no model meets SC-3 or SC-4, say so. That is a finding, and it is what Step 6's human review is for.

---

## 6. Suggested order

1. Model access, inference profiles, prices
2. Eval reads the model from the ticket; IAM covers the new models
3. The judge; calibrate it on the Step 4 replies
4. Run each model twice, with the judge
5. Spot-check the judge, fill the table, write the decision
6. Deploy the chosen model, `step-5` row in RESULTS.md

---

## 7. Definition of done

- [ ] A table of accuracy, CRITICAL recall, reply quality, p95 latency and cost per ticket for each model.
- [ ] The judge calibrated against the Step 4 hand review, and spot-checked per model.
- [ ] A model chosen in writing, with the reason; judge model recorded in PLANNING.md §6.
- [ ] Evaluation re-run on the chosen model, `step-5` row and findings in [RESULTS.md](../RESULTS.md).
- [ ] Tagged `step-5-complete`.

*Free at rest. Each run costs more than earlier steps, and the judge adds a call per reply; still under a dollar in total.*
