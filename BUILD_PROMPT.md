# VIBE-SPLAIN: One-Shot Build Prompt

You are a Principal Software Engineer. Build the complete VIBE-SPLAIN project from scratch in the directory `/Users/aayushpatel/Desktop/Code/VIBE-SPLAIN`. A `broken_build/` directory already exists there — read its source files to understand prior work, but treat it as reference only. Do not port its UI code (D3, ReactFlow) or its LLM condensation layer. Delete `broken_build/` before the final build.

---

## What You Are Building

VIBE-SPLAIN is an MCP server that runs **inside** the user's coding agent (Claude Code, Gemini CLI, Cursor). It performs surgical static analysis of a codebase using Tree-Sitter, exposes the results as MCP tools, and the ambient coding agent (not VIBE-SPLAIN) provides all LLM synthesis. VIBE-SPLAIN makes **zero LLM calls of its own and requires zero API keys**.

The user installs it with one command:
```bash
npx vibe-splain install
```
This patches their coding agent's MCP config file. From then on, their agent can call `scan_project` and the other tools.

---

## Repository Structure to Create

```
/Users/aayushpatel/Desktop/Code/VIBE-SPLAIN/
├── package.json                  # npm workspaces root
├── tsconfig.json                 # base TS config
├── .npmignore
├── scripts/
│   └── bundle-ui.js              # copies packages/ui/dist → packages/cli/dist/ui
├── packages/
│   ├── brain/                    # Tree-Sitter analysis engine
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wasm/                 # tree-sitter WASM grammar files
│   │   └── src/
│   │       ├── index.ts          # exports all brain functions
│   │       ├── scanner.ts        # Structural Scout: Level 0 + Level 1
│   │       ├── graph.ts          # graph.json read/write
│   │       ├── dossier.ts        # dossier.json read/write + atomic writes + UI regeneration
│   │       └── watcher.ts        # chokidar file watcher
│   ├── cli/
│   │   ├── package.json          # has "bin": { "vibe-splain": "./dist/index.js" }
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          # #!/usr/bin/env node — Commander.js CLI entry
│   │       ├── commands/
│   │       │   ├── install.ts    # patches agent MCP config files
│   │       │   └── serve.ts      # starts MCP server
│   │       └── mcp/
│   │           ├── server.ts     # @modelcontextprotocol/sdk server setup
│   │           └── tools/
│   │               ├── scan_project.ts
│   │               ├── get_file_context.ts
│   │               ├── write_decision_card.ts
│   │               ├── get_strategic_overview.ts
│   │               ├── inspect_pillar.ts
│   │               ├── get_wild_discoveries.ts
│   │               └── mark_stale.ts
│   └── ui/
│       ├── package.json
│       ├── vite.config.ts
│       ├── index.html            # template — DO NOT inline data here
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── types.ts           # Dossier, DecisionCard, Evidence types
│           ├── components/
│           │   ├── Header.tsx
│           │   ├── PillarTabs.tsx
│           │   ├── DecisionCard.tsx
│           │   ├── EvidenceSidebar.tsx
│           │   └── MermaidDiagram.tsx
│           └── index.css
```

---

## Build Order — Execute Sequentially

### Step 1: Monorepo Foundation

**Root `package.json`:**
```json
{
  "name": "vibe-splain-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build -w packages/brain && npm run build -w packages/cli && npm run build -w packages/ui && node scripts/bundle-ui.js",
    "dev:ui": "npm run dev -w packages/ui",
    "release": "npm run build && cd packages/cli && npm publish"
  }
}
```

**`scripts/bundle-ui.js`** — plain Node.js, no deps:
```js
const { cpSync, mkdirSync } = require('fs');
const { join } = require('path');
const src = join(__dirname, 'packages/ui/dist');
const dest = join(__dirname, 'packages/cli/dist/ui');
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.error('[bundle-ui] Copied UI bundle to packages/cli/dist/ui/');
```

