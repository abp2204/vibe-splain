# ADR-030 — Manager-Worker Delegation

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

High-volume execution tasks pollute a Manager agent's context. Delegation is required, but Workers must prove their work to the Manager without forcing the Manager to re-execute the task.

---

## Decision

Implement a **Manager-Worker Delegation** model driven by **Verifiable Proof**.

1. **Delegation Request:** Manager calls `spawn_worker(workOrderId)`. The MCP server returns a `DelegationRequest` data structure. The Client Orchestrator — not the MCP server — spawns the isolated Worker session.
2. **Verifiable Proof Contract:** A Work Order's `requiredProof` is not a checklist of text claims; it is a contract for machine-verifiable evidence artifacts (e.g., `test_report.v1`, `patch_hash`).
3. **Receipt Validation:** Workers return a `WorkerReceipt` containing pointers to the proofs. `submit_receipt` runs `ProofValidator.validate()` — 8 machine checks — before updating the work order status.

### Work Order Lifecycle

```
pending  →  active  →  completed
                    →  failed
                    →  blocked   (yield_for_scope_expansion)
```

A work order in `active`, `completed`, or `failed` state cannot be re-spawned. Managers must create a new work order to retry.

### Receipt Schema

```ts
type WorkerReceipt = {
  workOrderId: string;
  status: "completed" | "failed" | "blocked";
  proofPointers: { pointer: string; schemaName: string; contentHash: string }[];
  changedFiles: { path: string; prePatchHash: string; postPatchHash: string }[];
  summary: string;
};
```

---

## Implementation

- **`create_work_order`** (`packages/cli/src/mcp/tools/work_orders.ts`): inserts `WorkOrderRow` into PointerStore; returns `workOrderId`.
- **`spawn_worker`**: loads `WorkOrderRow`, guards `status ∈ {active, completed, failed}` → throws `WorkOrderClosed`. Sets status to `active`. Returns `DelegationRequest` struct. **No subprocess is spawned by the MCP server.**
- **`submit_receipt`** (`packages/cli/src/mcp/tools/submit_receipt.ts`): builds `isAllowedFile` predicate using `minimatch`, calls `ProofValidator.validate()`, inserts receipt row, updates work order status.
- **`ProofValidator`** (`packages/brain/src/ProofValidator.ts`): 8 checks — missing proofs, unresolvable blobs, hash integrity, schema match, test status, scope violations, hash format, patch-hash cross-check. Accepts injected `isAllowedFile` predicate to keep `brain` free of runtime dependencies.
- **Adversarial fix:** `spawn_worker` was originally only guarding `completed`/`failed`. The `active` guard was added after adversarial check 10 exposed that a Manager could double-spawn an active work order.
- **Verified by:** `test_adversarial.ts` checks 9 (ProofValidator strictness) and 10 (delegation semantics).

---

## Rationale

Keeps Manager context clean (strategy only) while guaranteeing execution integrity through cryptographic hashes and structured logs.

## Consequences

- `packages/brain` implements `ProofValidator` with injected predicate (no `minimatch` dep in brain).
- Client Orchestrator must handle Worker lifecycle outside the MCP boundary.
