# ADR-012 — Freeze Static Analysis Scope at VIBE SPLAIN v0.4

**Status:** Accepted — Implemented
**Date:** 2026-06-11
**Deciders:** Aayush Patel

---

## Context

VIBE SPLAIN is a static analysis tool whose purpose is to produce a trustworthy map for Delta Engine to consume. It is not the end product. The end product is runtime proof: shadow traffic, write sink verification, and safe modernization of the target codebase.

Without an explicit scope boundary, static analysis work expands indefinitely. Each gap found in the static output creates pressure to add more detection logic, more risk types, more scoring rules. The local optimum trap is: a perfect static map is achievable in theory, and every incremental improvement feels justified, while the actual product risk — runtime proof — is never reached.

The v0.4 work addresses five critical target families: booking orchestration, payment webhooks, form registry, form registry consumer, and data table state machines. These represent the core correctness requirements for the static map. Once these five families score correctly and the validation report passes its known fixture checks, VIBE SPLAIN has produced a trustworthy enough static map to begin shadow testing.

---

## Decision

Freeze the static analysis scope at v0.4.

**Scope boundary rule:** After v0.4 ships, new static analysis work (new risk types, new product domains, new scoring rules, new detection heuristics) is only accepted when it is directly required by one of:

1. The proxy/traffic shadow pipeline
2. Write sink identification or verification
3. Runtime comparison of shadow vs live behavior
4. An explicit Delta Engine schema request

Work that cannot be traced to one of these four requirements is deferred to v0.5. The deferral is a deliberate gate, not a queue — deferred work may never be needed.

**v0.4 is complete when all of the following pass in `validation_report.json`:**

1. `useBookings.ts` → severity 5, `isLoadBearing: true`, `productDomain: 'booking_creation'`, `sideEffectProfile` includes `booking_mutation`, no `entrypointTraceStatus: 'complete'` unless a booking or reschedule surface is found
2. Payment webhook files → `productDomain: 'payments_webhooks'`, `sideEffectProfile` includes `webhook_ingress` and `payment_mutation`, `writeIntents` includes `handle_payment_webhook`, severity ≥ 4, `isLoadBearing: true`
3. `Components.tsx` (form-builder) → `riskTypes` includes `registry_bottleneck`, severity ≥ 4, `isLoadBearing: true`, `patchRisk.level: 'high'`
4. `FormBuilderField.tsx` → `riskTypes` includes `registry_consumer`, severity ≥ 3, `patchRisk.level` at least `'medium'`
5. `DataTableSegmentContext.tsx` → `productDomain: 'data_table'`, `riskTypes` includes `state_machine`, `patchRisk.level` at least `'medium'`
6. Alias resolution reports exact unresolved imports with reason strings for all files with gravity ≥ 40
7. `rawEvidence.rawSourceExcerpt` is byte-faithful (no `stripLeadingComments`, no truncation)
8. `validation_report.json` is emitted on every scan
9. Validation report passes all hard error rules defined in ADRs 003, 005, 008, and 011
10. Dossier UI uses `displayEvidence`; `delta_targets.json` uses `rawEvidence` for machine-readable evidence

---

## Rationale

The static map exists to enable runtime proof. VIBE SPLAIN's role is to identify where the risk is — not to achieve perfect static understanding of the entire codebase. Once the five target families are correctly classified, the map is trustworthy enough to begin shadow testing against real traffic.

Continued expansion of static analysis past this point delays the actual modernization claim while producing diminishing returns. The next major risk is runtime behavior: does the shadow match live? do writes apply idempotently? are the critical surfaces reachable through the proxy? These questions cannot be answered by static analysis alone.

The scope boundary rule is explicit so future contributors have a decision criterion. "Should we add detection for X?" → "Does the proxy/shadow pipeline require it?" If not, defer.

---

## Consequences

- After v0.4 ships, issues filed against VIBE SPLAIN's static analysis must reference a specific proxy or runtime requirement. Issues without that reference are labeled v0.5 and parked.
- v0.5 static work is driven by gaps the proxy reveals, not by gaps found in the static report.
- The boundary between VIBE SPLAIN (static MRI) and Delta Engine (runtime surgeon) becomes explicit: v0.4 is the handoff point.
- Some static analysis gaps will remain after v0.4. This is intentional. A gap that doesn't affect runtime shadow safety is not a blocker.
- CONTEXT.md and CLAUDE.md should be updated at v0.4 ship to reflect that new static analysis features require proxy justification.
