# ADR-017 — criticalFunctions Enrichment of delta_targets.json

**Status:** Accepted — Pending Implementation  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

`delta_targets.json` is the machine-readable payload for the Delta Engine. It is written by `runScoring` alongside `analysis.json` and provides ranked, file-level targets with risk profiles, observable outputs, write intents, patch risk assessments, and raw evidence from `hotSpans`.

The current evidence field is:

```ts
rawEvidence: RawEvidence[]   // top hotSpans — complex function bodies
displayEvidence: DisplayEvidence[]
```

`hotSpans` are the top 3 most complex function bodies by cyclomatic + LOC score. They are valid "here is gnarly code" evidence. They are not "here is the function responsible for the load-bearing behavior" evidence.

After `runActionBinding` runs, `runScoring` has access to function-level binding data. The question is how much of it belongs in `delta_targets.json`.

**The boundary that must be respected:**

- `delta_targets.json` answers: "Why is this file important, and which functions inside it carry the important behavior?"
- `get_call_chain` answers: "How is this behavior reached from a specific entrypoint?"

These are related but different questions. `delta_targets.json` is **file-local**. It should not make claims about execution paths from external entrypoints — those claims require a traversal that depends on the query's starting point.

**The wrong claim to put in delta_targets.json:**  
"Function `createBooking` is on the critical path from POST /api/bookings."  
This is a path-level claim that requires a specific entrypoint traversal. It only belongs in `get_call_chain` output, not in the file's static profile.

**The right claim to put in delta_targets.json:**  
"Function `createBooking` at lines 47–110 performs `database_write` on `Booking.create` and calls 8 outbound symbols, 5 of which are resolved."  
This is a file-local claim about a function's behavior and connectivity, derivable without any specific entrypoint context.

---

## Decision

Add an optional, non-breaking field to `DeltaTarget`:

```ts
interface DeltaTarget {
  // ... all existing fields unchanged ...
  criticalFunctions?: FunctionActionSummary[];  // NEW — optional, populated when action_bindings.json exists
}
```

### FunctionActionSummary Schema

```ts
interface FunctionActionSummary {
  functionId: string;
  displayName: string;
  functionKind: FunctionKind;
  startLine: number;
  endLine: number;
  isEntrypoint: boolean;
  isExported: boolean;
  actionKinds: SemanticActionKind[];     // unique action kinds present in this function
  targetModels: string[];                // unique model names touched
  targetOperations: string[];            // unique operations performed
  outboundCallCount: number;             // total CallRecords in this function
  resolvedOutboundCallCount: number;     // calls with high or medium confidence resolution
  semanticActionCount: number;           // total SemanticActionRecords in this function
  evidence: FunctionEvidenceItem[];      // one item per semantic action, max 5
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];                     // human-readable selection rationale
}

interface FunctionEvidenceItem {
  sourceLine: number;
  text: string;                          // call expression or action text, max 200 chars
  actionKind: SemanticActionKind;
  targetModel: string | null;
  targetOperation: string | null;
  confidence: 'high' | 'medium' | 'low';
}
```

### Selection Heuristic for criticalFunctions

`runScoring` selects the top **3–5 functions** per `DeltaTarget` by applying the following criteria, in priority order:

1. **Functions with semantic actions** — any function containing at least one `SemanticActionRecord`. These are functions that perform observable effects.
2. **Entrypoint functions** — `isEntrypoint: true`. The route handler itself is always worth surfacing.
3. **High resolved outbound call count** — functions that are well-connected in the call graph (many resolved outbound calls) are more load-bearing than isolated utility functions.
4. **Model write operations** — functions writing `database_write` or `booking_mutation` actions are prioritized over read-only functions.
5. **Auth and validation** — `auth_check` and `validation` actions are always surfaced because they represent behavioral boundaries.
6. **Functions already in hotSpans** — if a function is already a hotSpan (high complexity), and it also has semantic actions, include it to cross-reference the two signals.

Cap at 5 functions per `DeltaTarget`. For files with many functions, the selection heuristic must be O(n) in the number of functions — no quadratic sorting or nested scans.

### Confidence Propagation