**Root `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

### Step 2: `packages/brain`

**Dependencies:**
```json
{
  "name": "@vibe-splain/brain",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "web-tree-sitter": "^0.22.0",
    "tree-sitter-wasms": "^0.1.11",
    "chokidar": "^3.6.0",
    "async-mutex": "^0.5.0",
    "uuid": "^9.0.0"
  }
}
```

#### `scanner.ts` — Structural Scout

**Level 0 — Heuristic Pillar Detection (regex on import strings):**

| Pillar | Match keywords |
|--------|---------------|
| Auth | `passport`, `jsonwebtoken`, `bcrypt`, `oauth`, `session`, `cookie-parser` |
| Database | `prisma`, `mongoose`, `sequelize`, `typeorm`, `knex`, `pg`, `mysql2` |
| Payments | `stripe`, `paypal`, `braintree`, `plaid` |
| Routing | `express.Router`, `fastify`, `koa-router`, `next/router` |
| Queue | `bull`, `bullmq`, `amqplib`, `kafka`, `redis` |
| Storage | `aws-sdk`, `s3`, `multer`, `cloudinary`, `@google-cloud/storage` |
| Config | `dotenv`, `convict`, `zod` |

**Level 1 — Cognitive Weight Score (Tree-Sitter AST):**

Formula: `cognitive_weight = (link_density * 2) + nesting_depth + (mutation_count * 1.5)`

- `link_density` = count of import declarations + count of times this file is imported by others
- `nesting_depth` = max depth of nested function/arrow/class bodies in the AST
- `mutation_count` = count of assignment expressions where left side is NOT a `const` declaration

Files with `cognitive_weight >= 15` are **High-Gravity**.

**Level 2 — Unlabeled Cluster Grouping:**
High-Gravity files not tagged by Level 0 are grouped by `path.dirname()`. Group name = the relative directory path (e.g., `src/utils`). Return these as-is — do NOT call an LLM to name them.

**WASM initialization pattern (call ONCE at process startup):**
```typescript
import Parser from 'web-tree-sitter';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let parser: Parser | null = null;

export async function initParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  parser = new Parser();
  const wasmPath = join(__dirname, '../wasm/tree-sitter-typescript.wasm');
  const Lang = await Parser.Language.load(wasmPath);
  parser.setLanguage(Lang);
  return parser;
}
```

**File exclusion globs (hard-exclude, never scan these):**
`node_modules`, `dist`, `build`, `.next`, `.vibe-splainer`, `*.test.*`, `*.spec.*`, `*.config.*`, `*.lock`, `*.min.js`, `*.d.ts`, `.git`

**Supported extensions:** `.ts`, `.tsx`, `.js`, `.jsx` only.

#### `dossier.ts` — Persistence + UI Regeneration

**CRITICAL — Atomic write pattern (use for ALL writes to dossier.json):**
```typescript
import { Mutex } from 'async-mutex';
const dossierMutex = new Mutex();

export async function writeDossier(projectRoot: string, dossier: Dossier): Promise<void> {
  await dossierMutex.runExclusive(async () => {
    const dossierPath = join(projectRoot, '.vibe-splainer', 'dossier.json');
    const tmp = dossierPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(dossier, null, 2), 'utf8');
    await fs.rename(tmp, dossierPath); // atomic on POSIX
    await regenerateUI(projectRoot, dossier); // ALWAYS regenerate UI after every write
  });
}
```

**CRITICAL — UI regeneration (solves file:// CORS problem):**

The UI cannot `fetch('../dossier.json')` in Chrome (blocked for `file://` origins). Instead, every time `dossier.json` changes, regenerate `index.html` with the dossier baked in as an inline script.

