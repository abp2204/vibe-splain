# Vibe-Splain v2 — Agent Execution Plan

> **For the executing agent:** This is a complete, self-contained build plan. Read the whole file once before starting. Execute phases in order. Each phase has a **Ship Gate** — do not advance until it passes. Validate every phase by re-running against the CIPHER project (see *Validation Target*). Respect every item in *Hard Constraints*.

---

## 0. Context — why this work exists

Vibe-splain is an MCP-based static-analysis engine. An agent calls its tools to scan a codebase, find the important files, and write opinionated architectural "Decision Cards" into a `dossier.json`, which is baked into a static `file://` UI.

**The current output is weak.** A real run against the CIPHER project (a Python pygame/PySide6 music app) failed in three ways:

1. **It analyzed the wrong files.** The scanner is JS/TS-only, so it never saw the Python app. Every Decision Card pointed at throwaway design mockups in `docs/claude_design/*.jsx`. Junk pillars like `.venv/lib/python3.13/site-packages/...` leaked in.
2. **The taxonomy was incoherent.** The same file was documented 2–3 times under different invented pillars (`Frontend-UI`, `UI Framework`, `Musical Tools`). A UI config panel landed under `Database` via dumb substring matching. `Auth` pillar was empty.
3. **The narratives were book reports.** Every card just paraphrased the file's own header comments. Zero opinion, zero risk, zero tradeoff. `wildDiscoveries` came back empty — the headline feature produced nothing.

**Root causes:** monolingual scanner; a gravity heuristic that measures *size* not *importance*; a `get_file_context` that dumps the raw file so the LLM grabs the cheapest summary (the header comment); a `DecisionCard` schema with no slot for an opinion; and no global understanding pass.

**The fix:** measure **importance (fan-in/PageRank)** and **smell (Heat)** as two separate axes; pre-extract the gnarly code in the brain; force opinion into a typed schema; ground cards in a project map; and rebuild the UI to dramatize the Gravity×Heat fire.

---

## 1. Repo layout (current)

```
packages/
├── brain/   # @vibe-splain/brain — pure static analysis, no network
│   └── src/{scanner,dossier,graph,watcher,index}.ts
├── cli/     # vibe-splain — MCP server + CLI (the published npm artifact)
│   └── src/mcp/{server.ts, tools/*.ts}
│   └── src/commands/{install,serve}.ts
└── ui/      # @vibe-splain/ui — React dossier viewer (private, embedded into cli)
    └── src/{App,types}.tsx + components/*
```

**Build pipeline (must run in order):** `brain` tsc → `cli` tsc+esbuild (inlines `brain`) → `ui` vite → `scripts/bundle-ui.js` copies `ui/dist/` → `cli/dist/ui/`. Run `npm run build`. There are no automated tests; validate by running `node packages/cli/dist/index.js install` then `serve` against a real project.

---

## 2. Hard Constraints (violating any of these breaks the product)

- **`console.log` is forbidden** anywhere in `brain/` and `cli/`. `process.stdout` is owned by the MCP stdio transport; a stray log corrupts the JSON-RPC stream. Use `console.error` only.
- **No `process.exit()`** after `server.connect(transport)` in `serve.ts`. The process must stay alive.
- **No HTTP server / no bound port.** The UI must work from `file://` only.
- **`Parser.init()` runs once per process** in `scanner.ts`, before any parsing. (v2 keeps this; only the per-language `Language.load()` calls are added and cached.)
- **`write_decision_card` and `mark_stale` must always call `regenerateUI()`** after mutating `dossier.json` (handled inside `writeDossier`). Keep that invariant.
- **UI injection marker is `<!-- VIBE_DOSSIER_INJECTION_POINT -->`** — injection is by HTML-comment marker, NOT by searching for `</head>` (minified bundles collapse it). Keep the marker. *(Note: `CLAUDE.md` mis-states this as `<!-- VIBE_DOSSIER_DATA -->`; fix that doc line to match the code.)*
- **Template path resolves relative to the CLI entrypoint**, not `dossier.ts` (esbuild inlines brain, so `import.meta.url` points at the bundle).
- **UI must stay a single self-contained `index.html`.** `vite.config.ts` uses `vite-plugin-singlefile` + `base: './'`. Do not change `base`.
- **Mermaid:** `startOnLoad: false`, render imperatively via `mermaid.render()` in a `useEffect`. Never auto-scan the DOM.
- **Backward compat:** all new `DecisionCard`/`Dossier` fields are **optional in the UI render path** so old v1 `dossier.json` files don't crash. Old docs lacking `map` trigger a re-scan, not a crash.

