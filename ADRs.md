# VIBE-SPLAIN: Architecture Decision Records
**Status:** Approved | **Author:** Principal Software Engineer | **Date:** 2026-06-10

These ADRs lock down the critical technical decisions before coding begins. A coding agent MUST read all seven before writing any code. Rejected alternatives are documented to prevent refactoring into them later.

---

## ADR-001: MCP SDK and Transport Layer

**Title:** MCP Server Implementation — `@modelcontextprotocol/sdk` over stdio

**Context:**
The PRD mandates that VIBE-SPLAIN operates as an MCP server launched by the ambient coding agent as a subprocess. The server must expose 7 tools and communicate with the agent. The MCP protocol has multiple transport options (stdio, HTTP/SSE, WebSocket), and multiple implementation approaches exist.

**Decision:**
Use the official `@modelcontextprotocol/sdk` npm package with the **stdio transport** (`StdioServerTransport`). The server process reads JSON-RPC messages from `process.stdin` and writes responses to `process.stdout`. All log output goes to `process.stderr` (never stdout, which is reserved for MCP protocol messages).

Implementation skeleton:
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({ name: 'vibe-splain', version: '1.0.0' });
// register tools here
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Rejected Alternatives:**
- **HTTP/SSE Transport (`@modelcontextprotocol/sdk` SSE mode):** Requires binding a port, which the PRD explicitly forbids ("No HTTP server or bound port of any kind"). Also requires the coding agent to be configured with a URL rather than a command, which is less portable.
- **Raw JSON-RPC over stdio (no SDK):** Implementing MCP's JSON-RPC protocol from scratch is error-prone and ignores the official SDK that Claude Code and Gemini CLI are already tested against. Any deviation from the protocol spec causes silent tool registration failures.
- **`fastmcp` (Python-based MCP framework):** VIBE-SPLAIN is a Node.js monorepo. A Python dependency would break the `npx` install story and require users to have Python installed. Ruled out on dependency grounds.

**Consequences:**
- `process.stdout` is owned by the MCP SDK. Any `console.log()` in the codebase will corrupt the stdio stream and break the agent connection. The codebase MUST use `console.error()` for all logging, or a logger that writes to `stderr` only.
- The `vibe-splain serve` command must NOT call `process.exit()` after connecting — the process must remain alive until the agent disconnects.
- The file watcher (chokidar) runs in the same event loop as the stdio server (see ADR-006).

---

## ADR-002: Tree-Sitter Bindings — WASM over Native

**Title:** Tree-Sitter Integration — `web-tree-sitter` (WASM) with precompiled grammars

**Context:**
The Structural Scout must parse `.ts`, `.tsx`, `.js`, `.jsx` files to compute AST nesting depth, extract import/export edges, and count state mutations. Tree-Sitter is the PRD-specified parser. Tree-Sitter has two Node.js integration paths: native C++ bindings and WASM bindings.

**Decision:**
Use **`web-tree-sitter`** (the WASM build) with precompiled grammar `.wasm` files sourced from **`tree-sitter-wasms`** (community package that ships pre-built WASM binaries for TypeScript and JavaScript). The WASM files are bundled inside `packages/brain/wasm/` and loaded at runtime via `Parser.init()`.

```typescript
import Parser from 'web-tree-sitter';
await Parser.init();
const parser = new Parser();
const Lang = await Parser.Language.load(path.join(__dirname, 'wasm/tree-sitter-typescript.wasm'));
parser.setLanguage(Lang);
const tree = parser.parse(sourceCode);
```

