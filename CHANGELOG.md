# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
