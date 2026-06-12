You are verifying whether the Cal.com scan is fully complete and acceptable as a finished benchmark checkpoint.

Do not move on to market strategy, Shadow Proxy, Delta Engine, eBPF, new repositories, or any next phase.

Do not make broad scanner changes unless a required verification check fails.

Do not ask me for shell input. Run the necessary local inspections yourself and report the results.

Your job is to gather enough artifact proof that we can confidently say:

“Cal.com is done. The scanner output is clean, validated, and regression-protected.”

Verification target:
Cal.com app:
/Users/aayushpatel/Desktop/Code/calcom/apps/web

Required final artifacts to inspect:
validation_report.json
index.html or generated dossier artifact
delta_targets.json
analysis.json or equivalent analysis store artifact
action_bindings.json if present
regression test files related to Cal.com scan validation
implementation reports or benchmark docs related to this fix

Required checks:

1. Final validation status
   Confirm from the actual generated validation_report.json:
   passed === true
   errors is an array
   errors.length === 0
   warnings is an array
   warnings.length === 1
   the only warning file is pages/api/book/recurring-event.test.ts
   the only warning rule is high_severity_no_entrypoints
   the warning is acceptable because it is a test file with no runtime entrypoint

2. Validation report contract
   Confirm validation_report.json is not a count-only summary.
   It must contain:
   timestamp
   passed
   errors[]
   warnings[]
   summary

Confirm summary contains:
errorCount
warningCount
passCount
entrypointTraceCoverage

Also confirm the entrypointTraceCoverage metric is documented or explained with:
numerator
denominator
definition
baseline note or explanation if available

If numerator, denominator, or definition are missing, do not change scanner behavior. Just report this as a final documentation/metric-contract gap.

3. Cal.com booking flow trace correctness
   Verify BookEventForm.tsx:
   file: modules/bookings/components/BookEventForm/BookEventForm.tsx
   does not produce a validation error
   is mapped into the booking flow
   has create_booking or inherited create_booking intent only if justified
   traces to the correct public booking route:
   app/(booking-page-wrapper)/[user]/[type]/page.tsx

Verify useBookings.ts:
file: modules/bookings/hooks/useBookings.ts
is classified as a true booking mutation owner or booking_creation orchestration hook
has relevant side effects such as booking_mutation, payment_mutation, redirect, or equivalent
traces to the public booking route, not the event type editor
is not incorrectly downgraded to a UI delegate

4. Alias resolution proof
   Confirm the scanner resolves Cal.com monorepo aliases correctly:
   ~/ imports resolve correctly
   tsconfig.json extends are handled
   monorepo root or node_modules based config discovery works
   the prior wrong-surface warnings caused by alias failure are gone

Specifically confirm these warnings are no longer present:
partial_wrong_surface for modules/bookings/components/AvailableTimes.tsx
partial_wrong_surface for modules/bookings/components/AvailableTimesHeader.tsx
partial_wrong_surface for modules/bookings/hooks/useBookings.ts

5. Webhook evidence proof
   Confirm prior webhook hard errors are gone:
   high_severity_no_evidence no longer appears for payment webhook files
   webhook_domain no longer appears for payment UI/setup files
   webhook_ingress_missing no longer appears for payment UI/setup files
   webhook_write_intent_missing no longer appears for payment UI/setup files

Inspect the five payment webhook files:
pages/api/integrations/alby/webhook.ts
pages/api/integrations/btcpayserver/webhook.ts
pages/api/integrations/paypal/webhook.ts
pages/api/integrations/stripepayment/webhook.ts
pages/api/stripe/webhook.ts

For each, report:
classification/domain
severity
hotSpan count
whether hotSpans point to meaningful webhook logic such as signature verification, raw body parsing, event construction, event switch/case routing, or write/mutation behavior

6. Dossier consistency
   Inspect the generated dossier/index.html data payload.
   Confirm it agrees with validation_report.json:
   validation.passed matches
   validation.errors matches errorCount
   validation.warnings matches warningCount

Confirm the dossier no longer shows a hard-blocking scan quality warning if validation_report.passed is true.
If the UI still shows a red “automation may be blocked” banner while validation_report.passed is true, report this as a UI rendering bug.