```typescript
import { readFile, writeFile, copyFile, mkdir } from 'fs/promises';

export async function regenerateUI(projectRoot: string, dossier: Dossier): Promise<void> {
  const uiDir = join(projectRoot, '.vibe-splainer', 'ui');
  await mkdir(uiDir, { recursive: true });

  // Template index.html lives in CLI's dist/ui (built from packages/ui)
  const templateDir = join(dirname(fileURLToPath(import.meta.url)), '../../cli/dist/ui');
  
  // Copy all assets (JS, CSS chunks) from template to project's .vibe-splainer/ui
  await cpSync(templateDir, uiDir, { recursive: true });

  // Read the template index.html
  let html = await readFile(join(templateDir, 'index.html'), 'utf8');
  
  // Inject dossier data as inline script BEFORE closing </head>
  const injection = `<script>window.__VIBE_DOSSIER__ = ${JSON.stringify(dossier)};</script>`;
  html = html.replace('</head>', `${injection}\n</head>`);
  
  // Write the data-baked index.html to the project's ui dir
  await writeFile(join(uiDir, 'index.html'), html, 'utf8');
}
```

**Mermaid node validation (enforced in `write_decision_card` before any write):**
```typescript
export function validateMermaidNodeCount(diagram: string): boolean {
  if (!diagram) return true;
  // Count unique node IDs: words that appear as the start of a line or after -->
  const nodePattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\[({|>]/gm;
  const statePattern = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
  const nodes = new Set<string>();
  for (const match of diagram.matchAll(nodePattern)) nodes.add(match[1]);
  for (const match of diagram.matchAll(statePattern)) nodes.add(match[1]);
  // Also check for stateDiagram [*] notation
  if (diagram.includes('[*]')) nodes.add('[*]');
  return nodes.size <= 7;
}
```

#### `watcher.ts` — Chokidar File Watcher

```typescript
import chokidar from 'chokidar';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';

export function startWatcher(projectRoot: string, watchedPaths: string[]): void {
  const watcher = chokidar.watch(watchedPaths, {
    ignoreInitial: true,
    ignored: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.vibe-splainer/**'],
    persistent: true,
  });

  watcher.on('change', async (filepath) => {
    // Read current dossier, compute new hash, mark stale if different
    const dossier = await readDossier(projectRoot);
    if (!dossier) return;
    const content = await readFile(filepath, 'utf8');
    const newHash = createHash('sha256').update(content).digest('hex');
    let mutated = false;
    for (const pillar of dossier.pillars) {
      for (const card of pillar.decisions) {
        if (card.evidence.some(e => e.file === filepath || filepath.endsWith(e.file))) {
          if (card.lastScannedHash !== newHash) {
            card.status = 'stale';
            if (!dossier.stalePaths.includes(filepath)) dossier.stalePaths.push(filepath);
            mutated = true;
          }
        }
      }
    }
    if (mutated) await writeDossier(projectRoot, dossier);
  });
}
```

---

### Step 3: `packages/cli`

**`packages/cli/package.json`:**
```json
{
  "name": "vibe-splain",
  "version": "1.0.0",
  "description": "Architectural dossier engine for vibe-coded projects. Runs as an MCP server inside your coding agent.",
  "type": "module",
  "bin": { "vibe-splain": "./dist/index.js" },
  "dependencies": {
    "@vibe-splain/brain": "*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "commander": "^12.0.0",
    "fs-extra": "^11.0.0"
  },
  "files": ["dist/", "!dist/**/*.map"]
}
```

#### `commands/install.ts` — Agent Config Patcher

Detect and patch these config files. Check each path; if the file exists, read + patch + write. If it doesn't exist, skip it. Count how many were patched.

```typescript
const AGENT_CONFIGS = [
  { name: 'Claude Code', path: '~/.claude/claude_desktop_config.json', format: 'claude' },
  { name: 'Claude Code (Windows)', path: '%APPDATA%/Claude/claude_desktop_config.json', format: 'claude' },
  { name: 'Gemini CLI', path: '~/.gemini/settings.json', format: 'gemini' },
  { name: 'Cursor', path: '~/.cursor/mcp.json', format: 'cursor' },
  { name: 'Windsurf', path: '~/.codeium/windsurf/mcp_config.json', format: 'cursor' },
];

const MCP_ENTRY = {
  command: 'npx',
  args: ['-y', 'vibe-splain', 'serve'],
};
```

