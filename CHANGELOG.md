# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.5.0] - 2026-06-20

Initial public release.

### Added
- **Static AST analysis** (`@vibe-splain/brain`) — Tree-Sitter scanning that scores every file by **gravity** (PageRank centrality, fan-in, cyclomatic complexity, public surface, nesting) and **heat** (complexity, code smells, tech-debt markers), and clusters files into architectural pillars.
- **MCP server + CLI** (`vibe-splain`) — `scan_project`, `get_project_map`, `set_project_brief`, `get_file_context`, `write_decision_card`, `get_strategic_overview`, `inspect_pillar`, `get_wild_discoveries`, `mark_stale`, plus file skeleton / read / hydration tools. `install` patches a coding agent's MCP config; `serve` runs the stdio server; `scan` runs a one-shot headless scan.
- **Deterministic PreToolUse hook** — an O(1) gate-index lookup that classifies the blast radius of a pending edit (low → defer, medium → inject context, high → ask) with zero model calls.
- **Interactive Dossier UI** (`@vibe-splain/ui`) — a portable single-file `file://` viewer with dependency graphs, gravity rankings, decision cards, and inline Mermaid diagrams.
- An optional `DomainAdapter` extension point for projects that want to contribute product-specific `behavioralLift`. None ship with the core — every scan is pure static analysis (`behavioralLift = 0`, `gravity == staticGravity`).

Zero LLM calls, zero API keys, zero bound ports.
