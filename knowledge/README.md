# Flowboard Knowledge Base

> **Flowboard** is a *fictional* company. Everything here is invented for this project.

The documents the pipeline retrieves from in Step 4. They are written from [flowboard-facts.md](../eval/flowboard-facts.md) and must never disagree with it: a fact that's here but not on the sheet counts as invented when replies are scored.

| Folder | Audience | What's in it |
|---|---|---|
| `help-center/` | Customers | Five guides, each covering several related topics in `##` sections |
| `internal/` | Support agents | How support handles tickets: hand-offs and the rules every reply follows |

Rules for editing:
- Each fact lives in one section. Link to it from others instead of repeating it.
- Guides are deliberately longer than one chunk (roughly 300–1,100 tokens), so the chunking strategy has real cuts to make. Don't split them back into one file per topic.
- No menu path, feature, price or time frame that isn't on the facts sheet.
- No `F-xx` ids in the text. They belong to the evaluation.
- This README and COVERAGE.md are not uploaded to the Knowledge Base.
- The guides are written as `.md` but uploaded as `.txt` by `scripts/sync-knowledge.sh`. Bedrock chunks a `.md` file by its Markdown structure and returns the whole file from `Retrieve`, whatever the data source's chunking says; a `.txt` file is chunked exactly as configured.
