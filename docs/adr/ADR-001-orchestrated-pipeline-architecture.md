# ADR-001 — Orchestrated 12-Stage Pipeline Architecture

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The previous scanner (`scanner.ts`) was a single monolithic `scanProject` function (~400 lines) that parsed, classified, scored, and wrote all outputs in one pass with no intermediate checkpoints. Classification mistakes in Pass 1 (wrong domain, missed side-effect) propagated silently into `writeDeltaTargets` with no correction opportunity. The five known failure cases shared this root cause.

Additionally, there was no way to debug a bad classification after the fact — re-running the full scan was the only option, and there was no artifact showing which stage produced the bad value.

---

## Decision

Replace the monolithic scanner with a deterministic 12-stage orchestration pipeline grouped into four files under `packages/brain/src/pipeline/`.

**Stages:**
1. File inventory
2. Framework role classification
3. Product domain classification
4. Import and alias resolution
5. Side effect profiling
6. Write intent detection
7. Risk type inference
8. Load-bearing scoring + entrypoint tracing
9. Canonical severity scoring + correction pass
10. Delta target generation
11. Human dossier generation
12. Validation report generation

**Module grouping:**
```
packages/brain/src/pipeline/
  inventory.ts      — stages 1–3
  resolution.ts     — stage 4
  classification.ts — stages 5–8
  scoring.ts        — stages 9–12
  orchestrator.ts   — sequences all stages, returns ScanResult
```

`scanner.ts` becomes a thin compatibility shim that calls `orchestrator.run()`. The public `scanProject` API is unchanged for MCP callers.

Each stage writes an intermediate JSON artifact to `.vibesplain/` (e.g. `stage-01-inventory.json`). Artifacts are **overwritten on every run** — they are debugging checkpoints, not persistent history.

---

## Rationale

- **Debuggability:** When Components.tsx is classified with severity 2, you can open `stage-03-domains.json` and see the domain was wrong, or `stage-07-risk-types.json` to see `registry_bottleneck` was not emitted. Without staged artifacts, you re-run a 400-line function and guess.
- **Correction opportunity:** Stage 9 can apply invariant corrections (e.g. force `payment_mutation` if `handle_payment_webhook` is in writeIntents) after all classification is complete. This is impossible in a single pass.
- **Testability:** Each grouped file exposes named stage functions that can be tested independently without running the full scan.
- **Separation of concerns:** Classification stages discover facts. Scoring stages compute values from facts. They cannot be interleaved without creating ordering dependencies.

**Why overwrite artifacts on every run (not persist between runs)?**  
Stale artifacts from a previous run create confusion when debugging the current run. If you're investigating why a file got severity 3, you need the artifact from the run that produced that output. Keeping artifacts permanent adds no value unless you're diffing runs, which is not a current requirement.

**Why 4 files instead of 12?**  
A 12-file explosion creates navigation overhead without benefit. The 4-file grouping maps to natural stage boundaries (collection, resolution, classification, scoring) and keeps each file under ~200 lines. Named stage functions inside each file allow future splitting if a stage grows too large.

---

## Consequences

- `scanner.ts` must be kept as a shim — do not move MCP callers to import from `orchestrator.ts` directly.
- The `brain` package rule holds: MCP/CLI concerns must never bleed into pipeline files. The orchestrator returns a `ScanResult`; the MCP layer formats it.
- `packages/brain/src/analysis.ts` and `packages/brain/src/signals.ts` remain the shared type definitions consumed by all pipeline stages.