---

## 3. Validation Target

Re-run the full pipeline against **`/Users/aayushpatel/Desktop/Code/CIPHER`** after each phase. The run is correct when ALL hold:

- [ ] Cards point at the **real Python application**, not `docs/claude_design/*.jsx` mockups.
- [ ] `wildDiscoveries` is **non-empty** (Heat-driven).
- [ ] **No `.venv` / `site-packages` pillars** exist.
- [ ] **No file is documented more than once.**
- [ ] **Every card has a `thesis` that takes a position** (not a paraphrase of header comments).

---

## 4. Phases

Build **Phase 1+2 as one PR** (the fire — the only way to prove the fix on CIPHER). Phases 3–5 as one "intelligence" PR. Phase 6 as its own PR. Phase 0 lands first as pure additive types.

---

### Phase 0 — Data model foundation (additive, no behavior change)

**Goal:** establish the v2 vocabulary. Pure addition; nothing consumes it yet.

**Files:** new `packages/brain/src/signals.ts`; edit `packages/brain/src/dossier.ts`; edit `packages/brain/src/index.ts` (re-export new types).

**`signals.ts`:**

```ts
export type Language = 'typescript' | 'tsx' | 'javascript' | 'python' | 'go' | 'rust' | 'java';

export interface GravitySignals {
  fanIn: number;        // # of real-source files that import this (resolved, deduped)
  fanOut: number;       // # of distinct modules this imports
  centrality: number;   // 0..1 PageRank over the resolved import graph
  cyclomatic: number;   // sum of decision nodes (if/for/while/case/catch/&&/||/?)
  publicSurface: number;// exported symbol count
  loc: number;
}

export interface HeatSignals {
  todos: number;          // TODO|FIXME|HACK|XXX|@deprecated
  suppressions: number;   // @ts-ignore | eslint-disable | ': any' | type:ignore | #nosec
  swallowedCatches: number; // catch blocks that are empty or only log
  maxNesting: number;
  longFunctions: number;  // function bodies over LOC threshold
  magicNumbers: number;
}

export type SmellKind =
  | 'todo' | 'suppression' | 'swallowed-catch'
  | 'deep-nesting' | 'long-function' | 'magic-number' | 'god-file';

export interface SmellHit {
  kind: SmellKind;
  line: number;        // 1-based
  endLine: number;
  text: string;        // the offending line, trimmed
  severity: 1 | 2 | 3 | 4 | 5;
  note: string;        // human-readable, e.g. "catch block swallows error silently"
}

export interface FileAnalysis {
  path: string;
  relativePath: string;
  language: Language;
  isRealSource: boolean;       // false ⇒ docs/mockups/vendored/generated
  demoteReason: string | null; // why it's not real source (transparency)
  gravity: number;             // 0..100 composite
  heat: number;                // 0..100 composite
  gravitySignals: GravitySignals;
  heatSignals: HeatSignals;
  smells: SmellHit[];
  pillarHint: string | null;   // from import-graph community detection
}
```

**`dossier.ts` — overhaul `DecisionCard`, add `ProjectMap`/`PillarDef`, extend `Dossier`:**

```ts
export type CardCategory =
  | 'Bottleneck' | 'Hack' | 'Smart-Move' | 'Risk' | 'Convention' | 'Dead-Weight';

export interface DecisionCard {
  id: string;
  pillar: string;
  title: string;
  thesis: string;                 // NEW — one-sentence verdict, the headline
  category: CardCategory;         // NEW
  severity: 1 | 2 | 3 | 4 | 5;    // NEW
  narrative: string;
  tradeoff: string | null;        // NEW — what was given up / why not the obvious way
  blastRadius: string | null;     // NEW — "what breaks if this changes"
  confidence: 'low' | 'medium' | 'high'; // NEW
  evidence: Evidence[];
  diagram: string | null;
  gravity?: number;               // NEW — carried from scan for UI plotting
  heat?: number;                  // NEW
  primaryFile?: string;           // NEW — the one file this card is about (dedupe key)
  status: 'fresh' | 'stale';
  lastScannedHash: string;
}

export interface PillarDef { name: string; description: string; memberFiles: string[]; }

export interface ProjectMap {
  stack: string[];          // ["Python 3.13", "PySide6", "pygame"]
  entrypoints: string[];
  pillars: PillarDef[];     // the ONLY legal pillar names
  fileCount: number;
  realSourceCount: number;
  topGravity: string[];     // "Start Here" — ranked relative paths
  topHeat: string[];        // Wild Discovery candidates
  brief: string | null;     // agent fills in Phase 4 global pass
}

export interface Dossier {
  version: '2.0.0';
  scannedAt: string;
  projectRoot: string;
  map: ProjectMap;          // NEW
  pillars: Pillar[];
  wildDiscoveries: DecisionCard[];
  stalePaths: string[];
}
```

