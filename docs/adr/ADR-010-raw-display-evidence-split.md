# ADR-010 — `rawEvidence`/`displayEvidence` Split

**Status:** Proposed
**Date:** 2026-06-11
**Deciders:** Aayush Patel

---

## Context

`DeltaTarget.rawEvidence` stores snippets built in `pipeline/inventory.ts` from Tree-Sitter AST node line ranges. The snippet is computed as:

```ts
const raw = source.split('\n').slice(s.node.startPosition.row, s.node.endPosition.row + 1).join('\n');
const snippet = stripLeadingComments(raw).slice(0, 2000);
```

The evidence hash is computed from `snippet`. This means `rawSourceExcerpt` is **not byte-faithful**: it does not match the actual bytes in the source file at the stated line range. `stripLeadingComments()` removes leading comments; `.slice(0, 2000)` truncates.

Delta Engine needs evidence hashes to answer: did this patch target move between scans? did this source span change? can this hash still anchor the same risk? A hash computed from comment-stripped, truncated content cannot reliably answer any of these questions.

At the same time, the human dossier legitimately benefits from stripped/truncated snippets — they are more readable. These are different use cases and should not share a field.

---

## Decision

Split into two fields on `DeltaTarget`:

```ts
interface RawEvidence {
  file: string;
  startLine: number;
  endLine: number;
  rawSourceExcerpt: string;  // exact source bytes from line range, no transforms
  evidenceHash: string;       // sha256(rawSourceExcerpt).slice(0, 12)
}

interface DisplayEvidence {
  file: string;
  startLine: number;
  endLine: number;
  excerpt: string;           // stripLeadingComments + .slice(0, 2000)
  isTruncated: boolean;      // true when original exceeded 2000 chars
}
```

**`rawEvidence.rawSourceExcerpt`** = `source.split('\n').slice(startRow, endRow + 1).join('\n')` — no `stripLeadingComments`, no character limit, no transforms of any kind. Line-ending normalization (`\r\n` → `\n`) is the only permitted change, and it must be documented.

**`evidenceHash`** = sha256 of `rawSourceExcerpt` (not the display version). Computed after raw extraction, before any display processing.

**`displayEvidence.excerpt`** = current behavior: `stripLeadingComments(raw).slice(0, 2000)`. `isTruncated` is true when `raw` after comment-stripping exceeded 2000 characters.

**Consumer routing:**
- `delta_targets.json` includes both `rawEvidence` and `displayEvidence`.
- The dossier UI (`dossier.ts`, rendered HTML) uses `displayEvidence` when rendering evidence snippets to the user.
- Delta Engine consumes `rawEvidence` only.

**Validation report — hard errors:**
- If any `rawEvidence` item's `rawSourceExcerpt` contains summary artifacts (`{ .`, `// more lines below`, `...elided`, `/* ... */` when not present in source) → hard error.
- If a file has `canonicalSeverity >= 4`, `hotSpans.length > 0`, and `rawEvidence.length === 0` → hard error (existing rule, now applies to the `rawEvidence` field specifically).

---

## Rationale

Two audiences, two contracts. Humans reading the dossier want readable snippets — leading comments and long function preambles add noise. Machines anchoring patches need the exact bytes that were present at scan time, so they can detect drift between scans. One field cannot serve both without compromising one of them.

The existing `rawEvidence` field name implied byte-fidelity but did not deliver it. Keeping `rawEvidence` as the byte-faithful field (fixing its content) and adding `displayEvidence` (preserving the current human-readable behavior) is the minimal schema change that resolves the contract without breaking existing field names.

---

## Consequences

- `DeltaTarget` in `analysis.ts` gains `displayEvidence: DisplayEvidence[]`. The existing `rawEvidence` field is kept but its content semantics change: `rawSourceExcerpt` is now truly raw.
- `buildRawEvidence` in `scoring.ts` must not call `stripLeadingComments`. Remove that call and remove the `.slice(0, 2000)` cap from the raw path.
- A new `buildDisplayEvidence` function takes the same hotSpan data and applies the current comment-stripping and truncation logic.
- `dossier.ts` evidence rendering must switch from `rawEvidence` to `displayEvidence`.
- Artifact size increases slightly: raw excerpts for large functions are longer than their comment-stripped equivalents.
- Delta Engine consumers reading `rawEvidence.rawSourceExcerpt` get a stable anchor. They must not consume `displayEvidence` for hash comparison or patch anchoring.
