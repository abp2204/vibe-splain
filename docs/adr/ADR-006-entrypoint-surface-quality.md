# ADR-006 — Entrypoint Surface Quality Check (`partial_wrong_surface`)

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The previous `entrypointTraceStatus` was purely structural:
- `complete` — found entrypoints, no unresolved imports
- `partial` — found entrypoints, some unresolved imports
- `blocked_by_alias_resolution` — no entrypoints, unresolved imports exist
- `no_runtime_entrypoint_found` — no entrypoints, no unresolved imports

This did not distinguish between finding entrypoints that are *semantically correct* for the file's domain and finding entrypoints that are technically reachable but domain-wrong. For example, `useBookings.ts` (a `booking_creation` hook) tracing only to an event-type configuration page is classified as `partial` — a non-obvious false negative that looks like success.

---

## Decision

Add `partial_wrong_surface` to `DeltaTarget.entrypointTraceStatus`.

**Detection logic:**

Each `ProductDomain` defines:
- `expectedSurfacePatterns: RegExp[]` — paths matching these are correct surfaces
- `knownWrongSurfacePatterns: RegExp[]` — paths matching these are wrong surfaces for this domain

If `runtimeEntrypoints` is non-empty AND all found entrypoints match a `knownWrongSurfacePattern` AND none match an `expectedSurfacePattern`, status is `partial_wrong_surface`.

**Domain patterns (seed set — extend as needed):**
```ts
const DOMAIN_SURFACE_PATTERNS: Partial<Record<ProductDomain, {
  expected: RegExp[];
  wrong: RegExp[];
}>> = {
  booking_creation: {
    expected: [
      /book/i, /booking/i, /reschedule/i,
      /booking-success/i, /api\/book/i, /create-booking/i,
    ],
    wrong: [
      /event-type/i, /event-types/i, /eventtypes/i,
      /availability/i, /schedule/i,
    ],
  },
  payments_webhooks: {
    expected: [/webhook/i, /stripe/i, /payment/i],
    wrong: [/settings/i, /onboarding/i, /profile/i],
  },
  auth_oauth: {
    expected: [/oauth/i, /callback/i, /auth/i, /signin/i, /login/i],
    wrong: [/booking/i, /payment/i, /settings/i],
  },
};
```

**Updated trace status derivation:**
```ts
function deriveEntrypointTraceStatus(
  domain: ProductDomain,
  entrypoints: RuntimeEntrypoint[],
  unresolved: string[],
): DeltaTarget['entrypointTraceStatus'] {
  if (entrypoints.length === 0 && unresolved.length > 0)
    return 'blocked_by_alias_resolution';
  if (entrypoints.length === 0)
    return 'no_runtime_entrypoint_found';

  const patterns = DOMAIN_SURFACE_PATTERNS[domain];
  if (patterns) {
    const allWrong = entrypoints.every(e =>
      patterns.wrong.some(p => p.test(e.path)) &&
      !patterns.expected.some(p => p.test(e.path))
    );
    if (allWrong) return 'partial_wrong_surface';
  }

  return unresolved.length === 0 ? 'complete' : 'partial';
}
```

**Validation report behavior:** `partial_wrong_surface` is a **warning** (not a hard error). The finding must include which entrypoints were found, which expected patterns were not matched, and which wrong patterns were matched.

---

## Rationale

- The previous structural check gave a false `partial` status for `useBookings.ts`, masking a genuine classification failure in the entrypoint tracer.
- Pattern-based matching (not an explicit path allowlist) is required because VIBE-SPLAIN runs against arbitrary repos, not just Cal.com. Cal.com paths seed the patterns; they are not a hard allowlist.
- A domain-aware check is the right place to catch wrong surfaces. The entrypoint tracer is graph-structural; the surface quality check is semantic.

---

## Consequences

- `DOMAIN_SURFACE_PATTERNS` lives in `pipeline/scoring.ts` (stage 8, load-bearing). It is not in `signals.ts` — it is runtime logic, not a type definition.
- When adding a new `ProductDomain` to `signals.ts`, also consider whether it needs entries in `DOMAIN_SURFACE_PATTERNS`. If the domain has known wrong surfaces, add them.
- `partial_wrong_surface` generates a validation warning but does not block output generation. The agent reading the dossier can still make decisions — it just sees that the trace quality is questionable.
- The `blockedImports` field on `DeltaTarget` remains the explanation for `blocked_by_alias_resolution`. For `partial_wrong_surface`, the validation report provides the surface mismatch detail.