For `claude` format, the config key is `mcpServers`. For `gemini` format, it's `mcpServers` nested under the root. Research the exact schema for each before writing — read the existing file first if it exists.

**Idempotency:** Before writing, check if `config.mcpServers?.['vibe-splain']` already exists. If it does, print "Already configured" and skip.

**Manual fallback:** If zero agents are detected, print:
```
⚠️  No supported coding agent config found.
Add this manually to your agent's MCP config:

{
  "mcpServers": {
    "vibe-splain": {
      "command": "npx",
      "args": ["-y", "vibe-splain", "serve"]
    }
  }
}
```
Then exit with code 1.

#### `mcp/server.ts` — MCP Server

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// ⚠️ CRITICAL: Never use console.log() anywhere in this codebase.
// stdout is owned by the MCP SDK for protocol messages.
// Use console.error() for all diagnostic output.

export async function startMCPServer(): Promise<void> {
  await initParser(); // Initialize Tree-Sitter WASM once at startup
  
  const server = new Server(
    { name: 'vibe-splain', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  registerAllTools(server); // registers all 7 tools

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Process stays alive — do NOT call process.exit() here
}
```

#### The 7 MCP Tools

Each tool must have a **detailed `description`** that tells the ambient agent exactly when and how to use it. The description IS the orchestration layer.

**`scan_project` description:**
> "Scans a codebase and returns its structural analysis. CALL THIS FIRST before any other tool. Returns High-Gravity files grouped by pillar, plus wildCandidates for unusual high-complexity files. After calling this tool, call get_file_context for each file in highGravityFiles, synthesize a narrative explaining WHY that code exists, then call write_decision_card to persist it. The uiUrl in the response is a file:// link — share it with the user so they can open the Dossier UI in their browser."

**`get_file_context` description:**
> "Returns the full source code of a specific high-gravity file, its cognitive weight breakdown, and its import graph neighbors. Call this for each file you want to synthesize a Decision Card for. Use the source + neighbors to understand what the code does and WHY it was written that way."

**`write_decision_card` description:**
> "Persists a Decision Card you have synthesized to the project's dossier. The narrative should be 3–5 sentences explaining WHY this code exists. Evidence must reference specific line ranges from the actual source. Diagrams are optional but use only stateDiagram-v2, flowchart TD, or linear A-->B-->C style, max 7 nodes. Will reject diagrams with more than 7 nodes."

**`get_strategic_overview` description:**
> "Returns the current state of the dossier without evidence snippets (to save tokens). Use this to see what has already been analyzed and what is stale. Check stalePaths to know which files need re-analysis."

**`inspect_pillar` description:**
> "Returns all Decision Cards for a specific pillar including full evidence snippets. Use when you need deep detail on a specific area of the codebase."

**`get_wild_discoveries` description:**
> "Returns files with extremely high cognitive complexity (weight ≥ 25) that don't fit standard patterns. These are the most surprising and important parts of the codebase to understand."

**`mark_stale` description:**
> "Manually marks Decision Cards as stale when you detect a file has changed. The file watcher does this automatically, but call this if you modify a file yourself during a session."

---

### Step 4: `packages/ui` — The Dossier UI

**This is where you should spend the most time. Make it beautiful.**

**`packages/ui/package.json` dependencies:**
```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "mermaid": "^11.0.0",
    "shiki": "^1.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0"
  }
}
```

**`vite.config.ts`:** Standard React plugin config. Set `base: './'` so asset paths are relative (required for `file://` delivery).
```typescript
export default defineConfig({
  plugins: [react()],
  base: './',  // CRITICAL for file:// URL compatibility
  build: { outDir: 'dist' }
});
```

