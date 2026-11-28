# Graphify and Obsidian setup

**What was asked**
Build a graphify knowledge graph of the whole Softwares folder, connect it to the Obsidian vaults, keep it synced, and log session summaries.

**What changed**
- Built `graphify-out/` (graph.json, graph.html, GRAPH_REPORT.md): 8,328 nodes, 17,417 edges, 625 communities. Code via AST (19,515 files), 186 docs via subagents.
- Not included: 11,176 images and 2,501 videos (too costly to extract).
- `graphify claude install`: hooks in `.claude/settings.json`.
- Exported 8,953 notes plus `graph.canvas` into `SignSync/graphify/` and `SignSync Dataset/graphify/`.
- Added `Graph Index.md` and `Graph Report.md` to both vaults; linked from [[Project Home]] and Dataset Guide.
- `sync-graph-obsidian.ps1` plus a Stop hook re-export only when graph.json changed. Tested: skip path about 2 s, forced re-export about 168 s.
- Added the session-summary rule to the project `CLAUDE.md`.

**Decisions and caveats**
- Community names were not curated (shown as "Community N").
- One doc (`almari-collector-move` README.before.md) is marked partly read and retried on the next `--update`.
- One doc-extraction edge has a malformed `source_file`.
- Each export folder has its own `.obsidian`, so Obsidian may treat it as a nested vault.

**Not done / open**
- Graph is not rebuilt automatically; run `graphify update .` after code changes.
