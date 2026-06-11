# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Mode

**Continuous improvement protocol:** When encountering a repeating friction point, a new project standard, or a correction from the user — pause, propose a CLAUDE.md update (summarize the change briefly), wait for `approve`, then apply it immediately.

**Response style:** Caveman. Short sentences. No preamble. State the result, not the reasoning. Skip summaries of what you just did.

## Commands

```bash
# Install dependencies
npm install

# Full build (brain → cli → ui → bundle-ui, must run in order)
npm run build

# Dev server for UI only
npm run dev:ui

# Build individual packages
npm run build -w packages/brain   # tsc only
npm run build -w packages/cli     # tsc + esbuild (inlines brain, fixes shebang)
npm run build -w packages/ui      # vite build

# Test locally after build
node packages/cli/dist/index.js install
node packages/cli/dist/index.js serve

# Publish to npm (runs full build first)
npm run release
```

There are no test scripts — manual testing is done by running `install` and `serve` against a real project.

## Architecture

Three packages, one published artifact (`vibe-splain` CLI):

```
packages/
├── brain/   # @vibe-splain/brain — pure static analysis, no network
├── cli/     # vibe-splain — MCP server + CLI (publishes to npm)
└── ui/      # @vibe-splain/ui — React dossier viewer (private, embedded into cli)
```

**Build pipeline:** `brain` tsc → `cli` tsc+esbuild (inlines `brain`) → `ui` vite → `scripts/bundle-ui.js` copies `ui/dist/` → `cli/dist/ui/`. The published package is `packages/cli` only.

**Data flow:**
1. Agent calls `scan_project` → brain's Tree-Sitter scanner produces `graph.json` + initial `dossier.json`; chokidar watcher starts
2. Agent calls `get_file_context` per high-gravity file → returns source + import graph neighbors
3. Agent calls `write_decision_card` → brain's `dossier.ts` does atomic write (tmp+rename) + immediately regenerates `ui/index.html` with baked-in JSON
4. UI is a static `file://` page; data is pre-injected as `window.__VIBE_DOSSIER__` to avoid CORS on `file://` origins

**State:** `dossier.json` is the single source of truth. Nothing is cached in memory between MCP calls — every read/write hits disk. Concurrent writes are serialized by `async-mutex`.

## Critical Constraints

**`console.log` is forbidden** everywhere in `brain/` and `cli/`. `process.stdout` is owned by the MCP stdio transport — any stray `console.log` corrupts the JSON-RPC stream. Use `console.error` only.

**No `process.exit()`** after `server.connect(transport)` in `serve.ts` — the process must stay alive until the agent disconnects.

**No HTTP server or bound port** anywhere. The UI must work from `file://` only.

**WASM init is once-per-process.** `Parser.init()` in `scanner.ts` must be called once at startup, before any file parsing. It is async; the scan pipeline awaits it.

**`write_decision_card` and `mark_stale` must always call `regenerateUI()`** after mutating `dossier.json`, so `index.html` stays in sync with the data.

**`regenerateUI` injection marker:** The dossier JSON is injected using an HTML comment marker (`<!-- VIBE_DOSSIER_INJECTION_POINT -->`) as the insertion point — NOT by searching for `</head>`. Minified single-file bundles collapse `</head>`, making string-replace unreliable. Keep this marker in the UI template.

**Template path after esbuild bundling:** When `brain` is inlined into the CLI bundle, `import.meta.url` resolves relative to the bundle entrypoint, not the source file. The UI template path (`cli/dist/ui/index.html`) must be resolved relative to the CLI entrypoint, not relative to `dossier.ts`.

## Key File Locations

| Concern | File |
|---------|------|
| Tree-Sitter scanning + Cognitive Weight formula | `packages/brain/src/scanner.ts` |
| Atomic dossier writes + `regenerateUI` | `packages/brain/src/dossier.ts` |
| MCP tool registration | `packages/cli/src/mcp/server.ts` |
| Agent config patcher (`install` command) | `packages/cli/src/commands/install.ts` |
| UI data injection pattern | `window.__VIBE_DOSSIER__` in `packages/ui/src/App.tsx` |

## Cognitive Weight Formula

```
cognitiveWeight = (linkDensity × 2) + nestingDepth + (mutationCount × 1.5)
```

Files ≥ 15 → High-Gravity. Files ≥ 25 → Wild Discoveries.

## esbuild Bundling Note

`packages/cli/build.mjs` runs after `tsc` and bundles `@vibe-splain/brain` inline into `dist/index.js`. All other npm dependencies stay external (they live in `node_modules/` at runtime). The shebang is re-applied by the build script — do not add it to `src/index.ts`.

## Mermaid in the UI

Initialize with `startOnLoad: false`. Render imperatively via `mermaid.render()` inside a `useEffect`. Never let Mermaid auto-scan the DOM.

## Vite UI Build

`vite.config.ts` uses `vite-plugin-singlefile` and `base: './'` so the output is a single self-contained `index.html` that works from any `file://` path. Do not change `base` — it will break the UI for all users.
