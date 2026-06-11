# PRD: VIBE-SPLAIN — The Interactive Architectural Dossier
**Version:** 2.0 | **Status:** Approved for Agent Execution | **Date:** 2026-06-10

---

## 1. Core Intent

VIBE-SPLAIN is an MCP server and static analysis engine that runs **inside** the user's existing coding agent (Claude Code, Gemini CLI, Cursor, etc.). It performs surgical structural analysis of a codebase — parsing files, computing complexity scores, and clustering high-gravity logic — then exposes that structured intelligence as MCP tools. The ambient agent provides all LLM synthesis; VIBE-SPLAIN provides zero LLM calls of its own.

It is built for **founders and developers** who have lost mental ownership of a "vibe-coded" codebase and need their existing coding agent to rapidly reconstruct a strategic mental model — without the agent blindly reading every source file from scratch.

---

## 2. In-Scope (MVP)

> **IMPORTANT:** The existing `broken_build/` directory contains a prior attempt. The agent MUST audit it for salvageable logic (Tree-Sitter parsing, CLI scaffolding) but treat the UI as a full slate wipe (D3, ReactFlow, and WebSocket real-time sync are **explicitly discarded**). The LLM condensation layer (`condensation.ts`) is **deleted entirely** — it is replaced by MCP tools that the ambient agent calls.

---

### A. Distribution & Installation

- **Package name:** `vibe-splain` (published to the public npm registry).
- **Install methods:** Works identically via `npx vibe-splain install` or after a global `npm install -g vibe-splain && vibe-splain install`. The user does not need to choose — both paths run the same `install` command.
- **Pre-publish cleanup:** The `broken_build/` directory MUST be deleted from the repository before `npm publish`. It is development scaffolding only and must not ship in the npm package.
- **The `install` command:**
  1. Detects which coding agents are present on the user's machine by checking for known config file paths (see table below).
  2. Adds a VIBE-SPLAIN MCP server entry to every detected agent config.
  3. Prints a confirmation per agent and instructs the user to restart.
  - No agent detected → prints a helpful error with manual config instructions.

**Agent config paths to check (in order):**

