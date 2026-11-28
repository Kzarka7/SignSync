# Graphify docs update

**What was asked:** `/graphify --update` on the SignSync repo, so the knowledge graph covers the Markdown notes as well as code.

**What changed:**
- 95 changed files since the last full build: 41 code files (AST, no LLM) and 54 docs.
- 53 docs extracted by 5 parallel subagents; every file was read to its last line (no partial reads).
- `graphify-out/graph.json`: 3,048 nodes, 7,824 edges, 157 communities (442 new nodes, 651 new edges; 4 nodes and 119 edges removed). Communities were named by hand.
- `graphify-out/GRAPH_REPORT.md` and `graph.html` regenerated. Semantic cache now holds the 53 docs.
- Cost: about 623k subagent tokens (input/output split not available).

**Decisions and caveats:**
- `Graph Report.md` (64,293 lines, the vault copy of `GRAPH_REPORT.md`) was skipped: extracting it would feed the graph its own report. It stays unstamped, so the next `--update` lists it again unless it is added to `.graphifyignore`.
- Health check: 24 self-loop edges. No dangling or missing endpoints reported.
- 101 weakly connected nodes, mostly doc concepts that mention code by name without linking to the code nodes.

**Not done / open:** `.graphifyignore` not changed. The Obsidian copy (`Graph Report.md`) was not re-synced. Related: [[2026-11-21 Graphify and Obsidian setup]].
