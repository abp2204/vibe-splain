<p align="center">
  <strong>◈ VIBE-SPLAIN</strong>
  <br />
  <em>Understand any vibe-coded project in minutes, not days.</em>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#mcp-tools">MCP Tools</a> ·
  <a href="#dossier-ui">Dossier UI</a> ·
  <a href="#development">Development</a>
</p>

---

VIBE-SPLAIN is an **MCP server** that runs inside your coding agent (Claude Code, Gemini CLI, Cursor, Windsurf). It performs surgical static analysis of a codebase using [Tree-Sitter](https://tree-sitter.github.io/tree-sitter/), identifies the high-gravity files that hold architectural decisions, and exposes them as MCP tools for your agent to synthesize into an **Architectural Dossier**.

**Zero LLM calls. Zero API keys. Pure static analysis.**

Your coding agent does all the thinking — VIBE-SPLAIN just gives it the right data.

## Install

```bash
npx vibe-splain install
```

That's it. This patches your coding agent's MCP config so it can call VIBE-SPLAIN's tools. Restart your agent, then ask it:

> _"Scan this project and explain its architecture."_

Your agent will call `scan_project`, read the high-gravity files, and build a Dossier — a structured set of **Decision Cards** explaining _why_ the code exists.

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

1. **Level 0 — Pillar Detection**: Regex-matches import strings against known library patterns (e.g., `passport` → Auth, `stripe` → Payments, `prisma` → Database) to auto-categorize files.

2. **Level 1 — Cognitive Weight**: Tree-Sitter AST analysis computes a complexity score per file:
   ```
   cognitiveWeight = (linkDensity × 2) + nestingDepth + (mutationCount × 1.5)
   ```
   Files scoring ≥ 15 are **High-Gravity**. Files ≥ 25 are **Wild Discoveries**.

3. **Level 2 — Unlabeled Clustering**: Files without pillar tags are grouped by directory for the agent to name.

## MCP Tools

VIBE-SPLAIN exposes **7 tools** over MCP stdio:

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
4. write_decision_card → persist the narrative
5. Share the file:// UI link with the user
```

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
├── brain/           # @vibe-splain/brain — analysis engine
│   └── src/
│       ├── scanner.ts    # Tree-Sitter AST analysis (L0 + L1 + L2)
│       ├── dossier.ts    # Atomic persistence + UI regeneration
│       ├── graph.ts      # Import graph read/write
│       └── watcher.ts    # Chokidar file watcher
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

- **No LLM calls**: VIBE-SPLAIN is a pure static analysis tool. The coding agent provides all synthesis.
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
