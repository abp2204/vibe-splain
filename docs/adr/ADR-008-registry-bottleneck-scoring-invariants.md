# ADR-008 — `registry_bottleneck` Scoring Invariants (Correction Pass)

**Status:** Proposed
**Date:** 2026-06-11
**Deciders:** Aayush Patel

---

## Context

ADR-007 established the `registry_bottleneck` risk type and its detection logic (lowered threshold: `fanIn > 3 || publicSurface > 5` for the forms domain; two-pass inference in stage 7). Detection works. The gap is downstream: after a file receives `registry_bottleneck`, it is still scored by the metric-based `inferPatchRisk` in `pipeline/scoring.ts`.

`inferPatchRisk` scores by `loadBearingScore`, `importedByCount`, and `sideEffectProfile`. A registry file with low direct fan-in (e.g. `Components.tsx`, which has few static importers but controls runtime rendering for all booking form fields) and no external side effects falls through to `medium` or `low` patch risk. `isLoadBearing` may also be false if `loadBearingScore` is below threshold.

This is the exact failure the fix package describes: `Components.tsx` gets severity 2, not load-bearing, low patch risk — despite carrying `registry_bottleneck`. The reason `registry_bottleneck` exists is that graph metrics *cannot* capture blast radius through dynamic dispatch. Letting metric-based scoring silently override the semantic classification defeats the purpose of detecting it.

---

## Decision

Add correction pass rules in `pipeline/scoring.ts` for any file carrying `registry_bottleneck` in its `riskTypes`. These rules execute in the correction pass (stage 9), after metric-based scoring, and override the computed values upward only — never downward.

**Three invariants, enforced unconditionally:**

1. `canonicalSeverity` must be at least `4`. If metric scoring produced `< 4`, force it to `4`.
2. `isLoadBearing` must be `true`. Override if false.
3. `patchRisk.level` must be `'high'` or `'critical'`. If `'medium'` or `'low'`, upgrade to `'high'` with reason: `"registry_bottleneck: central dispatch point — blast radius not measurable by fan-in alone."`

**Validation report — hard errors (all three):**

- `registry_bottleneck` present and `canonicalSeverity < 4` → error
- `registry_bottleneck` present and `isLoadBearing === false` → error
- `registry_bottleneck` present and `patchRisk.level` is `'medium'` or `'low'` → error

These are hard errors, not warnings. A classifier that detects `registry_bottleneck` and a scorer that leaves it low-risk are contradicting each other. That contradiction must be visible.

---

## Rationale

`registry_bottleneck` is not a metric-derived label. It is a semantic classification: this file is a central runtime dispatch point, and changes to it break downstream paths through dynamic selection, not through static imports. The entire point of adding the risk type was to capture blast radius that `importedByCount` and `loadBearingScore` cannot see.

If `inferPatchRisk` can silently override this to `low`, then `registry_bottleneck` is decorative — it adds a label to the dossier but does not change Delta Engine's view of the target. That is worse than not detecting it, because it creates false confidence.

The correction pass is the right mechanism. Stage 9 exists precisely for semantic signals that should guarantee output properties regardless of metric values. `payment_mutation → patchRisk: high` (already in ADR-005) is the same pattern.

---

## Consequences

- `Components.tsx` (and any future registry bottleneck file) is guaranteed to appear in Delta Engine's high-risk target set, regardless of fan-in.
- The correction pass in `scoring.ts` grows by three conditional overrides. They are cheap and unconditional.
- The validation report adds three new hard error rules. Any future regression where the classifier detects `registry_bottleneck` but the scorer leaves it low-risk will fail the validation report rather than silently reaching Delta Engine.
- Do not add a `registry_bottleneck → critical` path here. Severity 4, high patch risk, load-bearing is the correct floor. Critical and severity 5 are reserved for files with direct external mutations — the registry controls rendering, not database writes.
