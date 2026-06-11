# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-10

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
