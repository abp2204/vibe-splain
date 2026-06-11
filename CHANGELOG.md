# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2026-06-11

### Added
- **Multi-tenant Storage Architecture** — `PointerStore` (SQLite/WAL) and `BlobStore` (content-addressed) for efficient scan history and artifact management
- **Token-Aware Hydration** — `BudgetGuard` middleware with 8000 char auto-pointer truncation and content-addressed skeleton caching
- **Delegated Work Orders** — Support for Manager-Worker orchestration with `create_work_order`, `spawn_worker`, and `submit_receipt`
- **Strict Scope Enforcement** — `SessionScope` validation across all MCP tools including `read_file`, `get_file_skeleton`, and `get_evidence_slice`
- **Atomic Patch Application** — `apply_patch` tool with stale-preimage guards and pre/post hash recording
- **Artifact Lifecycle Management** — `gc` command for reference-counted artifact cleanup and `bundle`/`import` for portable scan sharing
- **Function-level action mapping** — Behavioral call-chain analysis for deep traceability of side effects

### Fixed
- Scope bypass vulnerability in `get_evidence_slice` where raw file content could be extracted via hydrated pointers
- Race condition/dual-worker vulnerability in `spawn_worker` that allowed re-spawning active work orders
- Internal version string synchronization across package.json and CLI entrypoints

## [2.5.0] - 2026-06-11

### Added
- 12-stage deterministic scan pipeline (`packages/brain/src/pipeline/`) replacing monolithic `scanProject`
- Stage 4 real alias resolution: reads `tsconfig.json` paths + `package.json` workspaces before graph construction; writes `stage-04-aliases.json`
- `canonicalSeverity` and `canonicalLoadBearing` fields on `PersistedFile` — computed once in scoring stage, enforced by correction invariants
- `validation_report.json` — new permanent output artifact with hard error + warning rules
- `registry_consumer` RiskType — marks files that bridge the form component registry into rendering
- `partial_wrong_surface` entrypoint trace status — fires when entrypoints are found but semantically wrong for the file's domain
- `scan_project` MCP response now includes `ok`, `validation`, and `artifacts` fields
- Stage artifacts written to `.vibe-splainer/`: `stage-01-inventory.json` through `stage-09-severity.json`
- Expanded side effect detectors: `webhook_ingress` catches `verifySignature`; `payment_mutation` fires on webhook confirmation; `booking_mutation` catches tRPC useMutation in booking domain
- Two-pass risk type inference: cross-file `registry_consumer` + `type_boundary_leak` via `riskTypesByFile` map
- Lowered `registry_bottleneck` threshold to `fanIn > 3 || publicSurface > 5` (OR instead of AND)
- Role-aware `state_machine` threshold: 8 for provider/store, 20 for everything else

### Fixed
- Five known Cal.com classification failures now correctly classified (stripe webhook, form registry bottleneck/consumer, data table context, useBookings hook)
- `applyCorrections` invariants: `handle_payment_webhook` → forces `payment_mutation` + `webhook_ingress`; severity ≥ 4 for payment/booking mutation; severity 5 forces `canonicalLoadBearing`

## [2.4.1] - 2026-06-11

### Fixed
- Internal version string synchronization across package.json and CLI entrypoint

## [2.1.1] - 2026-06-11

### Fixed
- Glossary tooltips clipped by transformed ancestors — now rendered in a portal at document root
- Tooltip labels no longer leak uppercase styling from parent components

## [2.1.0] - 2026-06-11

### Added
- **Glossary tooltips** — hover or tap any jargon term in Decision Cards to see an inline definition
- **Triage matrix** — replaced the sparse Gravity × Heat scatter chart with a 3×3 quadrant matrix that shows file clusters and prioritized action zones

### Fixed
- Evidence code blocks now de-escape `\n` and wrap lines instead of overflowing horizontally
- Agent card-writing loop no longer stalls after the initial brief; drive signal added to keep iterations going

## [2.0.0] - 2026-06-10

### Added
- **Gravity × Heat dual-axis analysis** — every file now gets both a Cognitive Weight (gravity) and a Change Frequency (heat) score, surfacing files that are both complex and actively edited
- **Multi-language scanner** — Tree-Sitter grammars for TypeScript, JavaScript, Python, Go, Rust, and Ruby
- **Opinionated Decision Cards** — structured card schema with `why`, `tradeoffs`, `watchouts`, and `evidence` fields

## [1.2.0] - 2026-06-10

### Added
- **`build_dossier` MCP Prompt** — agents no longer need a copy-pasted prompt; one `/prompt build_dossier` triggers the full analysis loop
- **Single-file UI bundle** — `vite-plugin-singlefile` collapses the Dossier UI into one self-contained `index.html` with no external asset fetches

### Fixed
- Dossier JSON injection now uses an HTML comment marker (`<!-- VIBE_DOSSIER_INJECTION_POINT -->`) instead of searching for `</head>`, which breaks in minified bundles

## [1.1.0] - 2026-06-10

### Added
- **Brain inlined into CLI bundle** — `@vibe-splain/brain` is bundled via esbuild so `npx vibe-splain` works without a separate npm install

### Fixed
- UI template path resolved relative to the CLI entrypoint, not the source file, so it survives esbuild bundling
- Recommended prompt now strictly forbids `localhost` URLs, preventing agents from generating unreachable links

## [1.0.0] - 2026-06-10

### Added
- **MCP Server** with 7 tools: `scan_project`, `get_file_context`, `write_decision_card`, `get_strategic_overview`, `inspect_pillar`, `get_wild_discoveries`, `mark_stale`
- **Tree-Sitter analysis engine** with three-level scanning:
  - Level 0: Pillar detection via import string regex (Auth, Database, Payments, etc.)
  - Level 1: Cognitive weight via AST analysis (link density, nesting depth, mutation count)
  - Level 2: Unlabeled file clustering by directory
- **One-command install** (`npx vibe-splain install`) supporting Claude Code, Gemini CLI, Cursor, and Windsurf
- **Dossier UI** — React app with dark theme, Mermaid diagrams, Shiki syntax highlighting
  - Works from `file://` URLs (no server required)
  - Pillar tabs, Decision Cards with fresh/stale badges, Evidence sidebar
- **File watcher** (Chokidar) that marks Decision Cards stale when source files change
- **Atomic persistence** with `async-mutex` and tmp+rename pattern
- **Import graph** generation and persistence
