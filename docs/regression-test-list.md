# Regression Test List

Tests that must pass before every release. All are in `packages/cli/tests/`.

Run all (recommended):
```bash
npm run test:regression
```

No external clones or environment variables are required — every test builds its own
in-memory fixture in a temp directory.

Individual tests:
```bash
npx tsx packages/cli/tests/test_wal_safety.ts
npx tsx packages/cli/tests/test_budget_guard.ts
npx tsx packages/cli/tests/test_validation_report.ts
npx tsx packages/cli/tests/test_logic_fixes.ts
npx tsx packages/cli/tests/test_no_adapter_safety.ts
npx tsx packages/cli/tests/test_pretooluse_hook.ts
```

---

## Test Inventory

### `test_no_adapter_safety.ts` — Universal Fallback

| Check | What it proves |
|---|---|
| `behavioralLift === 0` for all files | No adapter mechanics leak into a plain repo |
| `gravity === staticGravity` for all files | Untargeted repositories run safely on pure static gravity |
| No `adapterDomain` / `domainTags` / `adapterSideEffects` present | The empty adapter registry contributes nothing |

### `test_pretooluse_hook.ts` — Deterministic Gate

| Check | What it proves |
|---|---|
| Install registers the PreToolUse hook idempotently | Agent config patching is safe to re-run |
| High-blast edit → ask + names dependents | Gate escalates load-bearing files |
| Medium-blast edit → allow + inject context | Advisory surfaces dependents without blocking |
| Low-blast / new file / non-edit tool → defer | Gate stays out of the way for safe edits |
| Security-sensitive path → security warning | Auth/credential/webhook paths are flagged |
| Generated/vendored file → demoted to low | No friction on build targets |
| Warn-once when `gate.json` missing | One notice per session, then graceful no-op |

### `test_wal_safety.ts` — SQLite WAL Concurrency

| Check | What it proves |
|---|---|
| 5 workers × 100 pointers, all exit 0 | WAL mode survives concurrent multi-process writes |
| Zero `SQLITE_BUSY` in any worker stderr | `busy_timeout` set before `journal_mode = WAL` |
| Final count = 500 in primary process | No lost writes, no duplicate rows |

**Regression trigger:** Changing pragma ordering in `PointerStore` constructor, adding a new `better-sqlite3` call path outside the write mutex.

### `test_budget_guard.ts` — Output Budget Enforcement

| Check | What it proves |
|---|---|
| 5MB payload returns `BudgetExceededResult` (not raw JSON) | `applyBudgetGuard` triggers at the char limit |
| Returned `pointerId` resolves via `hydratePointer` | Blob written correctly during budget overflow |
| Small payload returned inline | Guard does not interfere with normal-size outputs |

**Regression trigger:** Changing `BUDGET_CHARS`, removing `applyBudgetGuard` from any data-returning tool, changing the BlobStore write path.

### `test_validation_report.ts` — Validation Report Integrity

| Check | What it proves |
|---|---|
| Report written after scan | `buildValidationReport` runs and persists |
| Findings reference real files | No phantom file paths in report |
| Severity values in range | Canonical severity contract enforced |

**Regression trigger:** Changes to `buildValidationReport` in `scoring.ts`, removing the validation report from `writeBundle` output.

### `test_logic_fixes.ts` — Core Scoring Logic

| Check | What it proves |
|---|---|
| Gravity formula produces values 0–100 | `gravityRaw` clamping is correct |
| PageRank centrality + depth factor interact correctly | `adjustedCentrality` formula not regressed |
| Top-12 gravity slice is stable | `topGravity` selection is deterministic |

**Regression trigger:** Any change to the gravity formula constants in `scanner.ts`, changes to the `adjustedCentrality` calculation.

---

## What Is Not Covered by Automated Tests

These require manual verification or integration tests against a real project:

- `scan_project` end-to-end on a real TypeScript codebase (Tree-Sitter WASM init, `graph.json`, `dossier.json` generation).
- `vibe-splain serve` MCP server startup and tool registration (JSON-RPC transport).
- UI `file://` rendering of injected `window.__VIBE_DOSSIER__` (Vite single-file build).
- `vibe-splain install` agent config patcher for Claude / Cursor / VS Code.
- `console.log` absence check — any stray `console.log` in `brain/` or `cli/` corrupts the MCP stdio stream. Verify with: `grep -rn 'console\.log' packages/brain/src packages/cli/src`.
