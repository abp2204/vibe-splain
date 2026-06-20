# ADR-033 — Multi-Layer Scope Enforcement

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

Workers must not modify or read files outside their `allowedFiles` whitelist. Prompt instructions are insufficient for security.

---

## Decision

Enforce scope as an **API Contract** across multiple layers.

### Multi-Layer Enforcement

1. **MCP Session Scope (`SessionScope`):** The Orchestrator calls `set_session_scope` with the `workOrderId`. All file tools (`read_file`, `get_file_skeleton`, `apply_patch`) call `SessionScope.enforce(filePath)` before any disk access. Enforcement checks:
   - `allowedFiles`: exact suffix match against the explicit list.
   - `allowedGlobs`: `minimatch` pattern match.
   - `deniedGlobs`: overrides the allow lists — matched paths are always rejected.
2. **Artifact Scope:** `get_evidence_slice` enforces scope for `file_read` and `file_skeleton` artifact types by parsing the embedded `filePath` from the blob JSON and calling `SessionScope.enforce()`. Summary artifacts (`analysis.index`, `artifact_manifest`, etc.) are exempt — they contain only metadata, not raw file content.
3. **Patch Guard:** `apply_patch` enforces scope AND hash-guards (see ADR-031) before any write. Scope is checked before the preimage hash — a path violation aborts before any filesystem read.
4. **Receipt Validation:** `ProofValidator.validate()` checks `changedFiles[].path` against the `isAllowedFile` predicate from the Work Order. Out-of-scope paths produce `ScopeViolation` errors in the validation result and cause the receipt to be rejected.

### Scope Escalation (Yielding)

Workers cannot expand their own scope. If a Worker discovers a root cause in `B.ts` while constrained to `A.ts`, it calls `yield_for_scope_expansion(reason, evidencePointers)`. This:
1. Clears the active `SessionScope` immediately (subsequent file tool calls will fail).
2. Returns a `blocked` receipt to the Manager containing the workOrderId, evidence pointers, and escalation reason.

*Rule: Workers may request scope expansion, but only Managers may grant it — by creating a new work order with expanded scope.*

### Scope Invariant

> If `SessionScope` is active, any file tool call on a path not in `allowedFiles ∪ allowedGlobs` (or matching `deniedGlobs`) must throw `ScopeViolation` before any filesystem read or write occurs.

---

## Implementation

- **`SessionScope`** (`packages/cli/src/mcp/SessionScope.ts`): module-level singleton `activeScope`. `ScopeViolation` error carries `path` and `workOrderId`. `enforce(filePath)` checks all three lists via `minimatch`. `fromWorkOrderRow(row)` parses JSON fields.
- **`set_session_scope`** (`packages/cli/src/mcp/tools/set_session_scope.ts`): loads WorkOrderRow, calls `SessionScope.set(SessionScope.fromWorkOrderRow(row))`.
- **`yield_for_scope_expansion`** (`packages/cli/src/mcp/tools/yield_for_scope_expansion.ts`): records `workOrderId`, calls `SessionScope.clear()`, returns `{status: 'blocked', ...}`.
- **`get_evidence_slice` scope fix** (adversarial finding — 2026-06-11): the initial implementation did not enforce scope on artifact hydration. Fixed by parsing the `filePath` field from `file_read`/`file_skeleton` blob JSON and calling `SessionScope.enforce()` before returning the slice. Summary-type artifacts pass through without scope checks.
- **Verified by:** `test_scope_enforcement.ts`, `test_adversarial.ts` checks 1 and 2.

---

## Rationale

Guarantees absolute containment of automated edits and enforces architectural review before scope creep occurs.

## Consequences

- `get_evidence_slice` enforces scope on file-content artifacts; summary artifacts are always accessible.
- `yield_for_scope_expansion` immediately disables the session scope — the tool is a one-way door.
