# ADR-007 — New `registry_consumer` RiskType

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The `registry_bottleneck` risk type existed to mark the central form component registry (e.g. `Components.tsx` in `modules/form-builder`). But there was no corresponding type to mark files that *consume* that registry heavily and become risky because they bridge registry output into runtime rendering.

`FormBuilderField.tsx` is a canonical example: it bridges the field registry (`Components.tsx`) into the booking form rendering path. A change to either the registry contract or the field renderer breaks the other. But with only `registry_bottleneck` available, `FormBuilderField.tsx` was classified as `complexity_hotspot` — the catch-all fallback — which carries no actionable information.

Additionally, `type_boundary_leak` was in the `RiskType` union but was **never emitted** by `inferRiskTypes`. It existed in the type definition but had no detection logic.

---

## Decision

1. Add `registry_consumer` to the `RiskType` union in `signals.ts`.

2. Emit `registry_consumer` when:
   - `productDomain === 'forms'`
   - `frameworkRole` is `'component'` or `'hook'`
   - The file imports at least one file already classified as `registry_bottleneck` (cross-file inference using `riskTypesByFile` map from stage 7's first pass)

3. Emit `type_boundary_leak` as a secondary signal for `registry_consumer` files:
   - If `registry_consumer` is emitted, also emit `type_boundary_leak` — the file bridges the registry type system into the rendering layer, which is a type boundary by definition.

4. `registry_bottleneck` detection thresholds are lowered for the forms domain:
   - Old: `fanIn > 5 && publicSurface > 8`
   - New: `fanIn > 3 || publicSurface > 5` (OR, not AND — a registry file with many exports is a bottleneck even if fanIn is lower)

**Expected results:**
```
Components.tsx        → riskTypes: ['registry_bottleneck']
FormBuilderField.tsx  → riskTypes: ['registry_consumer', 'type_boundary_leak']
```

---

## Rationale

- `registry_bottleneck` and `registry_consumer` are distinct concepts. One marks the central registry. The other marks files that depend on the registry output and become risky because of that dependency. Forcing both into the same label loses information.
- Cross-file inference is required for `registry_consumer` because the file itself doesn't know it's consuming a bottleneck — only the graph knows. Stage 7 runs a two-pass approach: first pass computes all non-cross-file risk types; second pass uses the first pass's results to emit cross-file types.
- `type_boundary_leak` was dead code in the type union. Wiring it up as a secondary signal for registry consumers gives it a concrete meaning: "this file bridges two type systems (registry types and rendering types) and changes to either will propagate through this file."
- `complexity_hotspot` is a catch-all fallback for files with no specific risk pattern. Replacing it with specific types (`registry_consumer`, `type_boundary_leak`) makes patchRisk reasoning and `safePatchStrategy` generation much more accurate.

---

## Consequences

- `signals.ts` gains one new union member: `'registry_consumer'`. No other changes to the type file.
- `inferRiskTypes` in `pipeline/classification.ts` must accept a `riskTypesByFile: Map<string, RiskType[]>` parameter. This is a **breaking change** to the function signature — update all call sites.
- The two-pass structure in stage 7 means `riskTypesByFile` is built from the first pass before the second pass runs `registry_consumer` detection. Both passes are within the same stage 7 execution — this is not a separate pipeline stage.
- Lowering the `registry_bottleneck` threshold may surface additional registry-like files in other projects. The `productDomain === 'forms'` guard prevents false positives in non-form domains.
- When `type_boundary_leak` gains a second emission path in the future (e.g. for API boundary files that bridge internal and external types), this ADR should be updated.
