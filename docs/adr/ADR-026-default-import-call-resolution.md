# ADR-026 — Default Import Call Resolution

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

ADR-015 extended `extractImports` to produce `ImportBinding[]` records that include default imports (`importKind: 'default'`, `importedName: 'default'`). This correctly tracks that a file uses a default import. The gap is at the call resolution stage inside `runActionBinding`.

When `runActionBinding` encounters a call like `handler(slot, ctx)` and `handler` is a default-imported local name, it can determine:

```
handler → default import from '../lib/booking'
```

But it cannot determine:

```
handler → functionId: 'bookSlot' in '../lib/booking'
```

This is because the binding pass does not look up which symbol in the target file is the default export. The edge is recorded as a file-level resolution (`confidence: 'medium'`) instead of a function-level resolution (`confidence: 'high'`).

ADR-015 noted this gap in passing and deferred it. At large-monorepo scale, default exports are common for:

- Next.js page components (`export default function Page()`)
- Next.js API route handlers (`export default function handler()`)
- React components
- utility wrappers
- higher-order functions
- library adapters

Failing to cross these boundaries means `get_call_chain` produces truncated chains and `action_bindings.json` underreports function-level grounding for critical paths.

---

## Decision

During `runActionBinding`, when a call site target matches the local name of a default import, resolve the target to the specific exported symbol in the target file using a **local default export symbol table** built from the already-parsed AST.

### Resolution algorithm

The target file is already scanned and its export records are available from `collectExports`. The default export symbol table lookup:

1. Find all `ImportBinding` records for the current file where `importKind === 'default'` and `localName === callTargetName`.
2. Resolve `moduleSpecifier` to `resolvedFilePath` via the alias map (already done in `runResolution`).
3. In `resolvedFilePath`'s export records, find the entry where `exportedName === 'default'` or `isDefaultExport === true`.
4. That entry's `localName` is the function ID to use as the call edge target.

### Forms to support

| Target file export form | Resolution |
|---|---|
| `export default function handler() {}` | `localName = 'handler'`, resolved directly |
| `const handler = () => {}; export default handler;` | `localName = 'handler'`, resolved via the re-export binding |
| `function handler() {}; export { handler as default };` | `localName = 'handler'`, resolved via named-to-default alias |
| `export default async function () {}` | anonymous — resolve to file only, `confidence: 'medium'` |
| `export default class Foo {}` | `localName = 'Foo'`, resolved if the class has methods that match call sites |

Anonymous default function declarations (`export default function () {}`) cannot be resolved to a stable function ID without compiler-level symbol analysis. These remain file-level edges with `confidence: 'medium'`. This is honest and correct — do not invent a synthetic ID.

### Integration point

This resolution runs as a second lookup inside `runActionBinding` after the existing named-import and namespace-import resolution attempts. It does not change the import extraction step (ADR-015) or the alias resolution step (ADR-020).

### Confidence levels

| Resolution outcome | `confidence` |
|---|---|
| Resolved to exact functionId via default export symbol table | `high` |
| Resolved to file only (anonymous default export) | `medium` |
| Module specifier unresolvable (external package) | `low` |

---

## Rationale

**Why not defer and accept medium-confidence edges:**

Medium-confidence file-level edges for default imports are the status quo. The problem is that Next.js API routes — the highest-risk paths in a booking system — are almost always default-exported route handlers. Leaving these as file-level edges means `get_call_chain` cannot trace from a booking flow into the payment webhook handler when the boundary is a default import. This defeats the main value of the action binding layer for large-monorepo-scale codebases.

**Why not use TypeScript Compiler API:**

Default export symbol table lookup is syntactic, not semantic. `collectExports` already builds the necessary data from the Tree-Sitter AST. No type inference is needed to find which function in a file is the default export.

**Why not merge into ADR-015:**

ADR-015 is about import extraction (what symbols are imported). This ADR is about call resolution (what function ID does a call site target). These are distinct pipeline stages and should remain documented separately.

---

## Consequences

- `runActionBinding` gains a default-export symbol table lookup as a third resolution pass after named-import and namespace-import resolution.
- `collectExports` output must be accessible to `runActionBinding`. Pass it through the existing `WorkItem` or a shared context object.
- Unresolved call count should decrease measurably for Next.js codebases after this change.
- Anonymous default exports remain file-level edges. This is documented and expected.
- A fixture crossing a default import boundary must be added to verify `get_call_chain` traversal after this change.
