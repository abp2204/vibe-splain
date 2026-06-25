# ADR-018 — Tree-Sitter First; TypeScript Compiler API Deferred

**Status:** Accepted — Implemented
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

Two primary tools exist for TypeScript static analysis:

**Tree-Sitter** (`web-tree-sitter`) — already in use in vibesplain. A streaming incremental parser that produces a concrete syntax tree from source text. Language-agnostic, fast, available for TypeScript/TSX/JavaScript as well as Python, Go, Rust, Java. Operates on source text without needing a TypeScript project configuration. Does not perform type inference.

**TypeScript Compiler API** (`typescript` npm package) — the official TypeScript compiler exposed as a programmatic API. Produces a typed AST with full type information, symbol resolution, cross-file analysis, declaration merging, and generic instantiation. Requires a `tsconfig.json` to set up a project. TypeScript-only. Significantly heavier and slower than Tree-Sitter for large codebases.

When designing the function-level action binding system (ADR-013 through ADR-017), a fundamental choice was required: which tool to use for AST analysis in `runActionBinding`.

The language adapters reasoning document (Section 15, Decision 2) discusses this explicitly. Its recommendation is: "Use the TypeScript Compiler API for the main target-codebase adapter. Use Tree-sitter later for broader language coverage or faster structural fallback."

This ADR records the decision to **invert that recommendation for the first implementation**, and documents the conditions under which the TypeScript Compiler API should be introduced.

---

## Decision

**Use Tree-Sitter for Pass 1 of action binding. Do not introduce the TypeScript Compiler API until a specific, concrete failure case requires it.**

Tree-Sitter is sufficient to extract:
- Function declarations, arrow functions, function expressions, method definitions
- Named import/export statements
- Call expressions and their structure (root identifier, chained property, arguments)
- Source line spans
- Namespace import patterns
- Type-only import markers

Combined with the existing import resolution infrastructure (`runResolution`, alias map, file set), Tree-Sitter gives 80–90% of the call resolution needed for the first grounded explanation chains in a Next.js/TypeScript codebase.

**Do not introduce the TypeScript Compiler API in this phase.** The decision to introduce it must be triggered by a real failure case, not by a design preference for completeness.

### Cases Where Tree-Sitter Is Sufficient

| Case | Resolution Strategy |
|---|---|
| `import { foo } from './lib'` → call `foo()` | Named import match → `confidence: high` |
| `import * as ns from './lib'` → call `ns.method()` | Namespace import match → `confidence: medium` |
| `import foo from './lib'` → call `foo()` | Default import match → `confidence: high` |
| `prisma.booking.create()` | Semantic action — no function resolution needed |
| `const createBooking = async () => {}` | Name recovery from parent variable declarator |
| `export const POST = async () => {}` | Name recovery from export statement |
| Path alias: `@/lib/booking` | Already resolved by `runResolution` alias map |
| Relative import: `./utils` | Already resolved by `runResolution` |

### Cases Where the TypeScript Compiler API Becomes Necessary

The TypeScript Compiler API should be introduced **only when a real failure case is observed and documented.** The following are the known categories:

**Category 1 — Barrel re-exports obscure the source symbol:**
```ts
// index.ts re-exports from multiple files
export { createBooking } from './booking';
export { checkAvailability } from './availability';
```
A named import from `@/lib` resolves to `index.ts`, but the function `createBooking` is not defined in `index.ts`. Tree-Sitter cannot follow the re-export chain to `./booking`. The TypeScript Compiler API's `getSymbolAtLocation` + `getDeclarations` handles this.

**Category 2 — Two local functions share the same name:**
```ts
function handleBooking() { ... }  // in outer scope
function outer() {
  function handleBooking() { ... }  // shadow
  handleBooking();  // which one?
}
```
Tree-Sitter cannot resolve which `handleBooking` is called without scope analysis. The TypeScript Compiler API resolves this via its symbol scoping rules.

**Category 3 — Generic service wrappers hide the real caller:**
```ts
const result = await trpc.bookings.create.mutate(data);
```
`trpc.bookings.create.mutate` is not a static function call — it is a dynamically generated tRPC client method. The target function is not resolvable via static analysis at all (Tree-Sitter or TypeScript Compiler API). This is a runtime dispatch problem. Mark as `confidence: low`, `resolutionKind: 'unresolved'`.

