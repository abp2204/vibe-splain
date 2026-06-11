# Implementation Report — ADRs 028–033

**Date:** 2026-06-11  
**Branch:** main  
**Version:** 2.7.3+

---

## What Was Built

Five implementation phases, all shipped together:

**Phase 1 — Storage Foundation**  
`PointerStore` (SQLite/WAL), `BlobStore` (content-addressed blobs), `ExportOrchestrator` updated to register every scan artifact as a blob+pointer and emit a v2 `ScanManifest`.

**Phase 2 — Budgets & Hydration**  
`BudgetGuard` middleware (8000 char limit → auto-pointer), `get_file_skeleton` (scoped, content-addressed, cached by hash+parserVersion), `get_start_here`, `get_project_summary`, `get_evidence_slice` hydration tools.

**Phase 3 — Delegation & Proof**  
`create_work_order`, `spawn_worker` → `DelegationRequest` (no subprocess), `apply_patch` (stale-preimage guard, atomic write, pre/post hash recording), `ProofValidator` in brain (8 machine checks), `submit_receipt`.

**Phase 4 — Scope & Escalation**  
`SessionScope` singleton, `set_session_scope`, `read_file` (scoped), `yield_for_scope_expansion` (one-way door, returns `blocked` receipt).

**Phase 5 — Lifecycle**  
`gc` (reference-counted, keeps last N scans), `bundle` (staged gzipped tar, portable blobs), `import` (hash-verified extraction, namespace aliasing).

---

## Adversarial Bugs Found and Fixed

### Bug 1 — `get_evidence_slice` Scope Bypass

**File:** `packages/cli/src/mcp/tools/hydration/get_evidence_slice.ts`  
**Found:** adversarial check 2 (artifact query bypass)  
**Class:** Insufficient enforcement — file-content artifacts not scope-checked

**Root cause:** `get_evidence_slice` called `hydratePointer()` then returned the blob slice without consulting `SessionScope`. A Worker with a pointer ID to a `file_read` blob for an out-of-scope file (e.g., obtained from a manifest given to them by the Manager) could read the raw file content through `get_evidence_slice` even though `read_file` on the same path would have thrown `ScopeViolation`.

**Fix:** After hydration, if `SessionScope` is active and `row.artifactName` is `file_read` or `file_skeleton`, parse the blob as JSON and call `SessionScope.enforce(parsed.filePath)`. If that throws, propagate the `ScopeViolation`. Summary-type artifacts (`analysis.index`, `artifact_manifest`, `evidence_slice`, `patch_record`, etc.) are exempt — they contain only structural metadata, not raw file content, and must remain accessible to Workers for navigation.

**Invariant now enforced:** A Worker scoped to `['src/a.ts']` cannot extract the content of `src/b.ts` through any MCP tool — whether `read_file`, `get_file_skeleton`, or `get_evidence_slice`.

---

### Bug 2 — `spawn_worker` Allows Re-Spawn of Active Work Order

**File:** `packages/cli/src/mcp/tools/work_orders.ts`  
**Found:** adversarial check 10 (delegation semantics)  
**Class:** Incomplete state guard — missing `active` from closed-status check

**Root cause:** The `WorkOrderClosed` guard only checked `status === 'completed' || status === 'failed'`. A work order already in `active` state (i.e., a Worker was already spawned and running) could be re-spawned via `spawn_worker`, creating two concurrent Workers sharing the same `workOrderId`. Both would be able to call `submit_receipt` for the same work order.

**Fix:** Added `|| row.status === 'active'` to the guard. A Manager that needs to retry a work order (e.g., because a Worker crashed without calling `submit_receipt`) must create a new work order — not re-spawn the original.

**Invariant now enforced:** Each work order ID maps to exactly one active Worker session at any given time. The work order lifecycle is monotonically forward: `pending → active → {completed | failed | blocked}`.

---

## Test Coverage

All bugs were caught by `packages/cli/tests/test_adversarial.ts` before any manual testing. See `docs/regression-test-list.md` for the full test inventory and run instructions.