Bump `version` to `2.0.0`. In `readDossier`, treat a doc missing `map` as v1 (return it but flag for re-scan).

**Ship Gate:** `npm run build -w packages/brain` compiles. No runtime behavior change.

---

### Phase 1 — Multi-language scanner + real-source detection + import-resolution fix

**Goal (highest leverage):** stop auditing mockups. See the real codebase regardless of language.

**File:** `packages/brain/src/scanner.ts` (major rewrite).

**1.1 Per-language grammar loading, cached.** Keep `Parser.init()` once. Add lazy cached `Language.load()`:

```ts
const langCache = new Map<Language, Parser.Language>();
const EXT_LANG: Record<string, Language> = {
  '.ts':'typescript', '.tsx':'tsx', '.js':'javascript', '.jsx':'tsx',
  '.py':'python', '.go':'go', '.rs':'rust', '.java':'java',
};
const LANG_WASM: Record<Language, string> = {
  typescript:'tree-sitter-typescript.wasm', tsx:'tree-sitter-tsx.wasm',
  javascript:'tree-sitter-javascript.wasm', python:'tree-sitter-python.wasm',
  go:'tree-sitter-go.wasm', rust:'tree-sitter-rust.wasm', java:'tree-sitter-java.wasm',
};
async function getLanguage(lang: Language): Promise<Parser.Language> {
  // resolve from tree-sitter-wasms/out/<wasm>, fall back to local ../wasm, cache by lang
}
```

`SUPPORTED_EXTENSIONS` becomes `new Set(Object.keys(EXT_LANG))`. Set the parser's language per file before `parse()`. Confirm `tree-sitter-wasms` ships the needed grammars; if a grammar is missing, skip that language gracefully (log via `console.error`, never throw).

**1.2 Real-source classifier.** Tag each file `isRealSource` + `demoteReason`. Demote (keep, but down-weight — do NOT silently drop):
- Path contains any segment matching: `docs`, `examples`, `samples`, `mockup`/`mockups`, `fixtures`, `__generated__`; or filename matches `*.min.*`, `*.generated.*`.
- Inside a detected vendor tree: `node_modules`, `vendor`, `site-packages`, or any venv dir. **Harden the `.venv` leak:** match on **every path segment of the resolved relative path**, not just the immediate `entry.name`.
- **Zero inbound edges from other real-source files AND not an entrypoint** ⇒ `demoteReason = "no inbound references from application code"`. (This is what catches `docs/claude_design/*.jsx`.)

**1.3 Entrypoint detection.** Parse `package.json` (`main`/`bin`), `pyproject.toml`/`setup.py`, and detect `main.py`/`__main__.py`/`index.*`/`cmd/*/main.go`. Entrypoints are always real-source and seed the centrality walk.

**1.4 Fix the import-resolution bug.** Current `scanner.ts` increments `reverseImportCount` for **all 7 candidate extensions** of every relative import → ~7× inflation. Replace with single resolution: try extensions in priority order, take the **first existing file**, count once. Build `importedBy: Map<string, Set<string>>`; `fanIn = importedBy.get(f).size`.

**Ship Gate:** re-scan CIPHER → real `.py` files appear in the analysis; `docs/claude_design/*.jsx` are marked `isRealSource:false`; no `.venv`/`site-packages` paths survive as real source.

---

### Phase 2 — Dual scoring: Gravity × Heat + smell detection

**Goal (highest leverage):** measure importance and smell separately. Make Wild Discoveries real.

**File:** `packages/brain/src/scanner.ts` (+ helpers). Delete the single `cognitiveWeight` from the public surface (keep internally only if a sub-signal needs it). **Delete the `dirname`-fallback pillar grouping** (`scanner.ts` ~lines 262–268 in v1) — it produced the `.venv/...` pillars. **Delete `detectPillars`/`PILLAR_KEYWORDS`** (substring matching that mislabeled a UI panel as `Database`).

**2.1 Gravity (importance), 0..100:**