7. Delta targets contract
   Inspect delta_targets.json.
   Confirm:
   it still follows the strict ADR-019 machine contract
   it has not accidentally gained rich human fields
   required fields remain stable
   target files make sense after the classification fixes
   no stale Cal.com false-positive targets remain from the old webhook or booking wrapper issues

8. Action bindings and function grounding
   Inspect action_bindings.json or equivalent action binding artifact if present.
   Confirm:
   useBookings.ts has useful function-level grounding
   BookEventForm.tsx has correct delegate-level grounding if applicable
   payment webhook files have meaningful action or side-effect grounding
   no obvious unresolved alias failures remain in critical booking or webhook paths

9. Regression tests
   Find and report all relevant regression tests added or updated for this Cal.com fix.
   Confirm there are tests for:
   detailed validation_report.json contract
   distance-zero runtime entrypoint tracing
   monorepo alias resolution
   tsconfig extends handling
   booking UI delegate versus booking mutation owner classification
   BookEventForm.tsx trace to public booking route
   useBookings.ts trace to public booking route
   webhook hotSpan evidence generation
   payment UI/setup files not being validated as webhook ingress
   expected warning for recurring-event.test.ts

Run the relevant tests and report exact command output.

10. Final acceptance decision
    At the end, produce a final acceptance status using one of these:

ACCEPTED:
Use this only if all required checks pass and remaining issues are documentation-only or expected warnings.

ACCEPTED_WITH_MINOR_GAPS:
Use this if scanner output is clean but metric documentation, UI wording, or non-blocking docs still need cleanup.

NOT_ACCEPTED:
Use this if any hard validation errors remain, if BookEventForm/useBookings tracing is wrong, if webhook false positives remain, or if validation_report.json regressed.

Final output must be a Markdown report.

Write the report to:
docs/calcom-final-verification-report.md

The Markdown report must use this structure:

# Cal.com Final Verification Report

## Executive Verdict

State one of:
ACCEPTED
ACCEPTED_WITH_MINOR_GAPS
NOT_ACCEPTED

Give a short reason.

## 1. Validation Artifact Summary

Include:
passed
errorCount
warningCount
passCount
entrypointTraceCoverage
whether errors[] and warnings[] are arrays
whether the report is detailed and actionable

## 2. Remaining Warnings

List every remaining warning.
For each warning, include:
file
rule
detail
whether it is expected or unexpected
whether it blocks automation

## 3. Booking Flow Trace Proof

Include proof for:
BookEventForm.tsx
useBookings.ts
public booking route trace
whether either file is misclassified
whether mutation ownership is correctly assigned

## 4. Alias Resolution Proof

Include proof that:
~/ aliases resolve
tsconfig extends are handled
monorepo discovery works
previous partial_wrong_surface warnings are gone

## 5. Webhook Evidence Proof

For each payment webhook file, include:
file
classification/domain
severity
hotSpan count
what the hotSpans point to
whether evidence is semantically useful

Also state whether old webhook false positives are gone.

## 6. Dossier Consistency Proof

Compare dossier/index.html against validation_report.json.
State whether:
validation state matches
counts match
UI warning state is correct
any stale banner remains

## 7. Delta Targets Contract Check

Confirm whether delta_targets.json:
follows ADR-019 strict machine contract
has no rich human fields
has stable required fields
has no stale false-positive targets

## 8. Action Binding Check

Confirm whether action bindings:
exist
ground useBookings.ts meaningfully
ground BookEventForm.tsx appropriately
ground payment webhooks meaningfully
show no obvious unresolved alias failures

## 9. Regression Test Proof

List:
test files inspected
test files added or updated
commands run
exact command output
whether each required behavior is regression-protected

## 10. Final Cleanup Items

List only Cal.com completion-related cleanup.
Do not include future strategy, new markets, Shadow Proxy, Delta Engine, eBPF, or new repositories.

## Final Acceptance Status

Repeat one final status:
ACCEPTED
ACCEPTED_WITH_MINOR_GAPS
NOT_ACCEPTED

Also include one sentence answering:
“Can we confidently treat the Cal.com scan as done?”

Do not discuss future markets, future products, Shadow Proxy, eBPF, or next-phase strategy.

