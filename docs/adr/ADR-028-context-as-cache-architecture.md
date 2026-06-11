# ADR-028 — Context-as-Cache Architecture

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

LLM context windows are a finite, expensive, and noisy resource. In complex codebase analysis, dumping raw data into history causes context pollution, hallucinations upon pruning, and poor scaling.

---

## Decision

Adopt a **Context-as-Cache** architecture. Chat history is an ephemeral execution cache; all durable technical state must be persisted as **Artifacts** and accessed via **Pointers**.

### State Classification

| State | Medium | Examples |
|---|---|---|
| Ephemeral Reasoning | History | Local logic, intent, intermediate thoughts |
| Bounded Context | History | Summaries, receipts, small slices |
| Durable Technical State | Artifacts | Skeletons, graphs, patch records, proof blobs |

### History Sanitization & Reasoning Anchors

The **Client Orchestrator** (not the MCP server or Agent) owns history sanitization, driven by context pressure or task phase completion. When heavy outputs are sanitized, they are replaced by **Durable Receipts**. A Durable Receipt must include a **Reasoning Anchor** (a stable ID matching agent thoughts) and a compact summary so the agent remains aware of the data without needing it raw in context.

To prevent "re-read storms", the Orchestrator maintains a Short-Term Memory Cache of recently sanitized results to quickly hydrate agent requests.

### Garbage Collection & Tiered Expiration

Artifact retention is manifest-driven via a `vibe-splain gc` command:

1. **Session-local:** Safe to delete when session ends/TTL expires.
2. **Scan-local:** Keep last `N` successful scans (default 3), plus pinned scans.
3. **Task-local:** Keep until Work Order finalize + TTL.
4. **Durable:** Accepted decisions/patches kept indefinitely.

*Rule: Blobs are only deleted when reference counts reach zero.* If an agent requests a collected pointer, it receives an explicit `ArtifactCollectedError`.

---

## Implementation

- **`PointerStore`** (`packages/cli/src/store/PointerStore.ts`): SQLite-backed registry. Tables: `pointers`, `work_orders`, `receipts`. Singleton per process. Serialized writes via `async-mutex`.
- **`BlobStore`** (`packages/cli/src/store/BlobStore.ts`): Content-addressed immutable blobs at `.vibe-splainer/blobs/sha256_<hex>`. Atomic write via `tmp → fsync → rename`.
- **`gcCommand`** (`packages/cli/src/commands/gc.ts`): Keeps last N scans by lexicographic scanId sort. Reference-counts blobs from kept pointers before deleting old pointer rows; then deletes unreferenced blobs.
- **`ArtifactCollectedError`**: thrown by `hydratePointer` in `BudgetGuard.ts` when `expiresAt < Date.now()`.
- **Verified by:** `test_wal_safety.ts` (WAL safety), `test_budget_guard.ts` (auto-pointer conversion), `test_adversarial.ts` check 7 (GC ref-count).

---

## Rationale

Ensures long-running sessions never exceed context limits while maintaining mathematically provable recovery and auditing.

## Consequences

- Requires Client Orchestrator integration for sanitization.
- Introduces `DurableReceipt` and `ArtifactCollectedError` schemas.