#### `src/types.ts` — Shared Types

```typescript
export interface Evidence {
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface DecisionCard {
  id: string;
  pillar: string;
  title: string;
  narrative: string;
  evidence: Evidence[];
  diagram: string | null;
  status: 'fresh' | 'stale';
  lastScannedHash: string;
}

export interface Pillar {
  name: string;
  cardCount: number;
  decisions: DecisionCard[];
}

export interface Dossier {
  version: string;
  scannedAt: string;
  projectRoot: string;
  pillars: Pillar[];
  wildDiscoveries: DecisionCard[];
  stalePaths: string[];
}

declare global {
  interface Window {
    __VIBE_DOSSIER__: Dossier;
  }
}
```

#### `src/index.css` — Design System

**Fonts:** Import from Google Fonts: `Inter` (UI text, weights 400/500/600) and `JetBrains Mono` (code). Include in `index.html` `<head>`.

```css
/* ============ DESIGN TOKENS ============ */
:root {
  --bg-base:       #0d0f14;
  --bg-surface:    #13161e;
  --bg-elevated:   #1a1e2a;
  --bg-hover:      #1f2433;

  --accent-amber:  #f5a623;
  --accent-amber-dim: rgba(245, 166, 35, 0.15);
  --accent-teal:   #00e5cc;
  --accent-teal-dim: rgba(0, 229, 204, 0.12);

  --text-primary:  #e8eaf0;
  --text-secondary: #8892a4;
  --text-muted:    #4a5568;
  --text-code:     #a8d8ea;

  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-active: rgba(0, 229, 204, 0.3);

  --font-ui:   'Inter', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.4), 0 1px 4px rgba(0, 0, 0, 0.3);
  --shadow-glow-teal: 0 0 20px rgba(0, 229, 204, 0.15);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.6;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* Subtle grid texture on the background */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(0,229,204,0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,229,204,0.015) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none;
  z-index: 0;
}
```

#### `src/App.tsx`

```typescript
// Three useState calls — this is the COMPLETE state surface of the app
const [dossier] = useState<Dossier>(() => window.__VIBE_DOSSIER__);
const [activePillar, setActivePillar] = useState<string>(
  dossier.pillars[0]?.name ?? 'Wild Discoveries'
);
const [activeEvidence, setActiveEvidence] = useState<Evidence[] | null>(null);
```

Layout: CSS Grid, two columns, full viewport height.
```css
.app-layout {
  display: grid;
  grid-template-columns: 1fr 380px;
  grid-template-rows: auto 1fr;
  height: 100vh;
  overflow: hidden;
  position: relative;
  z-index: 1;
}
```

#### `src/components/Header.tsx`

Sticky top bar spanning full width. Contains:
- Left: `VIBE-SPLAIN` wordmark in teal with a small `◈` glyph prefix. Below it: the project root path in muted monospace.
- Center: Scan timestamp as `"Analyzed [relative time]"` (e.g., "Analyzed 3 hours ago").
- Right: If `dossier.stalePaths.length > 0`, a pulsing amber badge: `⚠ ${n} STALE`. Plus a `↺ Refresh` button that calls `window.location.reload()`.