| Agent | Config file path |
|---|---|
| Claude Code (macOS) | `~/.claude/claude_desktop_config.json` |
| Claude Code (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Gemini CLI | `~/.gemini/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

**MCP server entry written to detected config(s):**
```json
{
  "mcpServers": {
    "vibe-splain": {
      "command": "npx",
      "args": ["-y", "vibe-splain", "serve"]
    }
  }
}
```
*(If the user has done `npm install -g`, the command will still work — npx falls back to the global install.)*

- **Monorepo bin wiring:** `packages/cli/package.json` MUST have `"bin": { "vibe-splain": "./dist/index.js" }`. Entrypoint MUST start with `#!/usr/bin/env node`.
- **What gets published:** `packages/cli` and `packages/brain` only. `packages/ui` is bundled into `packages/cli/dist/public/` at build time.
- **Version:** Starts at `1.0.0`. Validated via `npm pack --dry-run`. Agent must NOT publish during development.

---

### B. MCP Server (`vibe-splain serve`)

This is the primary runtime mode. When the ambient coding agent starts, it launches `npx vibe-splain serve` as a subprocess. The server exposes the following MCP tools over stdio (standard MCP transport).

**No standalone HTTP server.** VIBE-SPLAIN does NOT bind any port or run an HTTP server independently. The Dossier UI is a static bundle embedded in the package. When `scan_project` completes, the MCP server writes the UI bundle + `dossier.json` to `.vibe-splainer/ui/` in the project root and returns a `file://` URL pointing to `.vibe-splainer/ui/index.html`. The ambient agent surfaces this as a clickable link. The user opens it in their browser directly — no server required.

**Tool descriptions are authoritative.** Each MCP tool's `description` field encodes the correct usage sequence so the ambient agent understands the workflow without additional prompting. The `scan_project` tool description explicitly states: *"Call this first. Then call get_file_context for each high-gravity file, synthesize a narrative, and call write_decision_card to persist it. Repeat for each pillar."*

#### Tool 1: `scan_project`
- **Input:** `{ "path": "/absolute/path/to/project" }`
- **What it does:** Runs the full Structural Scout (see section C) on the given path. Writes `graph.json` and a skeleton `dossier.json` to `.vibe-splainer/` in the project root. Also writes the UI static bundle to `.vibe-splainer/ui/`. Returns a structured summary including a `uiUrl` the ambient agent should surface as a clickable link.
- **Incremental re-scan:** If `.vibe-splainer/dossier.json` already exists, `scan_project` compares the SHA-256 of each currently high-gravity file against `lastScannedHash` in existing Decision Cards. Cards whose file hash is **unchanged** are preserved as-is. Only files that are new, changed, or newly above the High-Gravity threshold are included in the returned `highGravityFiles` list for the agent to re-synthesize. The agent is NOT asked to re-write cards for unchanged files.
- **Output:**
```json
{
  "projectRoot": "/abs/path",
  "totalFiles": 47,
  "highGravityFiles": 8,
  "newOrChangedFiles": 3,
  "preservedCards": 15,
  "pillars": [
    { "name": "Auth", "files": ["src/auth/tokens.ts", "src/middleware/auth.ts"] },
    { "name": "Database", "files": ["src/db/prisma.ts"] }
  ],
  "wildCandidates": ["src/utils/orchestrator.ts"],
  "uiUrl": "file:///abs/path/.vibe-splainer/ui/index.html"
}
```

#### Tool 2: `get_file_context`
- **Input:** `{ "path": "/abs/path/to/project", "file": "src/auth/tokens.ts" }`
- **What it does:** Returns the full source content of a specific file referenced in the scan, along with its Cognitive Weight breakdown and a list of its import/export neighbors. This is what the ambient agent calls to get the raw material for synthesizing a Decision Card narrative.
- **Output:**
```json
{
  "file": "src/auth/tokens.ts",
  "source": "...full file content...",
  "cognitiveWeight": 22.5,
  "breakdown": { "linkDensity": 6, "nestingDepth": 4, "mutationCount": 3 },
  "imports": ["src/config/env.ts", "src/db/prisma.ts"],
  "importedBy": ["src/middleware/auth.ts", "src/routes/user.ts"]
}
```

#### Tool 3: `write_decision_card`
- **Input:** A fully-formed Decision Card object (see schema in section D). The ambient agent calls this after synthesizing a narrative.
- **What it does:** Writes (or upserts) the Decision Card into `.vibe-splainer/dossier.json`. Validates that the Mermaid diagram string (if present) contains ≤ 7 nodes before writing — rejects with an error if not.
- **Output:** `{ "success": true, "cardId": "uuid" }`

#### Tool 4: `get_strategic_overview`
- **Input:** `{ "path": "/abs/path/to/project" }`
- **What it does:** Returns the current state of `dossier.json` — all pillar names, card counts, stale flags. Used by the ambient agent to understand what has already been analyzed.
- **Output:** Full `dossier.json` structure (see section D), minus the `evidence.snippet` fields (to keep token count low).

#### Tool 5: `inspect_pillar`
- **Input:** `{ "path": "/abs/path/to/project", "pillar": "Auth" }`
- **What it does:** Returns all Decision Cards for a specific pillar, including full evidence snippets.
- **Output:** `{ "pillar": "Auth", "decisions": [ ...DecisionCard[] ] }`

#### Tool 6: `get_wild_discoveries`
- **Input:** `{ "path": "/abs/path/to/project" }`
- **Output:** `{ "wildDiscoveries": [ ...DecisionCard[] ] }`

#### Tool 7: `mark_stale`
- **Input:** `{ "path": "/abs/path/to/project", "file": "src/auth/tokens.ts" }`
- **What it does:** Manually marks all Decision Cards whose `evidence` references the given file as `status: "stale"`. Used by the ambient agent if it detects the file changed during a session.
- **Output:** `{ "markedStale": ["card-uuid-1", "card-uuid-2"] }`

---

### C. The Structural Scout (`packages/brain` — Tree-Sitter WASM)

Triggered by the `scan_project` MCP tool. No LLM involvement at any point.

- **File exclusions (hard):** `node_modules/`, `dist/`, `build/`, `.next/`, `*.test.*`, `*.spec.*`, `*.config.*`, `*.lock`, `*.min.js`, `*.d.ts`.
- **Supported file types:** `.ts`, `.tsx`, `.js`, `.jsx` only.

**Level 0 — Heuristics:**
Regex/import-name scan. Tags files into known Strategic Pillars if their import list or filename matches a known keyword:

| Pillar | Keywords |
|---|---|
| Auth | `passport`, `jsonwebtoken`, `bcrypt`, `oauth`, `session`, `cookie-parser` |
| Database | `prisma`, `mongoose`, `sequelize`, `typeorm`, `knex`, `pg`, `mysql` |
| Payments | `stripe`, `paypal`, `braintree`, `plaid` |
| Routing | `express.Router`, `fastify`, `koa-router`, `next/router` |
| Queue | `bull`, `bullmq`, `amqplib`, `kafka`, `redis` |
| Storage | `aws-sdk`, `s3`, `multer`, `cloudinary`, `@google-cloud/storage` |
| Config | `dotenv`, `convict`, `zod` (when used for env schemas) |

**Level 1 — Cognitive Weight Scoring:**
Tree-Sitter parses every non-excluded file and computes:
- `link_density` = in-degree + out-degree of import edges
- `nesting_depth` = maximum AST nesting depth of function/class bodies
- `mutation_count` = assignments to non-`const` identifiers
- `cognitive_weight` = `(link_density * 2) + nesting_depth + (mutation_count * 1.5)`

Files with `cognitive_weight >= 15` are tagged **High-Gravity**.

**Level 2 — Unlabeled Cluster Grouping:**
High-Gravity files NOT tagged by Level 0 heuristics are grouped by their nearest common directory ancestor. These groups become candidate pillars with a placeholder name equal to their directory path (e.g., `src/utils`). The ambient agent, upon receiving `scan_project` output, is expected to rename these using its own judgment — VIBE-SPLAIN does not call an LLM to label them.

**Output:** Writes `graph.json` to `.vibe-splainer/graph.json`:
```json
{
  "scannedAt": "ISO8601",
  "files": [
    { "path": "src/auth/tokens.ts", "cognitiveWeight": 22.5, "pillar": "Auth", "isHighGravity": true, "sha256": "abc123" }
  ]
}
```

---

### D. `dossier.json` — The Canonical Output

Written to `.vibe-splainer/dossier.json` in the scanned project root. Skeleton is created by `scan_project`; Decision Cards are filled in by the ambient agent calling `write_decision_card`.

```json
{
  "version": "2.0",
  "scannedAt": "ISO8601",
  "projectRoot": "/abs/path",
  "pillars": [
    {
      "name": "Auth",
      "cardCount": 3,
      "decisions": [
        {
          "id": "uuid-v4",
          "pillar": "Auth",
          "title": "JWT Refresh Token Rotation Strategy",
          "narrative": "3–5 sentence plain-English explanation written by the ambient agent.",
          "evidence": [
            { "file": "src/auth/tokens.ts", "startLine": 42, "endLine": 67, "snippet": "...raw source lines..." }
          ],
          "diagram": "stateDiagram-v2\n  [*] --> Active\n  Active --> Rotating\n  Rotating --> Active\n  Rotating --> Expired\n  Expired --> [*]",
          "status": "fresh",
          "lastScannedHash": "sha256-of-file-at-scan-time"
        }
      ]
    }
  ],
  "wildDiscoveries": [],
  "stalePaths": []
}
```

**Decision Card constraints (enforced by `write_decision_card`):**
- `narrative` must be a non-empty string.
- `evidence` must have ≥ 1 item with a valid `file` path, `startLine`, and `endLine`.
- `diagram` is optional. If provided, the Mermaid string must contain ≤ 7 nodes (validated programmatically by counting node declaration tokens — reject if > 7).
- `status` must be `"fresh"` or `"stale"`.

---

### E. File Watcher

Runs as part of `vibe-splain serve`. Uses `chokidar` to watch every file path referenced in `dossier.json`.

- On file change: recomputes SHA-256 of the changed file, compares to `lastScannedHash` on the relevant Decision Card(s). If different, sets `status: "stale"` and adds the path to `stalePaths`. Writes updated `dossier.json` to disk so the UI reflects the change on next load/refresh.
- Does **NOT** call any LLM or trigger a re-scan.
- Does **NOT** watch `node_modules/`, `dist/`, or `build/`.

---

### F. The Dossier UI (`packages/ui` — React + Vite)

> Full slate wipe of the broken build's UI. No D3, ReactFlow, or WebSocket code.

**Delivery:** The UI is a fully static bundle (no server required). At build time it is copied into `packages/cli/dist/ui/`. When `scan_project` runs, this bundle is written to `.vibe-splainer/ui/` in the scanned project root alongside `dossier.json`. The user opens it as a local `file://` URL — no `localhost` server, no port, no network.

**Data loading:** On load, the UI reads `dossier.json` from the same `.vibe-splainer/` directory using a relative path (`../dossier.json` from the UI's location). It does NOT make any network requests. It reads from disk only.

**Refresh:** The UI has a manual "Refresh" button that re-reads `dossier.json` from disk. No polling, no WebSockets (file:// protocol does not support either cleanly).

**Layout:** Two-column, no graph canvas:
- **Left/Center (70%):** The Dossier Narrative Panel.
- **Right (30%):** The Evidence Sidebar.

**Left Panel — Narrative:**
- Sticky header: project name, scan timestamp, amber "STALE" badge if `stalePaths.length > 0`.
- Horizontal tab row: one tab per Pillar + "Wild Discoveries" tab (only if `wildDiscoveries.length > 0`).
- Active tab: vertical stack of Decision Cards.
  - Card header: title + per-card stale badge if `status === "stale"`.
  - Card body: `narrative` as plain paragraphs.
  - Inline Mermaid.js SVG if `diagram` is non-null.
  - "Evidence" button: populates the Evidence Sidebar.

**Right Panel — Evidence Sidebar:**
- Default: empty with instructional copy ("Click 'Evidence' on a card to trace the code.").
- Active: Shiki-highlighted code blocks, one per evidence item. The `startLine–endLine` range is visually highlighted (distinct background). File path shown as a breadcrumb above each block.
- Sticky and independently scrollable.

**Theme:** "Forensic Dark Mode":
- Background: `#0d0f14`
- Amber/gold accent (`#f5a623`): stale badges, highlights
- Electric teal (`#00e5cc`): active tabs, interactive elements
- Monospace font for code, sans-serif for narrative
- No light mode toggle

---

## 3. Out-of-Scope (Strict Boundaries)

The agent is **FORBIDDEN** from implementing any of the following:

- ❌ **No LLM calls from VIBE-SPLAIN itself.** The tool does zero AI inference. It is a pure static analysis engine + MCP server. All LLM synthesis happens in the ambient agent.
- ❌ **No API keys.** No `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or any LLM credential. If the agent writes code that reads any AI API key, it is wrong.
- ❌ **No node-link graphs.** No D3, ReactFlow, Cytoscape, vis.js, or any graph canvas.
- ❌ **No HTTP server or bound port of any kind.** The UI is a static `file://` bundle. No `localhost`, no port binding.
- ❌ **No polling or WebSockets in the UI.** The UI has a manual Refresh button only.
- ❌ **No automatic re-scan on file change.** Watcher marks stale only.
- ❌ **No hosted databases.** All state is local filesystem only.
- ❌ **No support for non-JS/TS files in MVP.** Python, Go, Rust, etc. are out of scope.
- ❌ **No user authentication or multi-user support.**
- ❌ **No cloud deployment or CI/CD generation.**
- ❌ **No LangChain, LlamaIndex, Vercel AI SDK, or any AI abstraction framework.**
- ❌ **No browser extension or IDE plugin.**
- ❌ **No light mode toggle.**

---

## 4. Core User Workflows

### Workflow 1: Installation ("Add VIBE-SPLAIN to My Agent")

1. User is in their terminal. They run: `npx vibe-splain install` (or `npm install -g vibe-splain && vibe-splain install`).
2. The `install` command scans for known agent config files on the machine.
3. It patches every detected config with the `vibe-splain` MCP server entry.
4. Prints: `✅ Added to Claude Code. ✅ Added to Cursor. Restart your agent(s) to activate.`
5. User restarts their agent. VIBE-SPLAIN is now available as a set of tools.

### Workflow 2: First Scan ("Vibe This Codebase")

1. User is inside their coding agent (e.g., Claude Code).
2. User says: *"vibe-splain my project at ~/code/my-startup"* (or similar natural language).
3. The ambient agent calls the `scan_project` MCP tool with `{ "path": "/Users/user/code/my-startup" }`.
4. VIBE-SPLAIN runs the Structural Scout, writes `graph.json` and a skeleton `dossier.json`, and returns the structured summary to the agent.
5. The agent calls `get_file_context` for each High-Gravity file it wants to analyze.
6. The agent synthesizes a Decision Card narrative using its own LLM intelligence and calls `write_decision_card` to persist it.
7. Steps 5–6 repeat for each pillar.
8. When done, the agent reports: *"I've analyzed 5 pillars and written 18 Decision Cards. Open http://localhost:42069 to browse the dossier."*
9. User opens the browser and sees the populated Dossier UI.

### Workflow 3: Ongoing Use ("What's Stale?")

1. User has been working. Files have changed.
2. The file watcher has already marked affected Decision Cards as `status: "stale"`.
3. User says: *"What's stale in my vibe-splain dossier?"*
4. Agent calls `get_strategic_overview` — sees `stalePaths` is non-empty.
5. Agent calls `get_file_context` for each stale file, synthesizes updated narratives, calls `write_decision_card` to overwrite the stale card.
6. UI refreshes on next 30-second poll and stale badges disappear.

---

## 5. Acceptance Criteria

The MVP is complete when **all** of the following are true:

### Installation
- [ ] `npx vibe-splain install` on a machine with Claude Code installed patches `~/.claude/claude_desktop_config.json` with the correct MCP server entry and exits with code 0.
- [ ] `npx vibe-splain install` on a machine with no recognized agent prints a helpful manual-config message and exits with code 1.
- [ ] `npx vibe-splain install` is idempotent — running it twice does not create duplicate entries.
- [ ] After install, restarting Claude Code makes the `scan_project` tool available in the agent's tool list.

### MCP Server
- [ ] `npx vibe-splain serve` starts without error and accepts MCP tool calls over stdio.
- [ ] All 7 MCP tools (`scan_project`, `get_file_context`, `write_decision_card`, `get_strategic_overview`, `inspect_pillar`, `get_wild_discoveries`, `mark_stale`) are registered and callable.
- [ ] `scan_project` called on the `broken_build/` project returns a response with ≥ 1 pillar and ≥ 1 High-Gravity file.
- [ ] `write_decision_card` with a Mermaid diagram containing > 7 nodes returns an error and does NOT write to `dossier.json`.
- [ ] `inspect_pillar` with an invalid pillar name returns a structured error: `{ "error": "Pillar not found" }`.

### Structural Scout
- [ ] Tree-Sitter parses `.ts` and `.tsx` files without throwing on valid TypeScript syntax.
- [ ] Cognitive Weight is computed for every non-excluded file. Computation is deterministic.
- [ ] High-Gravity threshold `cognitive_weight >= 15` is enforced. Files below threshold are NOT included in `scan_project` output's `highGravityFiles` count.
- [ ] Level 0 heuristics correctly tag files containing `prisma`, `stripe`, `passport`, or `jsonwebtoken` imports into their respective pillars.
- [ ] `node_modules/`, `dist/`, `build/`, `*.test.*`, `*.spec.*` files are never included in scan output.

### No LLM Calls
- [ ] A full `scan_project` run completes with `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` all unset. No error related to missing API keys.
- [ ] A network traffic audit during `scan_project` shows zero outbound HTTPS requests to any LLM provider domain.

### File Watcher / Stale Flagging
- [ ] Modifying a file referenced in `dossier.json` causes its card's `status` to change to `"stale"` and `dossier.json` to be rewritten within 5 seconds.
- [ ] Stale flagging triggers zero LLM or network calls.

### Dossier UI
- [ ] Opening `.vibe-splainer/ui/index.html` as a `file://` URL in a browser displays the UI without console errors.
- [ ] The UI reads `dossier.json` via a relative path from its own location — no network request is made.
- [ ] All pillar tabs render and are clickable. Each correctly filters to its pillar's Decision Cards.
- [ ] "Wild Discoveries" tab only renders if `wildDiscoveries.length > 0`.
- [ ] Clicking "Evidence" populates the Evidence Sidebar with Shiki-highlighted code.
- [ ] Cards with `status === "stale"` show an amber "STALE" badge.
- [ ] Mermaid diagrams render as SVG (no raw diagram text visible).
- [ ] Manual "Refresh" button re-reads `dossier.json` from disk and re-renders the UI.
- [ ] `npm run build` output contains no `d3` or `reactflow` chunks.
- [ ] UI renders without horizontal scrollbar at 1440×900.

### npm Publishability
- [ ] `npm pack --dry-run` in `packages/cli` exits code 0 and lists a tarball with a `bin` entry for `vibe-splain`.
- [ ] `packages/cli/dist/ui/index.html` exists after `npm run build` (confirms UI bundle is embedded in CLI).
- [ ] `node packages/cli/dist/index.js --version` prints the version string without error.
- [ ] The `broken_build/` directory does not exist in the published tarball (verified via `npm pack --dry-run` file list).

### Non-Functional
- [ ] `scan_project` completes in < 30 seconds on a 50-file TypeScript project (no LLM, should be fast).
- [ ] `scan_project` on a previously-scanned project where 0 files changed returns `newOrChangedFiles: 0` and does not ask the agent to re-synthesize any cards.
- [ ] No API key of any kind appears in any file written to disk or any MCP tool output.
