# ADR-005 — Validation Report: Write All Artifacts, Surface Failures in Payload

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The spec required generating `validation_report.json` with pass/warning/error counts and "failing the run" on certain conditions. The question was what "fail the run" means for an MCP tool with downstream consumers.

Three options were evaluated:

- **Option A:** Reject the MCP call with a tool error. No outputs written. Hard fail.
- **Option B:** Write all outputs. MCP returns success at transport level. Validation status rides in the response payload.
- **Option C:** Write all outputs. Return a tool error if `errorCount > 0` (so agent error handlers fire), but keep files on disk.

---

## Decision

**Option B.** The scan completed successfully — all outputs are written. The MCP response always returns `ok: true` at the transport level unless the scan itself crashed. Validation status is explicit in the response payload.

**MCP response shape:**
```json
{
  "ok": true,
  "validation": {
    "passed": false,
    "errors": 2,
    "warnings": 1,
    "reportPath": ".vibesplain/validation_report.json"
  },
  "artifacts": {
    "analysis": ".vibesplain/analysis.json",
    "deltaTargets": ".vibesplain/delta_targets.json",
    "dossier": ".vibesplain/dossier.json",
    "graph": ".vibesplain/graph.json",
    "html": ".vibesplain/ui/index.html"
  }
}
```

**`validation_report.json` shape:**
```ts
interface ValidationReport {
  timestamp: string;
  passed: boolean;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
  summary: { errorCount: number; warningCount: number; passCount: number };
}

interface ValidationFinding {
  file: string;
  rule: string;
  detail: string;
  expected?: string;
  actual?: string;
}
```

**Hard error rules** (set `passed: false`):
1. `severity === 5 && !isLoadBearing` — post-correction invariant violation
2. `writeIntents.includes('handle_payment_webhook') && sideEffectProfile.includes('none_detected')`
3. `productDomain === 'booking_creation' && entrypointTraceStatus === 'no_runtime_entrypoint_found' && blockedImports.length === 0`
4. Dossier card severity ≠ `canonicalSeverity` for the same file
5. Delta target severity ≠ `canonicalSeverity` for the same file
6. `severity >= 4 && rawEvidence.length === 0`

**Warning rules:**
1. `severity >= 4 && runtimeEntrypoints.length === 0`
2. `entrypointTraceStatus === 'partial_wrong_surface'`

**Tool error** (MCP returns error response) is reserved for scan failures only:
- Unreadable repo / file system errors
- Parser crash
- JSON write failure
- Invalid internal state (e.g. scoring stage returned null)

**Future:** A `strictValidation` CLI flag can turn validation errors into a non-zero exit code for CI pipelines. Default MCP behavior stays Option B.

---

## Rationale

- Option A was rejected because you need the outputs to diagnose what went wrong. A hard fail on "payment webhook classified wrong" gives you an error with no context. Option B gives you `delta_targets.json` on disk, `validation_report.json` with exact failure reasons, and the agent can decide whether to proceed or escalate.
- Option C was rejected because tool errors should mean "the tool broke," not "the data is questionable." Mixing these signals confuses agent error handlers.
- Bad architecture findings are not tool failures. They are findings inside a successful scan.

---

## Consequences

- The `scan_project` MCP tool handler must be updated to include the `validation` and `artifacts` fields in its response text/payload.
- `validation_report.json` is a permanent output artifact, not a stage-only intermediate. It should be listed alongside `delta_targets.json` as a consumer-facing file.
- The validation pass runs after both delta target generation and dossier generation (stage 12) so it can cross-check severity consistency between the two.
