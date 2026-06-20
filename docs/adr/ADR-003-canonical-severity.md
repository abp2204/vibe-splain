# ADR-003 — Canonical Severity as Single Source of Truth

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

Severity was computed twice — once in `writeDeltaTargets` via `computeSeverity()`, and independently derived by dossier generation in `dossier.ts`. Because both read from the same `PersistedFile` but applied their own scoring logic, they could produce different values for the same file.

The spec requires that `useBookings.ts` is severity 5 everywhere. If `delta_targets.json` says 5 but the dossier card says 4, the validation report has no way to verify consistency, and Delta Engine gets a different signal than the human agent reading the dossier.

---

## Decision

Add `canonicalSeverity: 1|2|3|4|5` and `canonicalLoadBearing: boolean` to `PersistedFile` in `analysis.json`.

The scoring stage (stage 9, `pipeline/scoring.ts`) computes both values **once per file**, applies the correction pass (see ADR-004), and writes them back into the `PersistedFile` before any downstream consumer runs.

**Contract:**
- `delta_targets.json` generation reads `canonicalSeverity` and `canonicalLoadBearing` from `PersistedFile`. It does **not** call `computeSeverity()` or `computeLoadBearingScore()` independently.
- `dossier.ts` reads `canonicalSeverity` from `PersistedFile`. It does **not** derive severity independently.
- `validation_report.json` checks that dossier card severity and delta target severity both equal `canonicalSeverity`. Any disagreement is a hard validation error.

**Stage artifact — `stage-09-severity.json`:**
```json
{
  "severity": {
    "modules/bookings/hooks/useBookings.ts": {
      "canonicalSeverity": 5,
      "canonicalLoadBearing": true,
      "scoreBreakdown": "booking_mutation(+4) + booking_creation_domain(+3) + entrypoints>=2(+2) + gravity>=85(+2) = 11 → 5"
    }
  }
}
```

The `scoreBreakdown` field is for debugging only — it shows the additive contributions so a future developer can understand why a file landed at a given severity without reading the scoring code.

---

## Rationale

- `analysis.json` is already the shared intermediate artifact consumed by both downstream generators. Adding two fields is the minimal, correct change.
- Option B (making dossier read from `delta_targets.json`) was rejected because it creates a hard ordering dependency and makes dossier generation depend on a file format it has no other reason to know about.
- Severity is a **fact about a file**, not a presentation detail. It belongs in the file metadata, not recomputed per consumer.

---

## Consequences

- `computeSeverity` and `computeLoadBearingScore` in `analysis.ts` move to `pipeline/scoring.ts`. They are no longer called from `writeDeltaTargets`.
- `dossier.ts` must be updated to read `canonicalSeverity` from the passed `PersistedFile`. Remove any independent severity derivation.
- If `canonicalSeverity` is missing from a `PersistedFile` (e.g. running against an old `analysis.json`), the validation report should emit a warning and default to recomputing — but this path should not occur in normal operation.
