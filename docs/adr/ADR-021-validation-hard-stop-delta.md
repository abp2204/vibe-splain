# ADR-021: Validation Hard Stop for Delta

**Status:** Accepted — Implemented

## Context
Currently, VIBE-SPLAIN generates artifacts even when internal validation rules fail (e.g., severity/load-bearing inconsistencies, missing evidence for high-severity files). While useful for debugging, a failed validation report indicates the MRI is unreliable for autonomous decision-making.

## Decision
1. **Hard Stop Protocol:** Delta Engine must treat `validation_report.passed: false` as a terminal failure. It should refuse to route patches or perform autonomous migrations based on an invalid scan.
2. **Invariant Enforcement:** Post-correction invariants (e.g., "Severity 5 must be load-bearing") will be strictly enforced before artifact serialization.
3. **Explicit Quality Warnings:** The CLI and UI must display prominent warnings when validation fails, highlighting the specific rules violated.

## Consequences
- Prevents "butterfly effect" regressions caused by acting on inaccurate structural maps.
- Forces developers/agents to fix classification or resolution issues before proceeding with high-stakes automation.
- Improves the overall trustworthiness of the Delta Engine ecosystem.
