# ADR-015 — Named Import Extraction in Pass 1

**Status:** Accepted — Pending Implementation  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The current `extractImports` function in `packages/brain/src/pipeline/inventory.ts` extracts only **module specifiers** — the raw string after `from` in an import statement. For example:

```ts
import { checkAvailability, validateInput } from '@/lib/booking';
```

This produces: `['@/lib/booking']`

It does not track:
- Which named symbols are imported from that module
- Whether imports are named, default, namespace, or type-only
- The local alias if the import was renamed (`import { foo as bar }`)
- The source line of the import

This is sufficient for the existing file-to-file import graph (we only need to know that this file depends on `@/lib/booking`), but it is insufficient for function-level call resolution.

**The cross-file resolution gap:**

When `runActionBinding` encounters `checkAvailability(...)` inside function `createBooking`, it needs to know whether `checkAvailability` is a locally-defined function or an imported symbol, and if imported, from which file. Without named import extraction, the only option is:

1. Check if `checkAvailability` is defined as a function in the same file (can be done without named imports)
2. Scan all import module specifiers, resolve each to a file, and hope the target file exports something named `checkAvailability`

Step 2 is a guess, not a binding. It would produce `confidence: 'medium'` edges on cross-file calls even when the answer is unambiguous. This defeats the purpose of action binding, which is to reduce guessing.

**The namespace import problem:**

For `import * as availability from '@/lib/availability'`, a call like `availability.check(...)` can only be resolved to a file — not to a specific exported symbol — without knowing that `availability` is a namespace import from `@/lib/availability`. Without tracking this, `availability.check` is treated as an unknown local object access.

**Why this is not TypeScript Compiler API work:**

Named import extraction from import statements is syntactic, not semantic. Tree-Sitter's grammar for TypeScript and JavaScript represents import statements structurally: `import_statement` → `import_clause` → `named_imports` → `import_specifier`. Extracting named specifiers is a straightforward AST walk, the same as what `collectExports` does for export statements. No type inference is required.

---

## Decision

Extend `extractImports` (or replace it with `extractNamedImports`) to return `ImportBinding[]` instead of `string[]`.

The extraction must handle:

| Import form | `localName` | `importedName` | `importKind` |
|---|---|---|---|
| `import { foo } from '...'` | `foo` | `foo` | `named` |
| `import { foo as bar } from '...'` | `bar` | `foo` | `named` |
| `import defaultFoo from '...'` | `defaultFoo` | `default` | `default` |
| `import * as ns from '...'` | `ns` | `*` | `namespace` |
| `import type { Foo } from '...'` | `Foo` | `Foo` | `named`, `isTypeOnly: true` |
| `import '...'` | `''` | `''` | `side_effect` |
| `const x = require('...')` | `x` (if detectable) | `default` | `default` |
| `const { foo } = require('...')` | `foo` | `foo` | `named` |

**Type-only imports** (`import type { ... }`) must be flagged with `isTypeOnly: true`. They do not produce call resolution targets — you cannot call a type at runtime. This distinction is important so that `runActionBinding` does not attempt to resolve function calls to type import targets.

**Resolution of `resolvedFilePath`:**

Named import extraction runs **after** `runResolution`, which has already built the alias map and resolved module specifiers to file paths. `runActionBinding` can therefore look up each `ImportBinding.moduleSpecifier` in the already-resolved import graph to populate `resolvedFilePath` without re-running alias resolution.

The resolution lookup is:
```
importsResolved.get(filePath) → Set<resolvedFilePath>
```

This gives the set of resolved files for a given source file. To attach the correct `resolvedFilePath` to a named import, match the `moduleSpecifier` through the alias map using `resolveImportWithAliasMap` (already implemented in `resolution.ts`). Pass the alias map through to `runActionBinding`.

**Backward compatibility:**

The existing `importSpecs: string[]` field on `WorkItem` is used by `inferProductDomain` and `matchPillarByImports` in the inventory and classification stages. These callers need only module specifiers, not named symbols. The `WorkItem` type can retain `importSpecs: string[]` for those callers while `runActionBinding` extracts `ImportBinding[]` from the same AST. Do not break the existing classification pipeline by changing `WorkItem.importSpecs`.

---

## Rationale

**Why not defer named imports and ship medium-confidence cross-file edges first:**

Medium-confidence cross-file edges would mean: "function A probably calls something in file B, but we're not sure what." This is only marginally better than the existing file-level signals. The agent would see a chain like "→ checkAvailability (medium confidence, target file: lib/booking.ts)" — which is a guess encoded in a new artifact format. The whole premise of action binding is to reduce guessing. Shipping the system with systematic medium-confidence cross-file edges from day one trains the agent to distrust the output, which is worse than the current state.

Named import extraction is one AST walk over the same source that is already parsed in `runInventory`. It adds negligible cost to the scan. There is no reason to defer it.

**Why named imports and not full symbol table analysis:**

A full symbol table would require TypeScript Compiler API (type-aware analysis) to handle: barrel re-exports, re-export chains, overloads, generic types, conditional types. That is correct for Stage 2 precision. Named import extraction from the syntactic AST handles 80–90% of real call sites in a Next.js/TypeScript codebase: direct named imports, default imports, namespace imports, aliased imports. The remaining 10–20% (barrel re-exports, dynamic `require`) produce `confidence: 'medium'` or `confidence: 'low'` edges, which is honest and correct.

**Why type-only imports must be excluded from call resolution:**

`import type { BookingInput }` imports a TypeScript type that is erased at runtime. It is never callable. If `runActionBinding` attempts to resolve `BookingInput(...)` as a call to a function in the source file of `BookingInput`, it will find no function and produce a false negative, or worse, find a coincidental function with the same name and produce a false positive. Filtering by `isTypeOnly` prevents this class of error.

---

## Consequences

- `packages/brain/src/pipeline/inventory.ts` gains a new export `extractNamedImports(source: string, lang: Language, tree: Parser.Tree): ImportBinding[]` that uses the Tree-Sitter AST directly rather than regex.
- The existing `extractImports` (regex-based) is retained for backward compatibility with `inferProductDomain` and pillar matching, which only need module specifiers.
- `WorkItem` gains an optional field `namedImports?: ImportBinding[]` populated during inventory if the AST is available, or populated during `runActionBinding` from a second pass.
- `runActionBinding` takes the `aliasMap` from `ResolutionResult` to resolve `ImportBinding.resolvedFilePath` without re-running alias resolution.
- Python, Go, Rust, and Java named import extraction is deferred. Those languages have import forms that Tree-Sitter can parse, but the priority is TypeScript/TSX/JavaScript. Non-TS languages produce `ImportBinding` records with `confidence: 'low'` and `resolvedFilePath: null` until language-specific extraction is added.
