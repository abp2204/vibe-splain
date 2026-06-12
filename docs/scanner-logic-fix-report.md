# Scanner Validation & Classification Logic Technical Report

**Date:** June 11, 2026  
**Status:** Completed  
**Impact:** Reduction of validation errors in Cal.com from 35 to 1; Trace coverage increased by 25%.

## 1. Initial Problem Assessment

The VIBE-SPLAIN scanner produced a validation report for the `calcom/apps/web` project with significant failures that blocked Delta Engine automation.

### Key Metrics at Start:
- **errorCount:** 35
- **warningCount:** 23
- **entrypointTraceCoverage:** 24%

### Primary Failure Categories:
1.  **Missing Evidence (hotSpans):** Payment webhook files marked with severity 5 had 0 hotSpans.
2.  **Webhook False Positives:** UI components and setup pages (e.g., `PaymentPage.tsx`, `Setup.tsx`) were being incorrectly classified as webhook ingress points, triggering missing side-effect errors.
3.  **Booking Creation Noise:** App Router page wrappers and layouts were flagged for missing entrypoints, despite being architectural delegates.
4.  **Low Trace Coverage:** High-severity routes were showing 0 runtime entrypoints because the tracer didn't count the files themselves as entrypoints.

---

## 2. Investigation Journey

### Phase 1: Entrypoint Tracing (Low Coverage)
**Where I looked:** `packages/brain/src/pipeline/classification.ts` -> `findRuntimeEntrypoints`.  
**Why:** The tracer was intended to find paths *up* to an entrypoint. However, I observed that API routes and pages (which *are* entrypoints) were failing the `high_severity_no_entrypoints` check.  
**Discovery:** The logic explicitly checked `if (current.path !== relPath)` before allowing a file to be its own entrypoint. This meant that unless an entrypoint was imported by *another* entrypoint, it was invisible to the trace metric.  
**Change:** Removed the `!== relPath` guard. If a file matches an `ENTRYPOINT_ROLE` (like `pages_api_route`), it now registers as its own entrypoint at distance 0.

### Phase 2: Webhook Evidence (Missing hotSpans)
**Where I looked:** `packages/brain/src/pipeline/inventory.ts` -> `analyzeAst`.  
**Why:** Files like `pages/api/stripe/webhook.ts` contain critical event-routing logic but were producing 0 hotSpans.  
**Discovery:** The complexity scorer was purely structural (cyclomatic + LOC). In many webhook handlers, the boilerplate of imports and setup diluted the "heat" of the `switch(event.type)` block, causing it to fall below the threshold for `hotSpans`.  
**Change:** 
- Added a "Webhook Boost" (+25 score) to functions containing keywords like `stripe`, `webhook`, or `signature` combined with branching logic (`switch`, `case`, `if`).
- Lowered the minimum `bodyLOC` for hotSpans from 4 to 2 to capture concise re-exports and small handlers.

### Phase 3: Webhook Classification (False Positives)
**Where I looked:** `packages/brain/src/pipeline/classification.ts` -> `inferSideEffectProfile` and `packages/brain/src/pipeline/scoring.ts` -> `buildValidationReport`.  
**Why:** Setup components for BtcPay and Alby were failing webhook validation rules.  
**Discovery:** The scanner was over-triggering the `payments_webhooks` domain because it found `webhook` in the path (e.g., `/api/integrations/btcpayserver/webhook`) or payment terms in the source.  
**Change:** 
- Refined `webhook_ingress` detection to specifically look for `signature`, `svix`, `req.rawBody`, etc.
- In `scoring.ts`, I updated the webhook candidate gate. A file is now only subject to webhook validation if it has an explicit `handle_payment_webhook` intent **OR** it has `webhook_ingress` side effects. Crucially, I excluded files with `frameworkRole === 'component'`, as UI components should never be validated as server-side ingress points.

### Phase 4: Booking Surface Delegates
**Where I looked:** `packages/brain/src/pipeline/scoring.ts` -> `buildValidationReport`.  
**Why:** App Router layouts in `app/(booking-page-wrapper)/` were triggering `booking_creation_no_entrypoint_no_blockers`.  
**Discovery:** These layouts are part of the booking domain but are "thin" wrappers. They shouldn't be required to have direct entrypoints unless they actually perform a mutation.  
**Change:** Updated the rule to only fire if the file also contains mutation evidence (`booking_mutation` effect or keywords like `createBooking`).

---

## 3. Detailed Logic Changes

### `packages/brain/src/pipeline/classification.ts`
- **Webhook Detection:** Expanded regex to include modern webhook libraries (`svix`) and raw body accessors (`req.rawBody`).
- **Entrypoint Tracer:** Allowed distance-0 entrypoint registration.

### `packages/brain/src/pipeline/inventory.ts`
- **AST Scoring:** Implemented semantic boosting for webhook handlers and Prisma write paths.

### `packages/brain/src/pipeline/scoring.ts`
- **Validation Gating:** Implemented role-aware exemptions for layouts and components.
- **Evidence Requirements:** Added a check for re-export patterns (`export { ... }`) to exempt them from `hotSpans` requirements.

---

## 4. Verification & Validation

### Regression Suite: `packages/cli/tests/test_logic_fixes.ts`
I authored a new test suite that scaffolds a dummy Next.js project to prove:
1.  API route files are correctly identified as their own entrypoints.
2.  Webhook handler logic (headers + signature) triggers `hotSpans`.
3.  Payment UI pages are ignored by the webhook validator.
4.  Booking layouts without mutations are ignored by the entrypoint validator.

### Cal.com Final Validation:
The re-scan of Cal.com confirmed the effectiveness of the fixes:
- **Errors:** 35 → 1 (The remaining error is a legitimate classification ambiguity in `BookEventForm.tsx`).
- **Trace Coverage:** 24% → 49%.
- **Webhook Evidence:** `pages/api/stripe/webhook.ts` successfully produced 1 hotSpan.

---

## 5. Conclusion
The scanner is now significantly more "context-aware." By moving away from purely structural metrics and incorporating role-based heuristics (Next.js specific roles) and semantic boosts, VIBE-SPLAIN provides a much higher signal-to-noise ratio for automated modernization tools.
