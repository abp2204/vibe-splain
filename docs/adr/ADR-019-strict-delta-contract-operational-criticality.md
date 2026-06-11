# ADR-019: Strict Delta Contract and Operational Criticality

**Status:** Accepted — Implemented

## Context
The `delta_targets.json` file has drifted into a hybrid artifact containing both machine-facing risk maps and human-facing analysis. This violates the architectural boundary between VIBE-SPLAIN as an MRI (machine-readable) and a Dossier (human-readable). Additionally, the definition of `isLoadBearing` has become overloaded with semantic risk (operational criticality), making it unreliable for structural blast-radius analysis.

## Decision
1. **Strict Contract:** `delta_targets.json` will be restricted to a five-field machine contract:
   - `path`: Relative file path.
   - `gravity`: Weighted structural importance.
   - `isLoadBearing`: Boolean, strictly defined as `fanIn >= 10`.
   - `blastRadius`: Array of relative paths (files that import this file).
   - `pillarHint`: The detected architectural pillar name.
2. **Analysis Separation:** All rich metadata (side effects, write intents, patch risk, evidence, etc.) will be stored exclusively in `analysis.json`. Delta Engine components requiring deep context should consume `analysis.json`.
3. **Operational Criticality:** A new field `isOperationallyCritical` will be added to the `analysis.json` store to capture high-stakes logic (mutations, auth, payments) independently of structural fan-in.
4. **Confidence Parity:** The machine-derived confidence score (based on fan-in and gravity) must act as a hard cap for any human-facing narratives in the Dossier. No Decision Card may claim "high" confidence if the underlying MRI data is "low" or "medium".

## Consequences
- Delta Engine's entrypoint will be simplified and more robust.
- Blast radius calculations will be purely structural, preventing "critical but isolated" files from being misidentified as load-bearing utilities.
- The Dossier will remain grounded in empirical data, preventing AI hallucinations from inflating the perceived quality of a scan.
