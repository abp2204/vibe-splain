# ADR-032 — Tool Output Discipline & Hydration

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

Returning massive JSON artifacts or 10,000-line source files directly to the agent blows out context budgets immediately.

---

## Decision

Enforce strict **Output Discipline** at the MCP tool boundary via a `BudgetGuard` and **Specialized Hydration Tools**.

1. **Auto-Pointer Conversion:** Any tool output exceeding the budget (~2,000 tokens / 8,000 chars) is automatically written to the blob store; the agent receives a pointer and a compact summary.
2. **Hydration over Querying:** Use specialized tools that read pre-computed indexes and return token-safe views. Raw structural reads over full artifacts are the secondary fallback only.
3. **Escape Hatch:** `get_evidence_slice(pointerId, startLine, endLine)` for raw line-range reads; capped at `startLine + 200` lines per call.

*Rule: Pointers locate artifacts. Indexes make artifacts cheap to query. Hydration tools make artifacts safe for context.*

### Budget Result Schema

```ts
type BudgetExceededResult = {
  pointerId: string;
  contentHash: string;
  sizeBytes: number;
  summary: string;
  hydrators: string[];   // tool names the agent should call next
};
```

### Pointer Validation Invariants

Every `hydratePointer()` call enforces:
1. Pointer exists in PointerStore.
2. `expiresAt` is null or in the future (`ArtifactCollectedError` if expired).
3. `schemaVersion` is in `['1.0.0', '2.0.0']` (`UnsupportedSchema` if not).
4. Blob content hash matches pointer's `contentHash` (`IntegrityError` if mismatch).

---

## Implementation

- **`BudgetGuard`** (`packages/cli/src/mcp/BudgetGuard.ts`): `BUDGET_CHARS = 8000`. `applyBudgetGuard()` serializes output, checks length, writes blob, inserts pointer, returns `BudgetExceededResult`. `hydratePointer()` enforces all 4 invariants above.
- **Hydration tools:**
  - `get_start_here` — top 5 gravity files from `analysis.index` pointer. No raw file content.
  - `get_project_summary` — scan metrics (file counts, pillar summary, stack) from manifest or analysis.index pointer.
  - `get_evidence_slice` — raw line-range fallback; budgeted; scope-enforced for `file_read`/`file_skeleton` artifacts (see ADR-033).
- **File tools:** `read_file`, `get_file_skeleton`, `apply_patch` all call `applyBudgetGuard()` on their output as the final step.
- **Verified by:** `test_budget_guard.ts` (5MB payload → pointer + summary), `test_adversarial.ts` checks 4 and 6.

---

## Rationale

Maintains the context budget without requiring the LLM to understand complex internal schemas or pagination logic.

## Consequences

- Export pipelines must generate indexes alongside large artifacts.
- MCP Server implements `BudgetGuard` middleware applied uniformly across all data-returning tools.