The `confidence` field on `FunctionActionSummary` reflects the confidence of the underlying binding data:

- `high`: all semantic actions in this function have `confidence: 'high'`
- `medium`: at least one semantic action has `confidence: 'medium'`, none are `'low'`
- `low`: at least one semantic action has `confidence: 'low'`

This propagation is intentional: the summary's confidence is bounded by its weakest evidence.

### Example Output

```json
{
  "path": "apps/web/pages/api/bookings/create.ts",
  "frameworkRole": "pages_api_route",
  "productDomain": "booking_creation",
  "gravity": 91,
  "criticalFunctions": [
    {
      "functionId": "apps/web/pages/api/bookings/create.ts::createBooking::47:0",
      "displayName": "createBooking",
      "functionKind": "function_declaration",
      "startLine": 47,
      "endLine": 110,
      "isEntrypoint": false,
      "isExported": true,
      "actionKinds": ["validation", "auth_check", "database_write", "email_send"],
      "targetModels": ["Booking"],
      "targetOperations": ["create"],
      "outboundCallCount": 8,
      "resolvedOutboundCallCount": 5,
      "semanticActionCount": 4,
      "evidence": [
        {
          "sourceLine": 72,
          "text": "prisma.booking.create({ data: bookingData })",
          "actionKind": "database_write",
          "targetModel": "Booking",
          "targetOperation": "create",
          "confidence": "high"
        },
        {
          "sourceLine": 51,
          "text": "validateBookingInput(req.body)",
          "actionKind": "validation",
          "targetModel": null,
          "targetOperation": null,
          "confidence": "high"
        }
      ],
      "confidence": "high",
      "reasons": [
        "writes Booking model",
        "performs validation and auth checks",
        "5 of 8 outbound calls resolved"
      ]
    }
  ]
}
```

---

## Rationale

**Why add this now instead of deferring until `get_call_chain` is mature:**

The Delta Engine consumes `delta_targets.json` to decide which files to instrument and what behavior to watch. Right now it knows "this file writes to the database" — which is correct but imprecise. Knowing "this file writes to the database in `createBooking` at line 72, which also performs validation at line 51" gives the Delta Engine a more precise instrumentation target. This improves the quality of the Delta Engine output independently of `get_call_chain`.

**Why cap at 3–5 functions:**

`delta_targets.json` is consumed by the Delta Engine in bulk across many files. A file with 20 `FunctionActionSummary` entries produces a noisy, hard-to-prioritize target. The cap forces the selection heuristic to surface only the most load-bearing functions, matching the Delta Engine's primary use case: "what are the most important things to watch in this file?"

**Why not replace hotSpans with criticalFunctions:**

`hotSpans` identifies complexity concentrations, which is a different signal from behavioral importance. A simple 5-line `prisma.booking.create()` wrapper has low hotSpan score but high behavioral importance. A 60-line configuration parser has high hotSpan score but low behavioral importance. Both signals are valuable. Replacing one with the other loses information. The two fields are complementary.

**Why `criticalFunctions` is optional:**

If `action_bindings.json` does not exist (e.g., `runActionBinding` failed or is not yet implemented), `runScoring` omits the field rather than failing. This allows incremental rollout without breaking the Delta Engine on the first deployment.

---

## Consequences

- `packages/brain/src/analysis.ts` gains `FunctionActionSummary` type and `criticalFunctions` field on `DeltaTarget`.
- `packages/brain/src/pipeline/scoring.ts` must read from `action_bindings.json` to populate `criticalFunctions`. It should read the artifact at the start of `runScoring` and gracefully skip if the file does not exist.
- `runScoring` does NOT reimplement the traversal logic from `runActionBinding`. It only reads the already-extracted `FunctionRecord` and `SemanticActionRecord` data and applies the selection heuristic.
- The existing `rawEvidence` and `displayEvidence` fields on `DeltaTarget` are unchanged.
- The Delta Engine receives a richer payload with no breaking schema changes.
- No new MCP tools are required for this ADR — the enrichment is transparent to MCP callers, who already receive `delta_targets.json` as part of `scan_project` output.
