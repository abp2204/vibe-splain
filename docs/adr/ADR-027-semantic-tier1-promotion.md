# ADR-027 — Semantic Tier 1 Promotion in Agent Markdown

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

ADR-024 specifies that Tier 1 promotion in `dossier.agent.md` uses a weighted score of `canonicalSeverity`, `gravity`, `isLoadBearing`, `writeIntents`, and `blastRadius`. The current implementation in `AgentMarkdownRenderer.ts` deviates from this:

```ts
const isCritical = card && card.severity >= 4;
if (f.gravity >= 70 || isCritical) {
  tier1.push(f.relativePath);
}
```

Promotion criteria in the implementation:
- `gravity >= 70` — structural centrality threshold
- `card.severity >= 4` — a decision card with high severity (requires human intervention)

Signals from ADR-024 that are not used:
- `writeIntents` — semantic behavioral classification
- `isLoadBearing` — structural fanIn threshold
- `isOperationallyCritical` — ADR-019 field, already computed on `PersistedFile`
- `sideEffectProfile` — runtime risk signals

**The practical impact:**

On a first scan with no decision cards, only files with gravity >= 70 reach Tier 1. In a small codebase or a tightly-scoped fixture, this threshold may exclude files with high behavioral risk — payment webhook handlers, auth token issuers, booking mutation orchestrators — that have low gravity because few files import them directly. These files have semantic actions in `action_bindings.json` but their Critical Functions block never appears in `dossier.agent.md`.

This is not a card gating issue. Decision cards do not gate Critical Functions. The issue is that the Tier 1 gate excludes files by gravity alone on a first scan.

---

## Decision

Extend Tier 1 promotion in `AgentMarkdownRenderer` to include semantic signals from `PersistedFile`. A file is promoted to Tier 1 if any of the following are true:

```
gravity >= 70
OR (card exists AND card.severity >= 4)
OR isOperationallyCritical === true
OR writeIntents intersects { handle_payment_webhook, issue_auth_token, refresh_auth_token, create_payment }
OR (sideEffectProfile includes webhook_ingress AND sideEffectProfile includes payment_mutation)
```

The threshold logic remains in `AgentMarkdownRenderer`. It reads the signals from `PersistedFile`, which are already computed by the pipeline before rendering.

### Why these signals

`isOperationallyCritical` is an ADR-019 field computed during scoring. It is the pipeline's own assessment that a file has runtime criticality beyond structural gravity. If the pipeline flags it, the renderer should surface it.

The payment and auth `writeIntents` are the highest-risk mutation classes in a booking system. A file that issues auth tokens or handles payment webhooks is critical regardless of how many files import it.

`webhook_ingress + payment_mutation` in the side effect profile is behavioral evidence of the same class. A file that ingests a webhook payload and writes a payment record is operationally critical by definition.

### What this does not change

- Decision cards are enrichment only. They add narrative, recommendations, and severity framing. They are not required for Tier 1 promotion.
- Critical Functions rendering (line 67 in `AgentMarkdownRenderer`) remains gated on `this.bindings && this.bindings.files[path]`. This is correct — the condition is whether bindings exist, not whether a card exists.
- Tier 2 and Tier 3 thresholds are unchanged.
- The gravity threshold of 70 is retained. It is not lowered — semantic signals are additive, not substitutive.

### Budget behavior

Tier 1 expansion may increase token count on first scans of high-risk codebases. The `--budget` flag (ADR-024) still controls expansion depth within each tier. The Tier 1 list may be longer; the detail per file is controlled by budget.

---

## Rationale

**Why not lower the gravity threshold instead:**

Gravity is a structural signal — pagerank-weighted centrality times fan-in and complexity factors. Lowering the threshold would promote structurally complex files regardless of behavioral risk. A deeply nested utility module with high cyclomatic complexity would reach Tier 1 ahead of a simple-looking but operationally critical route handler. Semantic promotion is more precise.

**Why not add a separate Critical Functions Index section:**

A separate index is the fallback option if semantic promotion proves too aggressive (too many files in Tier 1 on large codebases). The preferred approach is correcting Tier 1 membership because it also ensures other Tier 1 benefits (recommendations, safe patch strategies, narrative from cards if they exist) apply to these files. An index section would surface function names only, not the full Tier 1 treatment.

If a large-repo scan shows Tier 1 growing to more than 30 files with semantic promotion enabled, revisit the threshold or implement the index as a fallback.

**Why isOperationallyCritical is the cleanest signal:**

ADR-019 already computes `isOperationallyCritical` as a pipeline stage output. It aggregates multiple signals. Promoting any `isOperationallyCritical === true` file to Tier 1 directly delegates the criticality judgment to the scoring pipeline rather than re-implementing it in the renderer.

---

## Consequences

- `AgentMarkdownRenderer.ts` promotion logic is extended with four additional conditions.
- No changes to pipeline stages, artifact schemas, or other renderers.
- First scans of Next.js booking codebases will surface Critical Functions for payment webhook handlers, auth routes, and booking mutation orchestrators without requiring any decision cards.
- A post-scan on a large repo: measure Tier 1 file count with and without semantic promotion to calibrate whether any thresholds need adjustment.
