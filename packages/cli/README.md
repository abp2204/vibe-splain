<p align="center">
  <strong>◈ vibesplain</strong><br/>
  <em>Give your AI agent an architectural map of any codebase.</em>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#mcp-tools">MCP Tools</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#development">Development</a>
</p>

---

**vibesplain** is an MCP server that scans a codebase with Tree-Sitter, scores every file by importance and complexity, and produces an **Architectural Dossier** — a structured set of decision cards your agent writes after analyzing the code.

The output is a self-contained HTML file you can open in any browser.

**Zero LLM calls. Zero API keys. Zero network. Pure static analysis.**

---

## Install

```bash
npx vibe-splain install
```

This patches your coding agent's config to register vibesplain as an MCP server. Restart your agent afterward.

| Agent | Config patched |
|-------|---------------|
| Claude Code | `~/.claude/settings.json` |
| Claude Desktop | `~/.claude/claude_desktop_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

---

## Usage

Once installed, open a project in your agent and run the built-in prompt:

**Claude Code / Gemini CLI:**
```
/prompt build_dossier
```

**Cursor / Windsurf:** Select the `build_dossier` prompt from the vibesplain MCP panel.

Your agent will:
1. Scan the project and rank files by architectural importance
2. Read each high-importance file in depth
3. Write a **Decision Card** for each — thesis, blast radius, evidence, optional diagram
4. Return a `file://` link to the Dossier UI

Open the link. Done.

---

## MCP Tools

The `build_dossier` prompt orchestrates these tools automatically. You can also call them manually.

| Tool | What it does |
|------|-------------|
| `scan_project` | Scans the repo. Returns ranked files grouped by architectural pillar. Call this first. |
| `get_project_map` | Returns the pillar map, top-gravity files, and wild-discovery candidates. |
| `set_project_brief` | Stores a 3–5 sentence project summary. Write this before any decision cards. |
| `get_file_context` | Returns full source + import graph + hot spans for a specific file. |
| `write_decision_card` | Persists a decision card (thesis, category, evidence, optional Mermaid diagram). |
| `get_strategic_overview` | Returns dossier state without evidence snippets — useful for quick status checks. |
| `inspect_pillar` | Returns all decision cards for a given architectural pillar. |
| `get_wild_discoveries` | Returns the highest-complexity files that don't fit standard patterns. |
| `mark_stale` | Marks a file's decision card as stale after you edit it. |

---

## How It Works

vibesplain runs a deterministic static analysis pipeline — no model calls, no network:

```
Your project
    │
    ▼
Tree-Sitter AST parsing
    │
    ├── Gravity score (0–100)
    │     PageRank centrality × fan-in × cyclomatic complexity
    │     × public surface × nesting depth
    │
    ├── Heat score (0–100)
    │     Smell density: swallowed catches, deep nesting,
    │     long functions, god files, magic numbers
    │
    └── Pillar detection
          Auth / Database / Payments / Queue /
          Storage / Config / Email / Realtime / Logic
              │
              ▼
        .vibesplain/
        ├── dossier.json      ← agent writes decision cards here
        ├── analysis.json     ← raw scored file store
        ├── graph.json        ← import graph
        └── ui/index.html     ← self-contained dossier viewer
```

**Top 12 by gravity** = Start Here (the load-bearing hubs).  
**Top 12 by heat** = Wild Discoveries (the most complex / smelly files).

The UI is a single self-contained HTML file. Open it with `file://` — no server needed.

---

## Dossier UI

After your agent writes decision cards, open the generated file:

```
file:///path/to/your/project/.vibesplain/ui/index.html
```

Features:
- Pillar tabs to navigate architectural areas
- Decision cards with fresh/stale status
- Mermaid diagrams rendered inline
- Syntax-highlighted evidence snippets
- Works fully offline from `file://`

---

## Architecture

```
packages/
├── brain/    # @vibesplain/brain — pure static analysis, no I/O side effects
│   └── src/
│       ├── pipeline/         # 13-stage analysis pipeline
│       │   └── adapters/     # Optional domain-adapter extension point (none bundled)
│       ├── scanner.ts        # Tree-Sitter AST + gravity/heat scoring
│       ├── dossier.ts        # Atomic dossier persistence + UI injection
│       ├── analysis.ts       # Scored file store + validation report
│       └── graph.ts          # Import graph read/write
│
├── cli/      # vibe-splain (npm) / vibesplain (binary) — MCP server + CLI
│   └── src/
│       ├── index.ts          # CLI entrypoint
│       ├── commands/
│       │   ├── install.ts    # Patches agent MCP configs
│       │   └── serve.ts      # Starts the MCP server
│       ├── export/           # Artifact writing (HTML, Markdown, JSON)
│       └── mcp/
│           ├── server.ts     # MCP tool registration
│           └── tools/        # One file per tool
│
└── ui/       # @vibesplain/ui — React dossier viewer (embedded into cli at build time)
```

**Build order:** `brain` → `cli` → `ui` → `bundle-ui` (copies `ui/dist/` into `cli/dist/ui/`).  
Only the `cli` package is published to npm.

---

## Development

```bash
git clone https://github.com/abp2204/vibesplain.git
cd vibesplain
npm install
npm run build          # full build
npm run dev:ui         # Vite dev server for the UI
npm run test:regression
```

Test locally after build:

```bash
node packages/cli/dist/index.js install
node packages/cli/dist/index.js serve
```

Publish:

```bash
npm run release
```

---

## License

[MIT](LICENSE)