**Rejected Alternatives:**
- **`node-tree-sitter` (native bindings via `node-gyp`):** Requires compilation at `npm install` time. This breaks the `npx vibe-splain` zero-install story — users without Python, make, or Xcode Command Line Tools (common on Windows and some macOS setups) get a cryptic install failure. Native bindings also break when the user's Node.js version differs from the version used to compile. Not acceptable for a public npm package.
- **`@ast-grep/napi` (Rust-based, native):** Same native compilation problem as `node-tree-sitter`, plus it's a different query language (`sg` patterns) that the team would need to learn. No benefit over Tree-Sitter for our specific metrics (nesting depth, import edges, mutation counting).
- **Regex-based AST approximation (no parser):** Regex cannot reliably compute maximum nesting depth or distinguish between `const` and non-`const` assignments across complex TypeScript syntax. The Cognitive Weight score would be non-deterministic and inaccurate on real codebases. Ruled out on correctness grounds.

**Consequences:**
- WASM initialization is async. `Parser.init()` must be called once at process startup (not per-file). The scan pipeline must `await` this before processing any files.
- WASM files (~2–3 MB each) are bundled in the npm package inside `packages/brain/wasm/`. The `.npmignore` must NOT exclude this directory.
- WASM parsing is ~3–5x slower than native bindings per file, but for ≤200 files this is well within the 30-second PRD requirement. Do not optimize prematurely.
- Only TypeScript and JavaScript grammars are bundled in MVP (two `.wasm` files). Adding Python/Go later means adding their grammar `.wasm` files — no architectural change required.

---

## ADR-003: UI Data Loading — Pre-Baked Inline JSON (file:// CORS Workaround)

**Title:** Dossier Data Access in the Static UI — Inline `window.__VIBE_DOSSIER__` injection

**Context:**
The PRD mandates the UI is delivered as a `file://` static bundle with no HTTP server. The UI must read `dossier.json`. The PRD states "the UI reads dossier.json via a relative path from its own location." **This is architecturally incorrect as written.** Chrome and Edge block all `fetch()` and `XMLHttpRequest` calls to sibling `file://` paths by default (CORS policy for `null` origin). Firefox allows it but Chrome does not. A `fetch('../dossier.json')` call will fail silently or throw a CORS error in the majority of users' browsers.

**Decision:**
**Pre-bake the dossier data into `index.html` at write time.** The MCP server, every time it writes or updates `dossier.json`, also regenerates `.vibe-splainer/ui/index.html` from a template by injecting the full dossier as an inline script tag:

```html
<script>
  window.__VIBE_DOSSIER__ = /* JSON.stringify output injected here at write time */;
</script>
```

The React app reads exclusively from `window.__VIBE_DOSSIER__` at startup — it makes zero `fetch()` or `XMLHttpRequest` calls. The manual "Refresh" button calls `window.location.reload()`, which re-reads `index.html` from disk (which by that point has the latest dossier baked in).

**The MCP server is responsible for keeping `index.html` in sync.** Any call to `write_decision_card` or `mark_stale` that mutates `dossier.json` MUST immediately regenerate `index.html`. This is a write-through pattern: dossier.json → index.html regeneration → both files on disk are always consistent.

**Rejected Alternatives:**
- **`fetch('../dossier.json')` relative path:** Fails in Chrome/Edge for `file://` origins due to CORS (`null` origin policy). Would work in Firefox but not Chrome. Not acceptable — we cannot require users to use a specific browser or launch Chrome with `--allow-file-access-from-files`.
- **Launch a minimal localhost HTTP server:** The PRD explicitly forbids this. Re-introducing a port binding contradicts the core architectural decision to have zero network dependencies in the UI delivery path.
- **`<input type="file">` manual file picker:** Requires the user to manually navigate to and select `dossier.json` every time they open the UI. Completely unacceptable UX.

**Consequences:**
- The `write_decision_card` and `mark_stale` MCP tools must call a shared `regenerateUI(projectRoot)` function after every write. This function reads `dossier.json` from disk, JSON-stringifies it, and writes it into the HTML template.
- The HTML template lives in `packages/cli/dist/ui/index.html` (built from `packages/ui`). The `regenerateUI` function copies this template to `.vibe-splainer/ui/index.html` and injects the data. It must NOT mutate the template file — only the generated output.
- If `dossier.json` is very large (>5 MB), the inline JSON will make `index.html` large. This is acceptable for MVP; large projects can be handled by pagination in a future version.
- The `window.__VIBE_DOSSIER__` global must be typed in TypeScript: `declare global { interface Window { __VIBE_DOSSIER__: Dossier } }`.

