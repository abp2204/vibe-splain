# ADR-011 — Payment Webhook Positive Invariant Validation

**Status:** Accepted — Implemented
**Date:** 2026-06-11
**Deciders:** Aayush Patel

---

## Context

ADR-005 defines a hard validation error for: `writeIntents.includes('handle_payment_webhook') && sideEffectProfile.includes('none_detected')`. This catches the case where classification assigned the write intent but missed the side effects — an internal contradiction.

It does not catch missed classification: when the classifier fails to assign `handle_payment_webhook` to a file that is clearly a payment webhook handler, no contradiction exists and no validation error fires. The file silently appears as a low-risk generic route handler in `delta_targets.json`.

Payment webhook handlers are external write surfaces. Delta Engine's shadow proxy must not double-apply payment state, booking state, or external side effects when shadowing traffic. A missed classification of a payment webhook handler is a correctness failure with direct consequences for write sink safety — not a quality warning.

The previous run failed payment webhook detection. v2.5.0 fixed it. ADR-011 locks that fix as a permanent validation invariant so a future classifier regression is caught before reaching Delta Engine.

---

## Decision

Add proactive payment webhook file identification in `buildValidationReport` (`pipeline/scoring.ts`). For each file in the scan, evaluate two triggers:

**Primary trigger (path-based):**
`path` contains `webhook` (case-insensitive) AND `path` contains any of: `stripe`, `paypal`, `btcpay`, `btcpayserver`, `alby`, `hitpay`, `payment`

**Secondary trigger (content-based):**
`path` contains `webhook` (case-insensitive) AND file source contains any of: `constructEvent`, `checkoutSession`, `paymentIntent`, `invoice`, `subscription`, `charge`, `refund`, `payment_status`, `signatureVerification`, `stripe-signature`, `webhook-signature`

When either trigger fires, enforce six invariants as **hard validation errors**:

1. `productDomain !== 'payments_webhooks'` → error: `"Payment webhook file not classified as payments_webhooks domain."`
2. `!sideEffectProfile.includes('webhook_ingress')` → error: `"Payment webhook file missing webhook_ingress side effect."`
3. `!sideEffectProfile.includes('payment_mutation')` → error: `"Payment webhook file missing payment_mutation side effect."`
4. `!writeIntents.includes('handle_payment_webhook')` → error: `"Payment webhook file missing handle_payment_webhook write intent."`
5. `patchRisk.level !== 'high' && patchRisk.level !== 'critical'` → error: `"Payment webhook file has insufficient patch risk — must be high or critical."`
6. `isLoadBearing !== true` → error: `"Payment webhook file must be load-bearing."`

All six are hard errors. Any single failure makes the scan's validation report `passed: false`.

**Trigger matching lives in the validation stage (stage 12), not in classification.** It is a verification layer, not a reclassification attempt. If the trigger fires and the invariants fail, the correct fix is the classifier, not the validator.

---

## Rationale

The existing validation catches contradictions (ADR-005, reactive). This ADR adds proactive detection: identify payment webhook files independently of what the classifier decided, then verify the classifier got it right.

The two-trigger approach covers:
- Simple paths: `pages/api/integrations/stripepayment/webhook.ts` → primary trigger
- Renamed or nested routes: `api/webhooks/payment/index.ts` containing `constructEvent` → secondary trigger catches it even if `stripe` is not in the path

Both triggers use pattern matching, not exact path matching, so they generalize across project layouts.

The secondary trigger reads `source` from the file data already in the pipeline store — no additional I/O required.

---

## Consequences

- `pages/api/integrations/stripepayment/webhook.ts` and equivalent files are validated against all six invariants on every scan.
- A future classifier regression that drops `handle_payment_webhook` or `payment_mutation` from a payment webhook file will produce a hard validation error immediately.
- New payment providers require adding their name to the primary trigger list in `buildValidationReport`. This is intentional — new providers should be explicitly registered.
- Webhook files that only verify signatures (read-only endpoints) may trigger the secondary pattern. If this causes false positives, add a `webhook-verify` exclusion pattern to the trigger. Do not pre-emptively add it; wait for a confirmed false positive.
- The validation report finding must include: which trigger fired (path or content), which invariants passed, which failed, and the file's actual classification.
