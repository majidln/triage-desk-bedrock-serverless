# Step 4 Guide: The Answers Sound Right but Aren't Flowboard's Policy

This guide coaches you rather than handing over code. It says what to build and why; you write the TypeScript and the YAML.

**Goal (from [PLANNING.md](../PLANNING.md)):** every draft is grounded in Flowboard's own documents, cites them, and invents nothing (SC-4).

**The point: what retrieval returns decides answer quality more than the model does. If the right chunk isn't retrieved, no prompt will save the reply.**

Urgency isn't this step's target, though better context may move it. Model choice is Step 5.

---

## 1. What's wrong today

| Today | Why it hurts |
|---|---|
| The model knows nothing about Flowboard | It guesses refund windows, SLAs and features |
| 33 of 42 replies miss a required fact (Step 3) | The draft needs rewriting, so agents save little time (P3) |
| T35 invents "all sales are final" | An invented policy is the failure SC-4 counts, and it reaches a customer |
| A reply has no sources | An agent can't check a draft without searching the docs themselves |

---

## 2. The documents

Write the Flowboard help center and policies as Markdown in the repo, e.g. `knowledge/`. Base them on [flowboard-facts.md](../eval/flowboard-facts.md), but write them the way a real help center reads:

- 8–12 short articles, one topic each: plans and pricing, refunds, failed payments, SLA and credits, support hours, account security, data export, mobile apps…
- Each fact lives in one place. Two articles that disagree make retrieval a coin flip.
- Add a little noise that isn't the answer (release notes, a getting-started page). Retrieval that only ever sees the right document proves nothing.
- Keep the `F-xx` ids out of the text. They belong to the evaluation, not to the customer.

---

## 3. The vector store

Settle the open question in PLANNING.md §6 first. This is the first resource that can bill at rest.

| Option | At rest | Notes |
|---|---|---|
| **S3 Vectors** | Storage only, cents | Native Knowledge Base support; the cheapest to leave running |
| Aurora Serverless v2 + pgvector | Billed while it runs, unless it scales to zero | SQL you can inspect; more setup (cluster, secret, schema) |
| OpenSearch Serverless | A high hourly minimum | Rich search, but too expensive for this project |

Check current prices and whether your choice supports the chunking strategies you want to compare.

---

## 4. The Knowledge Base

In `template.yaml`:

- An S3 bucket for the documents, and the vector store.
- `AWS::Bedrock::KnowledgeBase` with an embedding model (Titan Text Embeddings V2 is a good default; note its dimensions for the index).
- `AWS::Bedrock::DataSource` pointing at the bucket. **Chunking is set here.**
- A service role for the Knowledge Base: read the bucket, invoke the embedding model, write the vector store.

Deploying doesn't index anything. Upload the documents, then run an ingestion job (`StartIngestionJob`) and wait for it to finish. Script it; you'll do it once per chunking strategy.

---

## 5. Retrieve, then generate

Call **`Retrieve`** yourself, then Converse as today. Don't use `RetrieveAndGenerate`: it would replace your prompt, your `record_triage` tool and your guardrail flow.

Questions to settle:
- **What's the query?** The masked ticket is the obvious start. Is a long ticket a good query, or should it be cut?
- **How many chunks?** Too few misses the fact; too many buries it and costs tokens. Start around 5 and measure.
- **Where do they go?** In the user message, inside their own delimiters (`<documents>`, each chunk with an id), apart from `<ticket>`. They're data, like the ticket.
- **What if nothing relevant comes back?** The system prompt says: answer only from the documents, and if they don't cover it, say an agent will follow up. Never fill the gap.
- **Citations:** add a `sources` field to `record_triage`. Check that every cited id was in the retrieved set, and drop any that weren't.
- Flagged tickets (T36, T40) skip the model, so they skip retrieval too.
- IAM: the processor needs `bedrock:Retrieve` on the Knowledge Base's ARN.

---

## 6. Chunking: compare at least two

| Strategy | Try it because |
|---|---|
| Fixed size (e.g. 300 tokens, 20% overlap) | The default; a fact can be cut in half |
| Hierarchical, semantic, or none (one article per chunk) | Keeps a policy and its exceptions together |

For each strategy:
1. Re-ingest (changing chunking means a new data source).
2. **Retrieval check:** for each ticket with `F-xx` in its `notes`, did a retrieved chunk contain that fact? This needs no model call.
3. Full evaluation run, labelled e.g. `step-4-fixed` and `step-4-hier`.

Record both in RESULTS.md's chunking table. Pick one, and say why.

---

## 7. The ticket's shape

Sources belong to the triage:

```
triage: { urgency, response, sources, generatedAt }
usage:  { modelId, inputTokens, outputTokens, costUsd }
```

`sources` holds document names (or S3 keys), not chunk text. Retrieval adds input tokens, so watch `costUsd`.

---

## 8. Tests

In `lambdas/tests/unit/`:
- The retrieved chunks are in the user message inside their delimiters, never in `system`.
- A cited id that wasn't retrieved is dropped.
- No chunks retrieved → the model is still called, and the prompt says the documents don't cover it.
- A flagged ticket → no `Retrieve` call.
- A `Retrieve` failure is classified like a Bedrock failure (transient vs permanent).

---

## 9. Suggested order

1. Write the documents
2. Vector store, Knowledge Base and data source; deploy, upload, ingest
3. Query the Knowledge Base by hand with a few tickets. Is the right chunk on top?
4. `Retrieve` in the processor, the prompt change, `sources`, and their tests; deploy
5. Retrieval check and evaluation run for the first strategy
6. Second strategy: new data source, re-ingest, same two runs
7. Choose a strategy, review the replies by hand against the rubric, `step-4` row in RESULTS.md
8. `git tag step-4-complete`; tear down the vector store if it bills hourly

---

## 10. Definition of done

- [ ] Every draft cites the documents it used, and only retrieved ones.
- [ ] Zero invented policies on the evaluation set, reviewed by hand (SC-4).
- [ ] Two chunking strategies compared: retrieval check and evaluation for each.
- [ ] Unit tests for the above; `npm test` green.
- [ ] Evaluation re-run, `step-4` row and findings in [RESULTS.md](../RESULTS.md).
- [ ] Vector store decision recorded in PLANNING.md §6.
- [ ] Tagged `step-4-complete`.

*Embedding the documents costs fractions of a cent. Retrieval adds input tokens to every ticket, so check cost per ticket against SC-6.*