---

## ADR-004: Persistence Layer — `dossier.json` as the Database

**Title:** State Storage — Single JSON file on disk, no in-memory state that diverges from disk

**Context:**
The MCP server is a long-running process that accumulates state (Decision Cards written by the ambient agent, stale flags set by the file watcher). This state must survive process restarts, be accessible to the file watcher, and be readable by the UI. A decision is needed on where authoritative state lives.

**Decision:**
**`dossier.json` is the single source of truth for all runtime state.** The MCP server process holds NO in-memory cache of `dossier.json` content that it treats as authoritative. Every read operation (e.g., `get_strategic_overview`) reads `dossier.json` from disk. Every write operation (e.g., `write_decision_card`, `mark_stale`) reads the current file, mutates the relevant fields, and writes the entire file back atomically (write to a `.tmp` file, then `fs.rename()` to the target).

```typescript
// Pattern for all writes:
async function writeCard(projectRoot: string, card: DecisionCard) {
  const dossierPath = path.join(projectRoot, '.vibe-splainer', 'dossier.json');
  const tmpPath = dossierPath + '.tmp';
  const dossier = JSON.parse(await fs.readFile(dossierPath, 'utf8'));
  // mutate dossier...
  await fs.writeFile(tmpPath, JSON.stringify(dossier, null, 2));
  await fs.rename(tmpPath, dossierPath); // atomic on POSIX
}
```

