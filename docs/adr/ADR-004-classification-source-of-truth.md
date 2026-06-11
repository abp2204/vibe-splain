# ADR-004 — Classification Is Source of Truth; Scoring Only Corrects Contradictions

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The five known failures split into two root causes:

**Root cause A — classification bugs** (wrong domain or missed side-effect):
- Payment webhook: `sideEffectProfile` contained `none_detected` despite `writeIntents` containing `handle_payment_webhook`. The `webhook_ingress` detector was too narrow (only matched `stripe.webhooks.constructEvent`).
- `useBookings.ts`: `booking_mutation` not detected because the hook uses tRPC `useMutation` rather than calling `createBooking` directly.

**Root cause B — threshold calibration** (right classification, wrong score):
- `Components.tsx`: `registry_bottleneck` required `fanIn > 5 && publicSurface > 8` — threshold too high for a real form registry.
- `DataTableSegmentContext.tsx`: `state_machine` required `cyclomatic > 20` — too high for a context file.

Two approaches were considered for fixes: (1) fix the classification detectors so they catch these patterns naturally, or (2) add post-processing overrides in the scoring stage that hard-code corrections for known failures.

---

## Decision

**Fix classification detectors first. The scoring stage adds only a lightweight contradiction/invariant correction pass.**

Classification (`pipeline/classification.ts`) is the source of truth for discovering facts about a file: its domain, its side effects, its write intents, its risk types. The scoring stage (`pipeline/scoring.ts`) is responsible for computing values from those facts — not for discovering new facts.

**Classification detector expansions:**

`inferSideEffectProfile` expansions:
```ts
// webhook_ingress — expanded beyond stripe.webhooks.constructEvent
if (
  /stripe\.webhooks\.(constructEvent|constructEventAsync)|webhookSecret|validateWebhook|verifyWebhook|verifySignature/.test(source) ||
  (productDomain === 'payments_webhooks' && frameworkRole === 'pages_api_route')
) effects.add('webhook_ingress');

// payment_mutation — also fires when webhook_ingress is confirmed on a payment domain route
if (
  importSpecs.some(s => /stripe|paypal|btcpay|alby/.test(s.toLowerCase())) ||
  /stripe\.|paymentIntent|createPaymentIntent|confirmPayment|createCharge/.test(source) ||
  (productDomain === 'payments_webhooks' && effects.has('webhook_ingress'))
) effects.add('payment_mutation');

// booking_mutation — expanded to tRPC useMutation in booking domain context
if (
  /createBooking|handleNewBooking|cancelBooking|rescheduleBooking|handleBooking|createRecurring/.test(source) ||
  (productDomain === 'booking_creation' && /useMutation\b|\.mutate\b|\.mutateAsync\b/.test(source))
) effects.add('booking_mutation');
```

`inferRiskTypes` expansions:
```ts
// registry_bottleneck — lower thresholds for forms domain
if (
  f.productDomain === 'forms' &&
  (f.gravitySignals.fanIn > 3 || f.gravitySignals.publicSurface > 5)
) types.push('registry_bottleneck');

// registry_consumer — new: forms component/hook that imports a registry_bottleneck file
if (
  f.productDomain === 'forms' &&
  (f.frameworkRole === 'component' || f.frameworkRole === 'hook') &&
  f.imports.some(imp => riskTypesByFile.get(imp)?.includes('registry_bottleneck'))
) types.push('registry_consumer');

// type_boundary_leak — now emitted as secondary signal for registry consumers
if (f.productDomain === 'forms' && types.includes('registry_consumer')) {
  types.push('type_boundary_leak');
}

// state_machine — lower threshold for context/provider/store roles
const stateMachineThreshold =
  (f.frameworkRole === 'provider' || f.frameworkRole === 'store') ? 8 : 20;
if (f.gravitySignals.cyclomatic > stateMachineThreshold) types.push('state_machine');
```

**Scoring correction pass — invariants only:**

The correction pass in stage 9 enforces logical invariants that *cannot* be false once classification is complete. It does not discover new facts.

```ts
function applyCorrections(f: PersistedFile): void {
  // If writeIntents says handle_payment_webhook, sideEffectProfile must agree
  if (f.writeIntents.includes('handle_payment_webhook')) {
    if (!f.sideEffectProfile.includes('payment_mutation'))
      f.sideEffectProfile.push('payment_mutation');
    if (!f.sideEffectProfile.includes('webhook_ingress'))
      f.sideEffectProfile.push('webhook_ingress');
    f.sideEffectProfile = f.sideEffectProfile.filter(s => s !== 'none_detected');
  }

  // payment_mutation or booking_mutation → severity cannot be < 4
  if (
    f.sideEffectProfile.includes('payment_mutation') ||
    f.sideEffectProfile.includes('booking_mutation')
  ) {
    if (f.canonicalSeverity < 4) f.canonicalSeverity = 4;
  }

  // severity 5 → must be load bearing
  if (f.canonicalSeverity === 5) f.canonicalLoadBearing = true;
}
```

The correction pass is a **safety net for logical contradictions**, not a substitute for good detectors. If the correction pass is doing heavy lifting for many files, it means the detectors need to be fixed.

---

## Rationale

- Fixing detectors gives accuracy across **all files**, not just the five known cases. A scoring override for the payment webhook would fix that one file but leave similar files (PayPal webhooks, BTC Pay webhooks) with the same bug.
- Scoring should not be responsible for discovering facts. If scoring has to figure out that `handle_payment_webhook` implies `payment_mutation`, it means classification failed — and the failure is hidden rather than fixed.
- The correction pass makes certain invariants machine-verifiable: the validation report can assert "no file with `handle_payment_webhook` has `none_detected` in sideEffectProfile."

---

## Consequences

- `inferRiskTypes` now requires a `riskTypesByFile: Map<string, RiskType[]>` parameter for cross-file `registry_consumer` detection. Stage 7 must run a two-pass approach: compute all non-cross-file risk types first, then compute cross-file risk types in a second iteration.
- Lowering `registry_bottleneck` thresholds may produce false positives in non-forms domains. The domain guard (`productDomain === 'forms'`) is essential — do not remove it.
- Any future classification detector expansion should be added in `pipeline/classification.ts`, not in the correction pass in `pipeline/scoring.ts`.