**Category 4 — Class method calls on typed objects:**
```ts
const service = new BookingService();
service.create(data);
```
`service.create` resolves to `BookingService.create` only if the TypeScript type of `service` is known. Tree-Sitter sees `service.create` as a property access on an unknown object. The TypeScript Compiler API can infer the type of `service` and resolve `create` to the method definition. Tree-Sitter cannot.

**Category 5 — Path aliases not in tsconfig.json:**
Some monorepos use path aliases defined in build tooling (webpack, Vite, esbuild) rather than `tsconfig.json`. These are already partially handled by `CONVENTIONAL_ALIASES` in `resolution.ts`. If a critical alias is missing, the correct fix is to add it to `CONVENTIONAL_ALIASES`, not to introduce the TypeScript Compiler API.

**Category 6 — Dynamic imports:**
```ts
const handler = await import(`./handlers/${handlerName}`);
```
Neither Tree-Sitter nor the TypeScript Compiler API can resolve a template-literal module specifier at static analysis time. Mark as `confidence: low`, `resolutionKind: 'unresolved'`.

### Failure Case Documentation Protocol

When a failure case is encountered in practice:

1. Document the specific call expression and why Tree-Sitter cannot resolve it
2. Confirm the TypeScript Compiler API would resolve it (by inspection or experimentation)
3. Assess how frequently this pattern appears in the target codebase
4. Only introduce the TypeScript Compiler API if the pattern is on a critical execution path that the explanation chain must traverse

A failure case that affects 5% of call edges in low-gravity utility files does not justify introducing the TypeScript Compiler API. A failure case that breaks the booking creation chain at the route handler level does.

---

## Rationale

**Why invert the language adapters document's recommendation:**

The document's recommendation to use the TypeScript Compiler API was written in the context of a greenfield adapter design. In practice, vibesplain already has a functioning Tree-Sitter pipeline, an alias resolution system, and a file-level semantic classification system. The TypeScript Compiler API would require:
- Setting up a `ts.createProgram` or language service with the correct `tsconfig.json`
- Handling monorepo tsconfig chains and project references
- Managing compilation errors in source files (large real-world repos have linting errors that break `strict` mode compilation)
- Significantly increased scan time (type-checking is orders of magnitude slower than Tree-Sitter parsing)
- TypeScript-only coverage (Python, Go, Rust analysis would need separate handling)

The cost of introducing it upfront is high. The benefit over Tree-Sitter + named imports is real but marginal for the first 80% of call chains. The correct engineering decision is to use the simpler tool until it provably fails.

**Why the Tree-Sitter approach is not a dead end:**

The schemas defined in ADR-014 (ImportBinding, FunctionRecord, CallRecord, SemanticActionRecord) are independent of the extraction tool. `binding.ts` can be reimplemented to use the TypeScript Compiler API as the extraction backend while keeping the same output schema. The MCP interface, traversal logic, and downstream consumers do not change. This is the correct abstraction: the extraction tool is an implementation detail of `binding.ts`, not a schema-level commitment.

**Why "80% is enough" for the first implementation:**

The concrete product test (ADR-013) is: can the system trace the booking creation flow from the API entrypoint to `prisma.booking.create` with exact function names, file paths, and line numbers? That flow uses direct named imports throughout (Next.js route handler → service functions → Prisma client). None of the edge cases in Category 1–6 above are on that path. Tree-Sitter handles the entire flow. The 20% gap (barrel re-exports, class method resolution, generic wrappers) appears in infrastructure code, not in the primary behavioral flows that action binding targets first.

---

## Consequences

- `packages/brain/src/pipeline/binding.ts` uses `web-tree-sitter` (already initialized in `inventory.ts`) for AST analysis.
- No new npm dependencies are introduced in this phase.
- `binding.ts` exports a `extractBindings(source: string, lang: Language, tree: Parser.Tree, ...): FileBindingRecord` function that can be swapped for a TypeScript Compiler API implementation later without changing the return type.
- If a barrel re-export fails to resolve, `ImportBinding.resolvedFilePath` is null and `CallRecord.confidence` is `'medium'` or `'unresolved'`. The agent sees the uncertainty explicitly via `UnresolvedEdge` in `get_call_chain` output.
- Any decision to introduce the TypeScript Compiler API must be recorded in a new ADR that documents the specific failure case that triggered it, the frequency of the pattern in the target codebase, and the expected improvement in chain completeness.