Header styling:
```css
.header {
  background: rgba(13, 15, 20, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  grid-column: 1 / -1;
}
.wordmark {
  font-size: 18px;
  font-weight: 600;
  color: var(--accent-teal);
  letter-spacing: -0.02em;
}
@keyframes pulse-amber {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.stale-badge {
  animation: pulse-amber 2s ease-in-out infinite;
  background: var(--accent-amber-dim);
  border: 1px solid var(--accent-amber);
  color: var(--accent-amber);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

#### `src/components/PillarTabs.tsx`

Horizontal scrollable tab row. One tab per pillar + "Wild Discoveries" tab (only if `wildDiscoveries.length > 0`).

Active tab: teal bottom border + teal text. Inactive: muted text. Hover: bg-hover. Add a smooth `0.15s` transition on all interactive states.

```css
.tab-bar {
  display: flex;
  gap: 2px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  padding: 12px 20px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  letter-spacing: 0.01em;
}
.tab:hover { color: var(--text-primary); background: var(--bg-hover); }
.tab.active { color: var(--accent-teal); border-bottom-color: var(--accent-teal); }
.tab.wild { color: var(--accent-amber); }
.tab.wild.active { border-bottom-color: var(--accent-amber); }
```

#### `src/components/DecisionCard.tsx`

Each card is a visual centerpiece. Use glassmorphism with a subtle top-accent border.

```css
.decision-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-card);
  transition: border-color 0.2s, transform 0.15s;
  position: relative;
  overflow: hidden;
}
/* Teal top accent line */
.decision-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--accent-teal), transparent);
  opacity: 0.6;
}
.decision-card:hover {
  border-color: var(--border-active);
  transform: translateY(-1px);
  box-shadow: var(--shadow-card), var(--shadow-glow-teal);
}
.decision-card.stale::before {
  background: linear-gradient(90deg, var(--accent-amber), transparent);
}
.card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-narrative {
  color: var(--text-secondary);
  line-height: 1.75;
  margin: 12px 0;
  font-size: 14px;
}
.evidence-btn {
  background: var(--accent-teal-dim);
  border: 1px solid rgba(0, 229, 204, 0.25);
  color: var(--accent-teal);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}
.evidence-btn:hover {
  background: rgba(0, 229, 204, 0.2);
  border-color: var(--accent-teal);
  transform: translateY(-1px);
}
```

#### `src/components/MermaidDiagram.tsx`

```typescript
import mermaid from 'mermaid';
import { useEffect, useRef, useState } from 'react';

mermaid.initialize({
  startOnLoad: false,  // CRITICAL — never allow mermaid to auto-scan DOM
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1a1e2a',
    primaryTextColor: '#e8eaf0',
    primaryBorderColor: '#00e5cc',
    lineColor: '#4a5568',
    secondaryColor: '#13161e',
    tertiaryColor: '#0d0f14',
    edgeLabelBackground: '#13161e',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '13px',
  },
  flowchart: { curve: 'basis' },
});