**Rejected Alternatives:**
- **SQLite (`better-sqlite3`):** Requires native compilation (same problem as ADR-002's native Tree-Sitter rejection). Also overkill — our data model is a simple nested JSON structure with no relational queries. Adds a binary dependency to a tool that should `npx` with zero friction.
- **In-memory JavaScript object (with flush to disk):** Creates a split-brain problem: if the process crashes between an in-memory mutation and a disk flush, the two are out of sync. Also means `dossier.json` on disk is stale during the process lifetime, which breaks the file watcher (which reads directly from disk) and the UI (which reads from disk on every "Refresh"). Ruled out on correctness grounds.
- **LevelDB / LMDB:** Native compiled dependencies. Same rejection reason as SQLite, amplified — these are lower-level databases with no benefit over a JSON file for our data size and access patterns.

**Consequences:**
- All MCP tool handlers that read or write state are inherently `async` (disk I/O).
- Concurrent writes (e.g., the ambient agent calling `write_decision_card` twice in rapid succession) must be serialized. Use a simple async mutex (e.g., `async-mutex` package) around the read-mutate-write cycle to prevent lost updates.
- `dossier.json` is human-readable and git-committable by design. Projects CAN commit their `.vibe-splainer/` directory to version control. The `.gitignore` guidance in the README should note this as optional, not mandatory.
- The `graph.json` intermediate artifact follows the same pattern — read from disk on demand, never cached in memory.

---

## ADR-005: Monorepo Build Pipeline

**Title:** Build System — npm Workspaces with a Sequential Root Build Script

**Context:**
The monorepo has three packages: `brain` (TypeScript, Node.js), `cli` (TypeScript, Node.js), and `ui` (React + Vite). The final published npm package must contain the compiled `cli`, compiled `brain` (as a dependency of `cli`), and the Vite-built `ui` bundle embedded inside `cli/dist/ui/`. A build system decision is needed.

**Decision:**
Use **npm Workspaces** (native to npm 7+) with a single root-level `build` script that runs build steps sequentially in dependency order. No build orchestration tool (Turborepo, NX, etc.) is used. The root `package.json` build script:

```json
{
  "scripts": {
    "build": "npm run build -w packages/brain && npm run build -w packages/cli && npm run build -w packages/ui && node scripts/bundle-ui.js"
  }
}
```

`scripts/bundle-ui.js` (a plain Node.js script, no dependencies) copies `packages/ui/dist/` → `packages/cli/dist/ui/`.

Each package's own `build` script:
- `packages/brain`: `tsc` (outputs to `packages/brain/dist/`)
- `packages/cli`: `tsc` (outputs to `packages/cli/dist/`)
- `packages/ui`: `vite build` (outputs to `packages/ui/dist/`)

**Rejected Alternatives:**
- **Turborepo:** Adds a `turbo.json` config file, a `turbo` dev dependency, and its own caching semantics. For three packages with a simple linear dependency (brain → cli, ui → cli), Turborepo's parallel scheduling provides no benefit and its caching can cause stale build artifacts that are hard to debug. Ruled out as unnecessary complexity.
- **NX:** Same objections as Turborepo, amplified. NX generates significant boilerplate config and has a steep learning curve. Categorically out of scope.
- **Single-package (no monorepo):** Putting `brain`, `cli`, and `ui` source in one package without workspace separation makes it impossible to enforce the architectural boundary between layers (the `ui` should never import from `brain` directly; it only reads `dossier.json`). Monorepo structure enforces this at the module system level.

**Consequences:**
- `packages/brain` must be listed as a workspace dependency in `packages/cli/package.json` using the workspace protocol: `"@vibe-splain/brain": "*"`. This ensures `cli` imports from the local build, not a published version.
- The `scripts/bundle-ui.js` script runs AFTER both TypeScript compilations and Vite build. It is the final step. If any prior step fails, it must not run (achieved by `&&` chaining in the build script).
- The `.npmignore` in `packages/cli` must exclude `src/`, `tsconfig.json`, and `node_modules/` but MUST include `dist/` (compiled output) and `dist/ui/` (embedded UI bundle).
- `npm publish` must be run from `packages/cli/`, not the monorepo root. Add a root-level `release` script as a reminder: `"release": "npm run build && cd packages/cli && npm publish"`.

---

## ADR-006: Single-Process Architecture for MCP Server + File Watcher

**Title:** Runtime Process Model — Single Node.js Process, No Forking or Worker Threads

**Context:**
`vibe-splain serve` must simultaneously: (1) listen for MCP tool calls over stdio, and (2) watch referenced files via chokidar for stale detection. These are two concurrent concerns in the same process. A decision is needed on whether to use a single process, worker threads, or a separate watcher daemon.

**Decision:**
Run both concerns in a **single Node.js process using the default event loop**. `chokidar` is an event-emitter-based file watcher — it is non-blocking and cooperates naturally with the async event loop that the `@modelcontextprotocol/sdk` stdio server also uses. No worker threads, no child processes, no IPC.

```typescript
// Both run in the same process, same event loop:
await server.connect(transport);          // MCP server on stdio
const watcher = chokidar.watch(paths);   // file watcher
watcher.on('change', async (filepath) => {
  await markStale(filepath);             // mutates dossier.json
});
```

The file watcher is initialized AFTER `scan_project` is first called (it needs `dossier.json` to know what to watch). It is updated (new paths added) whenever `write_decision_card` references a new file.

**Rejected Alternatives:**
- **Worker Threads for file watching:** The file watcher is I/O-bound (just receiving OS filesystem events), not CPU-bound. Worker threads are for CPU-bound work (e.g., if Tree-Sitter parsing blocked the event loop). Adding a worker thread for chokidar introduces `postMessage` serialization overhead and significantly more complex state management. Ruled out as premature optimization.
- **Separate daemon process (`vibe-splain watch`):** A separate watcher process would need to communicate state changes (stale flags) to the MCP server process via IPC (Unix sockets, named pipes, or files). This triples the complexity for no user benefit. Users would also need to manage two processes.
- **Polling the filesystem on every MCP tool call (no watcher):** Checking file hashes on every `get_strategic_overview` call would work but is slow (O(n) SHA-256 reads per call) and misses the real-time stale-detection requirement. chokidar uses OS-native filesystem events (FSEvents on macOS, inotify on Linux) and is essentially free when idle.

**Consequences:**
- `console.log()` is FORBIDDEN in the entire codebase (see ADR-001). Even an accidental `console.log` in the chokidar event handler will corrupt the MCP stdio stream. Enforce this with an ESLint rule (`no-console`) configured to error on `console.log` and `console.info`, allowing only `console.error`.
- Tree-Sitter parsing (CPU-bound, runs during `scan_project`) WILL block the event loop while it runs. This is acceptable because `scan_project` is a discrete, user-initiated operation that completes in <30 seconds. The MCP server will be unresponsive to other tool calls during a scan. This is the correct behavior (the agent should wait for `scan_project` to complete before calling other tools).
- chokidar must be initialized with `{ ignoreInitial: true, ignored: ['**/node_modules/**', '**/dist/**', '**/build/**'] }` to avoid firing events on startup and to exclude build artifacts.

---

## ADR-007: UI State Management — React `useState` Only, No External Library

**Title:** Frontend State Management — React Built-ins, No Redux / Zustand / Jotai

**Context:**
The Dossier UI is a React + Vite application. It has one data source (`window.__VIBE_DOSSIER__`, set once at page load), one piece of interactive state (which Decision Card's evidence is showing in the sidebar), and one user action (Refresh, which reloads the page). A state management decision is needed.

**Decision:**
Use **React's built-in `useState` and `useEffect` hooks only**. No external state management library. The component tree is shallow enough that prop drilling is not a problem. Global state (the loaded dossier object) is held in a single `useState` call at the `App` component level and passed down as props.

```typescript
// App.tsx — entire state surface:
const [dossier, setDossier] = useState<Dossier>(() => window.__VIBE_DOSSIER__);
const [activeEvidence, setActiveEvidence] = useState<Evidence[] | null>(null);
const [activePillar, setActivePillar] = useState<string>(dossier.pillars[0]?.name ?? '');
```

That's the complete state of the application. Three `useState` calls.

**Rejected Alternatives:**
- **Zustand or Jotai:** Appropriate for applications with many disconnected components that need to share state. This UI has two panels and a tab row — a flat, simple layout. Adding a state management library adds a dependency, a new mental model, and boilerplate for zero complexity benefit.
- **Redux Toolkit:** Categorically out of scope. Redux is for complex applications with many action types, reducers, and async middleware. This UI is essentially a JSON viewer with a sidebar. Using Redux here would be architectural malpractice.
- **React Context + useReducer:** Reasonable for slightly more complex apps, but still overkill. Context adds indirection that makes the data flow harder to trace. With only three state values, prop drilling from `App` down to `DecisionCard` is 2–3 levels at most — entirely readable.

**Consequences:**
- The `Refresh` button's implementation is simply `window.location.reload()`. There is no async data fetching, no loading states, no error boundaries needed — the data is synchronously available in `window.__VIBE_DOSSIER__` before React renders.
- **Shiki** (code highlighter) must be initialized asynchronously. Use a `useEffect` in the `EvidenceSidebar` component to initialize the Shiki highlighter once on mount and store the highlighter instance in a `useRef` (not `useState`, to avoid re-renders). Highlighted HTML is stored in local `useState` within the sidebar.
- **Mermaid.js** must be initialized with `mermaid.initialize({ startOnLoad: false })` and rendered imperatively via `mermaid.render()` inside a `useEffect`. Mermaid must NOT be allowed to auto-scan the DOM (`startOnLoad: true` is forbidden — it causes double-rendering and conflicts with React's virtual DOM).
- The UI bundle must include Shiki and Mermaid.js. Vite will tree-shake both correctly. The final bundle size target is <2 MB gzipped. If exceeded, lazy-load Shiki via `import()` inside the `useEffect`.
