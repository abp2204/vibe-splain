# ADR-024: Tiered Agent Markdown & Recommendation Policy

## Status
Accepted

## Context
LLM-facing documentation (`dossier.agent.md`) needs to be token-efficient for large projects while providing actionable advice. Currently, advice is often invented at the point of presentation or mixed into the scanner results.

## Decision
We will decouple architectural advice from rendering and implement a tiered priority model for Markdown exports.

1. **Recommendation Policy Engine**:
    - A shared layer (likely in `packages/brain/src/policy/`) that maps raw analysis facts (risk types, gravity, LOC) into structured recommendations.
    - Example: `mutation_orchestration` + `large_loc` -> "Extract pure decision logic first."
    - This ensures all export formats (HTML, PDF, MD) provide identical advice.

2. **Tiered Markdown Export**:
    - The `AgentMarkdownRenderer` will consume a prioritized list from the Orchestrator.
    - **Tier 1 (Critical)**: Full detail, evidence snippets, safe patch strategies, test probes.
    - **Tier 2 (Important)**: Summaries, risk types, and abbreviated evidence.
    - **Tier 3 (Context)**: Index-only (path, gravity, severity) to maintain global awareness without token bloat.

3. **Prioritization Logic**:
    - Ranking is determined by a weighted score of `canonicalSeverity`, `gravity`, `isLoadBearing`, `writeIntents`, and `blastRadius`.
    - User flags (`--budget compact|standard|full`) control the expansion depth of these tiers.

## Consequences
- Agents receive high-signal context without exceeding context windows.
- Architectural "wisdom" is centralized and testable.
- Consistency between human-readable reports and agent-readable instructions.
