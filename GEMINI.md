# VIBE-SPLAIN Project Context

## Project Overview

VIBE-SPLAIN ("The MRI") is a static analysis tool and MCP server tailored specifically for TypeScript and JavaScript (especially Next.js) projects. It performs Tree-Sitter AST analysis to identify high-gravity files and map architectural decisions. 

It serves a dual purpose:
1. **Delta Engine (The Surgeon):** Produces a machine-readable risk map (`delta_targets.json`) used by a runtime orchestrator to make automated modernization decisions.
2. **Coding Agents (Claude/Gemini/Cursor):** Exposes MCP tools to generate an Architectural Dossier (`dossier.json`) with an offline, standalone `file://` UI.

The project is structured as a monorepo with three packages:
* `packages/brain/`: Pure static analysis engine. No network or MCP logic.
* `packages/cli/`: The MCP server and npm CLI executable.
* `packages/ui/`: A React dossier viewer injected with static data.

## Building and Running

Commands to manage the project:

* **Install dependencies:** `npm install`
* **Full build:** `npm run build` (Builds `brain` -> `cli` -> `ui` -> bundles UI into CLI dist)
* **Run Regression Tests:** `npm run test:regression`
* **Start UI Dev Server:** `npm run dev:ui`
* **Local Test (Install):** `node packages/cli/dist/index.js install`
* **Local Test (Serve):** `node packages/cli/dist/index.js serve`
* **Publish to npm:** `npm run release`

*Note: Regression tests cover WAL safety, budget enforcement, scope enforcement, and adversarial bypasses. End-to-end scanning is still verified manually against real codebases.*

## Development Conventions & Constraints

* **NO `console.log`:** `console.log` is strictly forbidden in `brain/` and `cli/` to avoid corrupting MCP stdio JSON-RPC streams. Use `console.error` exclusively for logging.
* **Brain Isolation:** The `brain` package must remain a pure library with zero CLI/MCP concerns bleeding into it.
* **Offline UI:** The UI is a static `file://` application. Data is pre-injected into `window.__VIBE_DOSSIER__` via an HTML comment marker (`<!-- VIBE_DOSSIER_INJECTION_POINT -->`). Do not add HTTP servers or CORS requirements.
* **Atomic Writes:** `dossier.json` is the source of truth, mutated via atomic writes (`async-mutex` + tmp/rename).
* **UI Regeneration:** UI artifacts are managed by `ExportOrchestrator` and `ArtifactBundleWriter`. Whenever `dossier.json` is mutated (e.g., in `write_decision_card` or `mark_stale`), `orchestrator.writeBundle()` is called to atomically update all artifacts including `ui/index.html`. Do not call `regenerateUI` directly.
* **WASM Initialization:** `Parser.init()` must only be called once per process startup before parsing.
* **Mermaid JS:** In the UI, initialize with `startOnLoad: false` and render imperatively. Do not allow DOM auto-scanning.
* **Vite Config:** `vite.config.ts` uses `base: './'` to work locally. Do not alter this.

## Context-as-Cache Architecture (ADR-028 - ADR-033)

* **History is volatile:** Treat chat history as an execution cache. Never dump large raw data into context.
* **Artifacts are the DB:** Store technical state (ASTs, graphs, patches) as artifacts in `.vibe-splain/`.
* **Pointers are the bridge:** Use `PointerStore` (SQLite) to reference artifacts across turns and agents.
* **Integrity:** Skeletons are content-hash-bound. Patches are preimage-hash-guarded.
* **Manager-Worker:** Strategy stays with the Manager. Execution noise stays with the Worker.
* **Scope:** Enforced at the API/Tool layer, not just by prompts.

## Agent Behavior Guidelines
* **Response Style:** Caveman. Short sentences. No preamble. State the result, not the reasoning. Skip summaries of what you just did.
* **Protocol Updates:** If encountering repeating friction, propose a `CLAUDE.md` / `GEMINI.md` update briefly, wait for approval, then apply it immediately.