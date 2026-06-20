# vibe-splain — Product Context

## What This Is

vibe-splain is a **codebase safety, mapping, and context-injection layer** that runs locally alongside a coding agent (Claude Code, Cursor, Gemini CLI). It parses a repository with Tree-Sitter, scores every file for **gravity** (importance) and **heat** (complexity/risk), and exposes that intelligence two ways:

1. As an **MCP server** the agent calls to build an architectural **Dossier**.
2. As a **deterministic PreToolUse gate** that warns the agent before it edits a high-blast-radius file.

**Zero LLM calls. Zero API keys. Zero bound ports. Pure static analysis.** The coding agent does all the thinking; vibe-splain just hands it the right data, fast.

## Three Capabilities

### A. High-Fidelity Static AST Analysis (`@vibe-splain/brain`)
Tree-Sitter parsing extracts precise semantic structure and computes:
- **Gravity (0–100)** — PageRank centrality × fan-in × cyclomatic complexity × public surface × nesting. High-gravity files are the load-bearing hubs.
- **Heat** — cyclomatic complexity, code smells (swallow-all catches, deep nesting), tech-debt markers.
- **Pillars** — files partitioned into conceptual buckets (Logic, UI, Database, Auth, …) via directory grouping + dependency links.

### B. Interactive Dossier UI (`@vibe-splain/ui`)
A portable, zero-dependency, single-file HTML viewer at `.vibe-splainer/ui/index.html`. Data is pre-injected as `window.__VIBE_DOSSIER__` to bypass CORS on `file://` origins. Renders dependency graphs, gravity rankings, and localized Mermaid import flowcharts.

### C. PreToolUse Hook Gating (`vibe-splain` CLI)
A standalone `dist/hook.js` entrypoint registered in the agent's `settings.json`. Before an edit lands it does an **O(1) gate-index lookup** (no model, no WASM reload) and classifies blast radius:
- **Low** → defer (silent allow).
- **Medium** → allow but inject a short advisory (key dependents, file role).
- **High** → block and ask, naming the importers that would break.

## Core Scan Loop

1. `scan_project` → Tree-Sitter analysis, gravity/heat scoring, pillar detection; writes `graph.json` + `dossier.json`; starts a chokidar watcher (MCP interactive flows only).
2. `get_project_map` → fixed pillar set, Start-Here (top gravity), Wild-Discovery (top heat) lists.
3. `get_file_context` (per file) → returns source + import-graph neighbors, hotSpans + smellSpans.
4. `write_decision_card` → one verdict per file, persisted to `dossier.json` and re-baked into the UI.

**Rule:** MCP/CLI concerns must never bleed into `packages/brain/`. Brain is pure analysis; the CLI is a delivery mechanism. No network, no bound port, no `console.log` (stdout is owned by the MCP stdio transport).

## Scope

Built on a language-agnostic Tree-Sitter foundation, the current toolset is **optimized for TypeScript / JavaScript** (especially Next.js, Prisma, tRPC). An optional `DomainAdapter` extension point exists in `brain/src/pipeline/adapters/` for projects that want to contribute product-specific `behavioralLift`, but **no adapters ship with the core** — every scan runs pure generic static analysis (`behavioralLift = 0`, `gravity == staticGravity`).

## Architectural Foundations

Decisions are codified in `docs/adr/`. Key ones:

- **Pipeline & Analysis (001–006, 018):** multi-stage pipeline (AST → graph → risk map). Tree-Sitter for AST; `tsconfig` path-aware alias resolution.
- **Metric & Risk (003–010):** canonical severity scores; registry-bottleneck invariants.
- **Tracing (020):** robust entrypoint tracing.
- **Adapter extension point (034):** repo-agnostic core computes `staticGravity`; an optional adapter may add `behavioralLift`. Final `gravity = max(staticGravity, min(100, staticGravity + behavioralLift))`.
- **Infrastructure (028, 029, 031, 032, 033):** context-as-cache, manifest-centric registry, content-addressed integrity, tool-output discipline, multi-layer scope enforcement.
- **Headless scan rule:** headless/one-shot flows use `performScan` or `handleScanProject(..., { watch: false })`. Only MCP interactive flows start file watchers.
