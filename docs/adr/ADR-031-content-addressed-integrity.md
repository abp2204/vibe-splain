# ADR-031 — Content-Addressed Integrity & Concurrency

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

In multi-agent setups or parallel CLI usage, race conditions can corrupt `.vibe-splainer/` state. Furthermore, "Skeleton Drift" occurs if an agent reasons about an outdated file view.

---

## Decision

Enforce integrity through **Content-Addressing**, **Hash-Guards**, and **SQLite WAL**.

### Storage & Concurrency Model

- **SQLite stores metadata and indexes.** Must use `PRAGMA busy_timeout = 5000;` (set first) then `PRAGMA journal_mode = WAL;`. Serialized writes via `async-mutex` within a process; WAL handles concurrent reads from other processes.
- **Filesystem stores immutable blobs.** `.vibe-splainer/blobs/sha256_<hex>` — named by content hash, never overwritten.
- Blobs must be written atomically: `writeFile(tmp) → open(tmp).datasync() → close() → rename(tmp, blob)`.
- BlobStore deduplicates: if a blob already exists at the target path, `writeAtomic()` returns immediately without re-writing.

### Hash-Guarded Integrity

1. **Skeletons:** Cache key = `skeleton:<contentHash>:<parserVersion>`. A changed file produces a different hash and bypasses the cache automatically.
2. **Patches:** Every `apply_patch` call requires `expectedPrePatchHash`. The tool computes `diskHash = hashFile(path)` before any write. If `diskHash !== expectedPrePatchHash`, throws `StalePatchError` and aborts — no write occurs.
3. **New files:** When the target file does not exist, `diskHash = 'sha256:new'`. Callers must pass `expectedPrePatchHash: 'sha256:new'`.

---

## Implementation

- **`BlobStore`** (`packages/cli/src/store/BlobStore.ts`): `writeAtomic()` uses `open().datasync().close()` before `rename()`. `verifyIntegrity(blobPath, expectedHash)` re-hashes on read. `listBlobPaths()` enumerates the blobs dir for GC reference counting.
- **`PointerStore`** (`packages/cli/src/store/PointerStore.ts`): pragma ordering is `busy_timeout = 5000` **first**, then `journal_mode = WAL`. This is mandatory — setting `journal_mode = WAL` requires an exclusive lock, and `busy_timeout` must be in effect to retry through contention during concurrent startup.
- **`StalePatchError`** (`packages/cli/src/mcp/tools/apply_patch.ts`): carries `filePath`, `expectedHash`, `actualHash`. Thrown before any write attempt.
- **`hashFile()`** and **`computeHash()`** (`packages/cli/src/store/BlobStore.ts`): shared hashing utilities exported for use by all tools and `ProofValidator`.
- **Verified by:** `test_wal_safety.ts` (5 concurrent processes, 500 pointers, zero `SQLITE_BUSY`), `test_stale_patch.ts`, `test_adversarial.ts` checks 3 and 4.

---

## Rationale

Prevents data corruption across parallel processes without a heavyweight background server. Guarantees agents cannot apply stale patches.

## Consequences

- `.vibe-splainer/` storage is split into `pointer_store.db` and `blobs/`.
- `packages/brain` exposes deterministic hashing via `ProofValidator.ts`; utilities live in `BlobStore.ts` in the CLI layer.
