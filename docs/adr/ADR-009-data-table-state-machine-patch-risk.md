# ADR-009 — `data_table` State Machine Patch Risk Floor

**Status:** Accepted — Implemented
**Date:** 2026-06-11
**Deciders:** Aayush Patel

---

## Context

Data table context providers manage filters, sorting, pagination, segment selection, column visibility, and saved view state. They do not perform database writes or external mutations. Because `inferPatchRisk` in `pipeline/scoring.ts` is gated on `loadBearingScore`, `sideEffectProfile`, and `importedByCount`, these files fall through to `low` patch risk.

`state_machine` is already emitted (by `analysis.ts:290`) for any file with cyclomatic complexity > 20, domain-agnostic. A data table context provider with complex state transition logic receives `state_machine` but no corresponding patch risk signal — the label exists, the guarantee does not.

A regression in a data table provider can show wrong filtered records, select the wrong segment, reset user state incorrectly, apply stale filters, or cause downstream mutation actions to operate on the wrong visible set. This matters for bank-system equivalents: credit work queues, KYC review queues, exception dashboards, loan approval tables. A table segment state machine can be operationally load-bearing even when it looks like pure UI code.

`DataTableSegmentContext.tsx` is the canonical failing case: classified as `data_table`, carries `state_machine`, gets `low` patch risk.

---

## Decision

Add a domain-gated floor in the correction pass (stage 9):

**Primary rule:**
If `productDomain === 'data_table'` AND `riskTypes.includes('state_machine')`, force `patchRisk.level` to at least `'medium'`. Reason: `"data_table state machine: controls user-visible workflow state (filters, segments, sorting, pagination) — regression risk not captured by mutation scoring."`

**Secondary rule:**
If `productDomain === 'data_table'` AND `frameworkRole === 'context_provider'`, ensure `observableOutputs` includes at least one of: `'ui_state_transition'`, `'filter_state'`, `'selected_segment'`, `'table_view_state'`. Add whichever are absent. This makes the observable surface explicit in delta targets.

**Validation report — warning (not hard error):**
If `productDomain === 'data_table'` and `riskTypes.includes('state_machine')` and `patchRisk.level === 'low'` → warning: `"data_table state machine should have at least medium patch risk."`

This is a warning rather than a hard error because a data table provider may legitimately be low-complexity (cyclomatic < 20, small, presentational). The primary rule only fires when `state_machine` is already present, which requires cyclomatic > 20 — so in practice the rule fires only when complexity is already high.

---

## Rationale

The rule must be domain-gated, not universal. `state_machine` on a `booking_creation` hook already reaches `high` or `critical` through mutation-path scoring. Applying a universal `state_machine → medium` floor would interfere with those stronger paths. The gap is specifically `data_table` providers — stateful views with no direct side effects.

`isLoadBearing` is not forced here (unlike ADR-008). A data table context provider is not necessarily load-bearing in the graph-structural sense — it may have few importers. The risk is the *user-visible state it controls*, not the blast radius of its interface changes. `patchRisk: medium` is the right signal; `isLoadBearing: true` would misrepresent the graph structure.

---

## Consequences

- `DataTableSegmentContext.tsx` and similar providers score `medium`, not `low`.
- Future `data_table` context providers with high cyclomatic complexity are automatically covered without per-file tuning.
- The secondary rule makes observableOutputs non-empty for data_table providers, which improves Delta Engine's understanding of what changes when one of these files is patched.
- Files in other domains that happen to carry `state_machine` are not affected.
- Do not add `data_table + state_machine → high`. These files do not write external state. Medium is the correct floor; high is reserved for external mutation paths.
