<p align="center">
  <strong>◈ vibe-splain</strong>
  <br />
  <em>Map architectural DNA and behavioral call-chains in complex codebases.</em>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#mcp-tools">MCP Tools</a> ·
  <a href="#dossier-ui">Dossier UI</a> ·
  <a href="#development">Development</a>
</p>

---

vibe-splain is a high-fidelity **static analysis engine** and MCP server. It uses [Tree-Sitter](https://tree-sitter.github.io/tree-sitter/) to extract the structural and behavioral patterns of a codebase—identifying high-gravity components, mapping semantic actions, and tracing call-chains between entrypoints and side effects.

While vibe-splain is built on a language-agnostic foundation, the current toolset is **highly optimized for TypeScript and JavaScript** (especially Next.js, Prisma, and tRPC environments).

**Zero LLM calls. Zero API keys. Pure static analysis.**

Your coding agent does all the thinking — vibe-splain just gives it the right data.

## Install

```bash
npx vibe-splain install
```

That's it. This patches your coding agent's MCP config so it can call vibe-splain's tools. Restart your agent.

### Running the Analysis

You don't need to write a complex prompt. vibe-splain provides a built-in MCP Prompt called `build_dossier` that automatically tells your agent exactly what to do.

**In Claude Code / Gemini CLI:**
Type `/prompt build_dossier` and press enter.

**In Cursor / Windsurf:**
Open the MCP panel or agent chat, select the `build_dossier` prompt from the vibe-splain server, and run it.

Your agent will loop through the high-gravity files, analyze each one, and build an **Architectural Dossier** — a structured set of **Decision Cards** explaining the technical rationale of the code.

### Supported Agents

| Agent | Config File |
|-------|------------|
| Claude Code | `~/.claude/claude_desktop_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│  Your Coding Agent (Claude / Gemini / Cursor)           │
│                                                         │
│  "Scan this project" ──► scan_project ──► get_file_ctx  │
│                             │                  │        │
│  Agent synthesizes  ◄──────┘   ◄──────────────┘        │
│  narratives + diagrams                                  │
│       │                                                 │
│       ▼                                                 │
│  write_decision_card ──► .vibe-splainer/dossier.json    │
│                               │                         │
│                               ▼                         │
│                    file:// Dossier UI                    │
└─────────────────────────────────────────────────────────┘
```

### Three Levels of Analysis
1. **Level 0 — Semantic Classification**: Maps files to architectural "pillars" (Auth, Payments, Database, etc.) using import-path heuristics and library signatures.
2. **Level 1 — Structural Gravity**: Computes `gravity` (0–100) using Tree-Sitter AST analysis — PageRank centrality, fan-in, cyclomatic complexity, public surface, and nesting depth. High-gravity files are the load-bearing hubs of the codebase. (An optional domain-adapter extension point exists for projects that want to add product-specific `behavioralLift`, but no adapters ship with the core — every scan is pure static analysis.)
3. **Level 2 — Behavioral Traceability**: Tree-Sitter powered call-graph analysis. It maps function-level dependencies and identifies **Critical Functions** (entrypoints, semantic actions, or high-outbound callers).

### Claude Code PreToolUse Hook

`vibe-splain` integrates directly with Claude Code's hook system to prevent AI agents from accidentally breaking your codebase:

- **Ultra-Fast Local Gating**: Installs a standalone entrypoint (`dist/hook.js`) that runs in **< 15ms** with zero network calls, avoiding heavy WASM/tree-sitter load overhead.
- **Hybrid Blast-Radius Logic**: Combines static gravity and substance-based direct dependents to protect important files (e.g. dynamically-loaded execution nodes or central utility modules) even if they lack standard entrypoints.
- **Developer Friction Suppression**: Automatically demotes generated, minified, or vendored files to a `low` blast-radius, ensuring the agent is never blocked when editing build targets or lockfiles.
- **Warn-Once session behavior**: If `.vibe-splainer/gate.json` is missing, the hook notifies you exactly once per session to run a project scan, then gracefully gets out of the way.

## MCP Tools

vibe-splain exposes these core dossier tools over MCP stdio:

| Tool | Purpose |
|------|---------|
| `scan_project` | **Call first.** Scans the codebase, returns high-gravity files grouped by pillar. Starts file watcher. |
| `get_file_context` | Returns full source + import graph neighbors for a specific file. |
| `write_decision_card` | Persists a Decision Card (narrative + evidence + optional Mermaid diagram). |
| `get_strategic_overview` | Returns dossier state without evidence snippets (saves tokens). |
| `inspect_pillar` | Returns all Decision Cards for a pillar with full evidence. |
| `get_wild_discoveries` | Returns the most complex files that don't fit standard patterns. |
| `mark_stale` | Marks cards as stale when you modify files during a session. |

### Recommended Agent Workflow

```
1. scan_project → get high-gravity files
2. For each file: get_file_context → read source + neighbors
3. Synthesize: "WHY does this code exist?"
5. write_decision_card → persist the narrative
6. Share the file:// UI link with the user
```

## How It Works

### Deep Analysis Pipeline
Unlike simple regex scanners, vibe-splain runs a deterministic **13-stage pipeline**—from AST inventory and alias resolution to semantic classification and function-level scoring—to ensure every Decision Card is grounded in actual code paths.

### Semantic Rulesets
vibe-splain uses specialized rulesets to understand framework-specific semantics. Current optimizations include:
- **Next.js**: Server Actions, `cookies()`, `headers()`, and App Router conventions.
- **Database**: Prisma model mutations and raw query patterns.
- **API**: tRPC procedure calls (`mutate`/`query`) and standard `fetch`/`axios` patterns.
- **Auth**: Clerk, NextAuth, and custom rate-limiting/validation logic.

## Dossier UI

After your agent writes Decision Cards, open the generated file in your browser:

```
file:///path/to/your/project/.vibe-splainer/ui/index.html
```

The UI features:
- **Dark theme** with glassmorphism and subtle grid texture
- **Pillar tabs** for navigating architectural areas
- **Decision Cards** with fresh/stale status badges
- **Mermaid diagrams** rendered inline as SVG
- **Evidence sidebar** with Shiki syntax highlighting (tokyo-night)
- **Wild Discoveries** tab for the most complex outlier files
- Works entirely offline via `file://` — no server needed

## Architecture

```
packages/
├── brain/           # @vibe-splain/brain — repo-agnostic static analysis core
│   └── src/
│       ├── pipeline/
│       │   └── adapters/ # Optional domain-adapter extension point (none bundled)
│       ├── scanner.ts    # Tree-Sitter AST analysis (static analysis, graph building)
│       ├── dossier.ts    # Atomic persistence + UI regeneration
│       ├── graph.ts      # Import graph read/write
│       └── network/      # Deterministic PreToolUse gate (escalation + gate index)
├── cli/             # vibe-splain — MCP server + CLI
│   └── src/
│       ├── index.ts          # #!/usr/bin/env node entry
│       ├── commands/
│       │   ├── install.ts    # Agent config patcher
│       │   └── serve.ts      # MCP server launcher
│       └── mcp/
│           ├── server.ts     # @modelcontextprotocol/sdk setup
│           └── tools/        # 7 tool handlers
└── ui/              # @vibe-splain/ui — React dossier viewer
    └── src/
        ├── App.tsx               # Main app (reads window.__VIBE_DOSSIER__)
        ├── components/           # Header, PillarTabs, DecisionCard, etc.
        └── index.css             # Design system
```

### Key Design Decisions

- **No LLM calls**: vibe-splain is a pure static analysis tool. The coding agent provides all synthesis.
- **`async-mutex`**: All dossier writes are guarded by a mutex with atomic tmp+rename.
- **`startOnLoad: false`**: Mermaid is initialized manually — never auto-scans the DOM.
- **`base: './'`**: Vite builds with relative paths so the UI works from `file://` URLs.
- **`console.log` banned**: Brain and CLI use only `console.error` to avoid corrupting MCP stdio.
- **Tree-Sitter WASM**: Loaded from the `tree-sitter-wasms` npm package — no network calls.

## Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9 (for workspaces)

### Setup

```bash
git clone https://github.com/abp2204/vibe-splain.git
cd vibe-splain
npm install
```

### Build

```bash
npm run build
```

This runs in sequence: brain → cli → ui → bundle-ui (copies UI dist into CLI dist).

### Dev UI

```bash
npm run dev:ui
```

Starts the Vite dev server for the UI package at `http://localhost:5173`.

### Test Install Locally

```bash
node packages/cli/dist/index.js install
```

### Test MCP Server

```bash
node packages/cli/dist/index.js serve
```

Then send JSON-RPC messages over stdin (see [MCP specification](https://modelcontextprotocol.io)).

### Publish

```bash
npm run release
```

Builds everything and publishes the `vibe-splain` CLI package to npm.

## How the Dossier Stays Fresh

When `scan_project` runs, it starts a [Chokidar](https://github.com/paulmillr/chokidar) file watcher. When source files change:

1. The watcher detects the change
2. Matching Decision Cards are marked **stale** (amber badge in UI)
3. The `stalePaths` array in the dossier tracks which files need re-analysis
4. Your agent can call `get_strategic_overview` to see what's stale, then re-scan

You can also manually mark files stale with `mark_stale` if you modify code during a session.

## License

[MIT](LICENSE)
