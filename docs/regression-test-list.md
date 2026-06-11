# Regression Test List

Tests that must pass before every release. All are in `packages/cli/tests/`.

Run all (recommended):
```bash
npm run test:regression
```

Individual tests:
```bash
tsx packages/cli/tests/test_wal_safety.ts
tsx packages/cli/tests/test_stale_patch.ts
tsx packages/cli/tests/test_budget_guard.ts
tsx packages/cli/tests/test_scope_enforcement.ts
tsx packages/cli/tests/test_portability.ts
tsx packages/cli/tests/test_adversarial.ts
```

---

## Test Inventory

### `test_wal_safety.ts` — SQLite WAL Concurrency

| Check | What it proves |
|---|---|
| 5 workers × 100 pointers, all exit 0 | WAL mode survives concurrent multi-process writes |
| Zero `SQLITE_BUSY` in any worker stderr | `busy_timeout` set before `journal_mode = WAL` |
| Final count = 500 in primary process | No lost writes, no duplicate rows |

**Regression trigger:** Changing pragma ordering in `PointerStore` constructor, adding a new `better-sqlite3` call path outside the write mutex.

---

### `test_stale_patch.ts` — Preimage Hash Guard

| Check | What it proves |
|---|---|
| `StalePatchError` thrown when file modified after hash captured | Preimage check runs before any write |
| File content unchanged after `StalePatchError` | Atomic write only happens after guard passes |
| New-file path (`sha256:new`) works correctly | `apply_patch` handles non-existent target files |

**Regression trigger:** Changing the hash-check → write ordering in `handleApplyPatch`, any refactor that moves the `hashFile()` call after `writeFile()`.

---

### `test_budget_guard.ts` — Output Budget Enforcement

| Check | What it proves |
|---|---|
| 5MB payload returns `BudgetExceededResult` (not raw JSON) | `applyBudgetGuard` triggers at 8000 chars |
| Returned `pointerId` resolves via `hydratePointer` | Blob written correctly during budget overflow |
| Small payload (<8000 chars) returned inline | Guard does not interfere with normal-size outputs |

**Regression trigger:** Changing `BUDGET_CHARS`, removing `applyBudgetGuard` call from any data-returning tool, changing BlobStore write path.

---

### `test_scope_enforcement.ts` — SessionScope File-Tool Enforcement

| Check | What it proves |
|---|---|
| `read_file` throws `ScopeViolation` for out-of-scope path | Scope is checked before filesystem read |
| `get_file_skeleton` throws `ScopeViolation` for out-of-scope path | Same for skeleton tool |
| `yield_for_scope_expansion` returns `status: blocked` with valid receipt | One-way door works; scope cleared afterward |
| In-scope path is readable after `set_session_scope` | Allowed paths pass through correctly |

**Regression trigger:** Removing or reordering `SessionScope.enforce()` in any file tool, changing `SessionScope.clear()` call in `yield_for_scope_expansion`.

---

### `test_portability.ts` — Bundle / Import Round-Trip

| Check | What it proves |
|---|---|
| `bundle` produces a valid `.tar.gz` | Staging and tar creation work |
| `import` extracts and verifies all blob hashes | Hash verification before insertion |
| Imported manifest pointer resolves with correct hash | Namespace aliasing is correct |
| Corrupted blob detected during import | `verifyIntegrity` runs before `writeAtomic` |

**Regression trigger:** Changing bundle staging path, modifying tar `cwd` or file list, changing namespace prefix format in `importBundleCommand`.

---

### `test_adversarial.ts` — Full Adversarial Pass (10 checks)

| Check | What it proves | ADR |
|---|---|---|
| 1 — Scope bypass via file tools | `read_file`, `get_file_skeleton`, `apply_patch` all block out-of-scope + denied-glob paths | ADR-033 |
| 2 — Artifact query bypass | `get_evidence_slice` blocks `file_read`/`file_skeleton` blobs for out-of-scope files; summary artifacts pass through | ADR-033 |
| 3 — Stale preimage | `StalePatchError` before any write; file unchanged after error; new-file hash | ADR-031 |
| 4 — Blob integrity | Corrupted blob → `IntegrityError`; expired pointer → `ArtifactCollectedError`; bad schema version → `UnsupportedSchema` | ADR-032 |
| 5 — SQLite multi-process safety | Delegated to `test_wal_safety.ts` | ADR-031 |
| 6 — Budget enforcement | Delegated to `test_budget_guard.ts` | ADR-032 |
| 7 — GC safety | Shared blob survives when one referencing scan is GC'd; blob deleted when all referencing pointers gone | ADR-028 |
| 8 — Bundle portability | Delegated to `test_portability.ts` | ADR-029 |
| 9 — ProofValidator strictness | Missing proof, bad hash, out-of-scope patch, failing test report, invalid hash format — all rejected | ADR-030 |
| 10 — Delegation semantics | `spawn_worker` returns `DelegationRequest` only, no subprocess; re-spawn of active work order blocked | ADR-030 |

**This is the primary regression gate.** Checks 2 and 10 directly encode the two adversarial bugs found in the 2026-06-11 audit. If either regresses, the bugs are back.

---

## What Is Not Covered by Automated Tests

These require manual verification or integration tests against a real project:

- `scan_project` end-to-end on a real TypeScript codebase (Tree-Sitter WASM init, graph.json, dossier.json generation).
- `vibe-splain serve` MCP server startup and tool registration (JSON-RPC transport).
- UI `file://` rendering of injected `window.__VIBE_DOSSIER__` (Vite single-file build).
- `vibe-splain install` agent config patcher for Claude/Cursor/VS Code.
- `console.log` absence check — any stray `console.log` in `brain/` or `cli/` corrupts the MCP stdio stream. Verify with: `grep -rn 'console\.log' packages/brain/src packages/cli/src`.