export function MermaidDiagram({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.render(id, chart)
      .then(({ svg }) => setSvg(svg))
      .catch(() => setError('Could not render diagram'));
  }, [chart]);

  if (error) return null; // Silently hide broken diagrams
  if (!svg) return <div className="diagram-loading">Rendering diagram...</div>;
  return (
    <div
      className="mermaid-container"
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
```

```css
.mermaid-container {
  margin: 16px 0;
  padding: 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow-x: auto;
}
.mermaid-container svg {
  max-width: 100%;
  height: auto;
}
```

#### `src/components/EvidenceSidebar.tsx`

```typescript
import { getHighlighter, type Highlighter } from 'shiki';
import { useEffect, useRef, useState } from 'react';

// Initialize Shiki once, store in ref
const highlighterRef = useRef<Highlighter | null>(null);

useEffect(() => {
  getHighlighter({
    themes: ['tokyo-night'],
    langs: ['typescript', 'javascript', 'tsx', 'jsx'],
  }).then(h => { highlighterRef.current = h; });
}, []);
```

For each evidence item, render highlighted HTML from Shiki. Apply a different background to the highlighted line range (`startLine` to `endLine`). Use Shiki's `decorations` feature or post-process the HTML to wrap target lines in a `<span class="evidence-highlight">`.

File path breadcrumb above each block:
```
src / auth / tokens.ts  [Lines 42–67]
```

```css
.evidence-sidebar {
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 32px;
}
.sidebar-empty-icon { font-size: 32px; opacity: 0.4; }
.evidence-item { border-bottom: 1px solid var(--border-subtle); }
.evidence-breadcrumb {
  padding: 10px 16px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  gap: 6px;
}
.evidence-breadcrumb .filename { color: var(--accent-teal); }
.evidence-breadcrumb .lines { color: var(--accent-amber); margin-left: auto; }
.code-block { overflow-x: auto; font-size: 12px; line-height: 1.6; }
/* Highlighted lines from evidence range */
.code-block :global(.evidence-highlight) {
  background: rgba(245, 166, 35, 0.12);
  border-left: 2px solid var(--accent-amber);
  display: block;
}
```

---

## Critical Constraints — Enforce These Without Exception

1. **`console.log` is BANNED.** The MCP server owns stdout. Any `console.log` in `packages/brain` or `packages/cli` corrupts the MCP stdio stream. Use `console.error()` only. Add an ESLint rule to enforce this.

2. **`window.__VIBE_DOSSIER__` is the ONLY data source for the UI.** Never write a `fetch()` call targeting `dossier.json`. It will fail in Chrome under `file://`.

3. **`mermaid.initialize({ startOnLoad: false })` must be set before any render call.** If Mermaid auto-scans the DOM, it conflicts with React's virtual DOM and causes double-render corruption.

4. **`Parser.init()` is called ONCE at process startup**, not per file. Calling it per-file causes repeated WASM module instantiation and will crash or hang on large codebases.

5. **Every write to `dossier.json` must call `regenerateUI()` immediately after.** If this call is missing anywhere, the UI will show stale data even after a Refresh because `index.html` won't have been updated.

6. **The `vibe-splain serve` process must NOT call `process.exit()`.** It stays alive until the ambient agent disconnects (stdin closes).

7. **`vite.config.ts` must have `base: './'`.** Without this, Vite outputs absolute asset paths that break under `file://`.

8. **`broken_build/` is deleted before publish**, verified by `npm pack --dry-run` not listing it in the tarball.

9. **Zero outbound network calls during `scan_project`.** No LLM API, no telemetry, no analytics. Tree-Sitter WASM is loaded from local bundled files only.

10. **`async-mutex` wraps all read-modify-write cycles on `dossier.json`.** The ambient agent may call `write_decision_card` in rapid succession. Lost updates are unacceptable.

---

## Acceptance Criteria — The Build Is Done When:

- [ ] `npx vibe-splain install` patches `~/.claude/claude_desktop_config.json` and exits 0.
- [ ] Running install twice does not create duplicate entries.
- [ ] `npx vibe-splain serve` starts and accepts MCP tool calls over stdio.
- [ ] All 7 MCP tools are registered with descriptive `description` fields.
- [ ] `scan_project` on a TypeScript project returns ≥1 pillar and ≥1 High-Gravity file.
- [ ] `scan_project` with zero files changed returns `newOrChangedFiles: 0`.
- [ ] `write_decision_card` with a >7-node Mermaid diagram returns an error without writing.
- [ ] Modifying a watched file marks the relevant card stale and rewrites `dossier.json` within 5 seconds.
- [ ] Opening `.vibe-splainer/ui/index.html` as a `file://` URL in Chrome shows the populated UI without errors.
- [ ] The UI's Refresh button successfully reloads with updated dossier data.
- [ ] Mermaid diagrams render as SVG (not raw text).
- [ ] Shiki syntax highlighting works in the Evidence Sidebar.
- [ ] `npm run build` produces no `d3` or `reactflow` chunks.
- [ ] `packages/cli/dist/ui/index.html` exists after build.
- [ ] `npm pack --dry-run` lists a tarball with `bin.vibe-splain` and no `broken_build/` entry.
- [ ] `scan_project` completes in <30 seconds on a 50-file TypeScript project.
- [ ] Zero outbound HTTPS calls during any `scan_project` run.
- [ ] UI renders without horizontal scrollbar at 1440×900.