```
centrality  = pagerank(resolvedGraph)          // iterative, ~20 passes, damping 0.85, real-source nodes only
gravity_raw = centrality * 50                   // dominant — load-bearing-ness
            + log2(fanIn + 1) * 8
            + log2(cyclomatic + 1) * 4
            + log2(publicSurface + 1) * 3
gravity     = clamp(0, 100, gravity_raw)
// demoted files: gravity *= 0.2
```

Implement PageRank inline (no new dep) over the resolved adjacency from 1.4. `cyclomatic` = count of decision nodes via tree-sitter (`if/for/while/case/catch/&&/||/?` per the active grammar's node types).

**2.2 Heat (smell/debt), 0..100** — driven by `SmellHit[]`:

```ts
const SMELL_PATTERNS: { kind: SmellKind; re: RegExp; severity: number; note: string }[] = [
  { kind:'todo', re:/\b(TODO|FIXME|HACK|XXX|KLUDGE)\b/, severity:2, note:'unfinished / known-bad marker' },
  { kind:'suppression', re:/@ts-ignore|@ts-nocheck|eslint-disable|:\s*any\b|type:\s*ignore|#\s*nosec/, severity:3, note:'type/lint safety suppressed' },
];
```

Tree-sitter-derived smells (not regex): empty or `console`/`print`-only `catch_clause` ⇒ `swallowed-catch` (sev 4); function body over LOC threshold ⇒ `long-function`; `maxNesting > 5` ⇒ `deep-nesting`; file LOC > ~400 with > 8 exports ⇒ `god-file` (sev 4).

```
heat = clamp(0, 100, Σ over smells (severity * weight[kind]))   // saturating sum
```

**2.3 Wild Discoveries are Heat-driven:** a file is a wild candidate when `heat >= 60` OR it has any severity-≥4 smell. (Direct fix for the empty `wildDiscoveries`.)

**2.4 Pillars from the graph, not substrings.** Run community detection (label-propagation — no new dep) over the resolved real-source graph. Each community → a `PillarDef { name, description, memberFiles }`. The set is **fixed** here; the agent later names/refines but cannot invent new pillars.

**2.5 `ScanResult` / `scan_project` return** now exposes: `FileAnalysis[]` (real-source, ranked by gravity), the `ProjectMap`, and Heat-ranked wild candidates. Remove `pillarGroups` built from `dirname`.

**Ship Gate:** re-scan CIPHER → `wildDiscoveries` non-empty; pillars are coherent graph clusters (no junk dirs); Start-Here list is dominated by real load-bearing files.

---

### Phase 3 — Brain pre-selects evidence

**Goal:** stop the LLM from paraphrasing header comments by handing it the interesting bodies.

**File:** `packages/cli/src/mcp/tools/get_file_context.ts` (+ brain helper for span extraction).

New return shape:

```ts
interface EvidenceCandidate {
  startLine: number; endLine: number;
  snippet: string;
  reason: string;   // "highest cyclomatic complexity in file (14 branches)" | "swallowed catch"
}

interface FileContextResult {
  filePath: string;
  language: Language;
  gravity: number; heat: number;
  gravitySignals: GravitySignals; heatSignals: HeatSignals;
  importedBy: string[];          // who depends on this (named fan-in)
  imports: string[];
  hotSpans: EvidenceCandidate[]; // top-3 highest-complexity function bodies
  smellSpans: EvidenceCandidate[]; // every SmellHit with ±3 lines of context
  signature: string;             // exported symbols only (the API surface)
  // raw `source` returned ONLY when called with { full: true }
}
```

Implementation: walk the tree, collect `function`/`method`/`arrow` nodes, score each by `decisionNodes + bodyLOC`, return the top 3 with line ranges. **Strip the leading comment/docblock** from each snippet so the model can't cheat. Attach `reason` strings.

**Ship Gate:** `get_file_context` on a CIPHER file returns `hotSpans` containing real logic (not the `//` header), each with a `reason`.

---

### Phase 4 — Schema enforcement + global-pass tools

**Goal:** force a project-level understanding before cards; make opinion required; constrain pillars; kill duplicates.

**Files:** `packages/cli/src/mcp/tools/write_decision_card.ts`, new `get_project_map.ts` + `set_project_brief.ts`, register both in `server.ts`.

**4.1 `get_project_map` tool.** Returns `dossier.map` (stack, entrypoints, the fixed pillar set, Start-Here, Wild-Discovery candidates). Description instructs the agent to write a brief and call `set_project_brief` BEFORE any card.

**4.2 `set_project_brief` tool.** Persists the agent's 3–5 sentence project brief into `dossier.map.brief`, then `writeDossier` (regenerates UI).

**4.3 `write_decision_card` inputSchema v2:**

```jsonc
{
  "type": "object",
  "properties": {
    "projectRoot": { "type": "string" },
    "pillar": { "type": "string",
      "description": "MUST be one of the pillar names from get_project_map. Free-form values are rejected." },
    "primaryFile": { "type": "string",
      "description": "The single file this card is about. Used to reject duplicate cards." },
    "title": { "type": "string" },
    "thesis": { "type": "string",
      "description": "ONE sharp sentence. A verdict, not a description. Take a position. Bad: 'This file implements a panel system.' Good: 'A 600-line god-component that owns drag, zoom, persistence AND the host bridge — the single highest-risk refactor in the app.'" },
    "category": { "type": "string", "enum": ["Bottleneck","Hack","Smart-Move","Risk","Convention","Dead-Weight"] },
    "severity": { "type": "integer", "minimum": 1, "maximum": 5 },
    "narrative": { "type": "string",
      "description": "3-5 sentences. WHY it exists and WHY it's built this way. Do NOT restate the file's header comments." },
    "tradeoff": { "type": "string",
      "description": "What was given up, or why the obvious approach was rejected. Null only if genuinely none." },
    "blastRadius": { "type": "string",
      "description": "What breaks if this changes. Ground it in the fan-in (importedBy) from get_file_context." },
    "confidence": { "type": "string", "enum": ["low","medium","high"] },
    "evidence": { "type": "array",
      "items": { "type":"object","properties":{
        "file":{"type":"string"},"startLine":{"type":"number"},
        "endLine":{"type":"number"},"snippet":{"type":"string"}},
        "required":["file","startLine","endLine","snippet"] },
      "description": "Use hotSpans/smellSpans from get_file_context. NEVER cite header comments or the whole file." },
    "diagram": { "type": "string", "description": "Optional. stateDiagram-v2 / flowchart TD / linear. Max 7 nodes." }
  },
  "required": ["projectRoot","pillar","primaryFile","title","thesis","category","severity","narrative","confidence","evidence"]
}
```

**4.4 Handler-side validation** (JSON-schema enums can't be fully dynamic, so enforce in code):
- Reject `pillar` not in `dossier.map.pillars`; return the legal list in the error message.
- Reject a second card with the same `primaryFile` (dedupe). Suggest `mark_stale` + rewrite instead.
- Auto-carry `gravity`/`heat` onto the card from the scan.
- Keep computing `lastScannedHash` and calling `writeDossier` (→ `regenerateUI`).

**Ship Gate:** attempting an invented pillar is rejected; a duplicate `primaryFile` card is rejected; cards persist with all new fields.

---

### Phase 5 — Prompt rewrite

**Goal:** turn the agent from a doc-writer into a skeptical auditor.

**File:** `packages/cli/src/mcp/server.ts` — replace the `build_dossier` prompt text with:

```
You are a skeptical staff engineer doing a HOSTILE architecture review of this codebase.
You are NOT writing documentation. You are finding the load-bearing walls, the landmines,
and the clever moves, and you are taking positions on them.

PROCESS — follow in order:
1. Call scan_project, then get_project_map. The map gives you: the detected stack,
   the FIXED set of pillars (you may not invent others), the Start-Here files (highest
   gravity = most depended-upon), and Wild-Discovery candidates (highest heat = most smell).
2. Read the map's stack and entrypoints. Write a 3-5 sentence project brief: what IS this,
   what's the real stack, and — critically — which files are the actual application vs.
   mockups/generated/vendored noise. Pass it via set_project_brief. Do this BEFORE any card.
3. Work the Start-Here files first (highest gravity), then the Wild-Discovery files.
   For each, call get_file_context. It returns hotSpans (the gnarliest functions) and
   smellSpans (located tech debt) — base your evidence on THOSE, never on header comments.
4. Write one decision card per file via write_decision_card.

RULES FOR EVERY CARD — non-negotiable:
- The `thesis` is a VERDICT in one sentence. Take a position. If you can't, you don't
  understand the file yet — read more.
- Pick a `category`: Bottleneck, Hack, Smart-Move, Risk, Convention, or Dead-Weight.
- `blastRadius` must reference the real fan-in (get_file_context.importedBy).
- NEVER paraphrase the file's own comments. If the insight is already in a // block,
  it is not insight — go deeper into the logic.
- Evidence = 5-20 lines of the ACTUAL interesting code (hotSpans/smellSpans). Never the
  whole file, never the doc-header.
- For every Wild-Discovery candidate, name the specific smell and rate its severity.

────────────────────────────────────────────────────────
EXAMPLE — what GOOD vs BAD looks like:

BAD (rejected — this is a book report):
  title: "Panel Component Framework"
  narrative: "This module establishes the structural framework for the panel-based
  interface. It defines the generic Panel shell that standardizes look and feel..."
  → Restates the header comment. No position. No risk. No tradeoff. Worthless.

GOOD (accepted):
  title: "Panel shell carries 14 props and 6 tools in one file"
  thesis: "cipher-panels-a.jsx is a god-file: one 600-line module owns the shared shell
           AND three unrelated generators, so any panel change risks all of them."
  category: "Risk"  severity: 4
  narrative: "Panel was built as a single shell to guarantee visual consistency, but the
              three generators (Palette/Vibe/Pocket) were folded in beside it instead of
              split out. The shell threads 14 props through every tool, so the generators
              are now coupled to the shell's drag/compact state they don't use."
  tradeoff: "Bought consistency and one import site; paid with a module no one can change
             safely and props that leak shell concerns into pure generators."
  blastRadius: "Imported by cipher-shell.jsx (the app root) — a regression here is a
                full-app regression."
  evidence: [ the 14-param Panel signature; the prop-drill into PalettePanel ]
────────────────────────────────────────────────────────

When done, share the exact file:// UI link returned by scan_project. Never invent a URL.
```

**Ship Gate:** a full CIPHER run produces cards with populated `thesis`/`category`/`tradeoff`/`blastRadius`, zero header-comment paraphrase, all pillars from the fixed set.

---

### Phase 6 — UI overhaul

**Goal:** dramatize the Gravity×Heat fire instead of listing neutral doc-cards.

**Files:** `packages/ui/src/types.ts` (mirror v2 types, all new fields optional), `App.tsx`, `components/DecisionCard.tsx`, new `components/GravityHeatMap.tsx`, `components/StartHere.tsx`. Keep `MermaidDiagram` usage rules.

1. **Landing = Gravity × Heat map** (`GravityHeatMap.tsx`): SVG scatter, x=gravity, y=heat, dot size=severity, color=category. Top-right quadrant labeled "🔥 Important AND Smelly — start here." Click a dot → scroll to its card.
2. **"Start Here" rail** from `map.topGravity` — the N files a new engineer reads first.
3. **Category color-coding on cards** (`DecisionCard.tsx`): `thesis` is the bold headline; narrative demoted to secondary. Colored category chip + severity pips. `Hack`/`Risk` red, `Bottleneck` amber, `Smart-Move` green, `Dead-Weight` gray. Show `blastRadius` and `tradeoff` as labeled rows.
4. **Wild Discoveries = hero section** (red treatment, severity-sorted), not a usually-empty tab.
5. **Import graph** via existing `MermaidDiagram` — render the top-gravity neighborhood.

PillarTabs stay as a secondary filter; map + Start-Here + Wild Discoveries lead.

**Ship Gate:** `npm run build` succeeds end-to-end; the regenerated CIPHER `index.html` renders the map, color-coded cards, and a non-empty Wild Discoveries hero from `file://`.

---

## 5. PR sequencing

| PR | Phases | Why grouped |
|----|--------|-------------|
| 1  | 0 + 1 + 2 | The fire. Only way to prove the fix on CIPHER (real files, real Heat). |
| 2  | 3 + 4 + 5 | The intelligence layer: better evidence, enforced schema, auditor prompt. |
| 3  | 6 | UI dramatization, depends on v2 data being present. |

After each PR: `npm run build`, then `node packages/cli/dist/index.js install` + `serve` against CIPHER, then check all five boxes in *Validation Target* (§3).

## 6. Definition of Done

- All five *Validation Target* checks pass on CIPHER.
- `npm run build` is green across `brain` → `cli` → `ui` → bundle.
- No `console.log` anywhere in `brain/`/`cli/`; no bound port; UI works from `file://`.
- Old v1 `dossier.json` files load without crashing (fields optional) and prompt a re-scan.
- `CLAUDE.md` marker line corrected to `<!-- VIBE_DOSSIER_INJECTION_POINT -->`.
