# ADR-014 — action_bindings.json Artifact: Schema and Structure

**Status:** Accepted — Implemented
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

ADR-013 establishes that function-level action binding is the right grounding layer. This ADR defines the concrete schema for the artifact that stores binding data (`action_bindings.json`) and the four top-level structures it must support for deterministic traversal by `brain`.

The artifact must satisfy three query patterns simultaneously:
1. "Give me all functions and their outbound call edges for file X" — used when following a resolved cross-file import during traversal
2. "Give me all functions with action kind `database_write` touching model `Booking`" — used when the agent queries by model or action kind
3. "Give me all exported entrypoint functions in file X" — used as traversal seed for `get_call_chain`

---

## Decision

### Top-Level Structure

```jsonc
{
  "schemaVersion": 1,
  "projectRoot": "/absolute/path/to/project",
  "generatedAt": "ISO-8601 timestamp",
  "files": { /* source of truth — see FileBindingRecord */ },
  "functionIndex": { /* accelerator: functionId → file + location */ },
  "actionIndex": { /* accelerator: actionKey → [functionId, ...] */ },
  "entrypointIndex": { /* accelerator: filePath → [functionId, ...] */ }
}
```

**`files` is the source of truth.** All other top-level keys are derived lookup accelerators. If a value conflicts between `files` and an index, `files` wins.

### Scope

Extract for every file where `isRealSource === true`. No gravity threshold. No entrypoint-reachability filter. Thresholding belongs to query time, not extraction time. Test files (`sourceRole: 'test'`) are included in the artifact but `get_call_chain` excludes them from production flow traversal by default unless explicitly requested.

### FileBindingRecord

```ts
interface FileBindingRecord {
  filePath: string;           // relative to projectRoot
  language: Language;
  sourceRole: 'production' | 'test' | 'config' | 'script';
  imports: ImportBinding[];
  functions: FunctionRecord[];
}
```

### ImportBinding

Represents one import statement in a file. Covers named imports, aliased named imports, default imports, namespace imports, type-only imports, relative imports, and path alias imports.

```ts
interface ImportBinding {
  localName: string;          // name used in this file
  importedName: string;       // exported name in source (differs from localName on alias)
  moduleSpecifier: string;    // raw import path string, e.g. "@/lib/booking"
  resolvedFilePath: string | null; // relative path to resolved file, null if external/unresolved
  importKind: 'named' | 'default' | 'namespace' | 'side_effect';
  isTypeOnly: boolean;        // true for "import type { ... }"
  sourceLine: number;         // 1-based
  confidence: 'high' | 'medium' | 'low';
  evidenceText: string;       // the raw import statement, trimmed, max 200 chars
}
```

**Confidence rules:**
- `high`: relative import resolved to a file in the project file set
- `high`: named import where `localName` matches the exported symbol and the file resolved
- `medium`: path alias import where the alias resolved but the exact symbol was not confirmed in the target file
- `low`: import where the module specifier matched a heuristic but the target file was not found

**Named import extraction detail:**

For `import { checkAvailability, validateInput } from '@/lib/booking'`, emit two `ImportBinding` records: one for `checkAvailability`, one for `validateInput`. Both share the same `moduleSpecifier` and `resolvedFilePath`.

For `import { checkAvailability as check } from '@/lib/booking'`, emit one record with `localName: 'check'` and `importedName: 'checkAvailability'`.

For `import * as availability from '@/lib/availability'`, emit one record with `localName: 'availability'`, `importedName: '*'`, `importKind: 'namespace'`.

For `import type { BookingInput }`, emit with `isTypeOnly: true`. Type-only imports do not produce call resolution targets.

### FunctionRecord

```ts
interface FunctionRecord {
  functionId: string;         // stable ID: "filePath::displayName::startLine:startCol"
  displayName: string;        // human-readable recovered name
  nameSource: NameSource;     // how the name was recovered
  functionKind: FunctionKind;
  filePath: string;
  startLine: number;          // 1-based
  endLine: number;
  startCol: number;
  isExported: boolean;
  isEntrypoint: boolean;      // true if frameworkRole is a route handler kind
  calls: CallRecord[];
  semanticActions: SemanticActionRecord[];
  evidenceText: string;       // first line of function, trimmed, max 200 chars
}

type NameSource =
  | 'function_declaration'     // function foo() {}
  | 'method_definition'        // class methods
  | 'parent_variable_declarator' // const foo = () => {}
  | 'parent_assignment'        // foo = () => {}
  | 'object_property_key'      // { foo: () => {} }
  | 'export_const'             // export const POST = async () => {}
  | 'position_fallback';       // truly anonymous, no recoverable name

type FunctionKind =
  | 'function_declaration'
  | 'arrow_function'
  | 'function_expression'
  | 'method_definition'
  | 'exported_arrow_function'
  | 'anonymous_callback';
```

**Name recovery priority order:**
1. Function declaration name (syntactic, always correct)
2. Method definition name
3. Parent `variable_declarator` name (covers `const POST = async () => {}`)
4. Parent `assignment_expression` left-hand side
5. Object property key
6. Exported const name from enclosing `export_statement`
7. Position fallback: `anonymous@{startLine}:{startCol}`

**`functionId` never depends solely on the recovered name.** It always includes the source position (`startLine:startCol`). `displayName` is for humans and for call resolution matching. The position makes the ID unique even when two functions share the same name.

### CallRecord

```ts
interface CallRecord {
  callId: string;             // "sourceFunctionId::calleeText::sourceLine"
  sourceFunctionId: string;   // containing function
  calleeText: string;         // full text of the call expression, max 100 chars
  calleeRoot: string;         // root identifier: "prisma" in "prisma.booking.create(...)"
  calleeProperty: string | null; // chained property: "booking.create" in above
  sourceLine: number;
  sourceSpan: { startLine: number; endLine: number };
  resolvedTargetFunctionId: string | null; // if cross-file resolution succeeded
  resolvedFilePath: string | null;         // resolved target file
  resolutionKind: ResolutionKind;
  confidence: 'high' | 'medium' | 'low' | 'unresolved';
  evidenceText: string;       // the call expression line, trimmed, max 200 chars
}

type ResolutionKind =
  | 'same_file_function'          // calleeRoot matches a FunctionRecord.displayName in same file
  | 'named_import_match'          // calleeRoot matches ImportBinding.localName (non-namespace)
  | 'namespace_import_property'   // calleeRoot matches namespace import, property not resolved
  | 'semantic_action_only'        // prisma/fetch/etc. — classified as semantic action, not call edge
  | 'unresolved';                 // no match found
```

**Confidence rules for CallRecord:**
- `high`: `same_file_function` where target `FunctionRecord` exists
- `high`: `named_import_match` where `ImportBinding.resolvedFilePath` is non-null
- `medium`: `namespace_import_property` — namespace resolved but method not confirmed
- `unresolved`: no resolution found

**Critical distinction — CallEdge vs SemanticAction:**  
`prisma.booking.create(...)` is NOT a call to a user-defined function. It is a **semantic action**. It should produce a `SemanticActionRecord`, not a `CallRecord` with `resolvedTargetFunctionId`. Collapsing these two into one object would force `get_call_chain` to treat database operations as traversable call edges, which is wrong.

`checkAvailability(...)` IS a call edge — it should resolve to a `FunctionRecord` in another file.

### SemanticActionRecord

```ts
interface SemanticActionRecord {
  actionId: string;           // "sourceFunctionId::actionKind::sourceLine"
  sourceFunctionId: string;
  actionKind: SemanticActionKind;
  targetModel: string | null;     // "Booking", "Payment", etc.
  targetOperation: string | null; // "create", "update", "findMany", etc.
  calleeText: string;         // the expression that triggered this action
  sourceLine: number;
  confidence: 'high' | 'medium' | 'low';
  evidenceText: string;       // the line text, trimmed, max 200 chars
}

type SemanticActionKind =
  | 'database_write'
  | 'database_read'
  | 'external_api_call'
  | 'validation'
  | 'auth_check'
  | 'email_send'
  | 'calendar_mutation'
  | 'webhook_delivery'
  | 'webhook_ingress'
  | 'cache_revalidation'
  | 'redirect'
  | 'analytics_event'
  | 'side_effect';
```

**Confidence rules for SemanticActionRecord:**
- `high`: Prisma method call pattern matched directly (`prisma.{model}.{operation}`)
- `high`: Known side-effect import in scope and call pattern matched
- `medium`: Pattern matched on call text but import origin uncertain
- `low`: Heuristic name match only (function named `sendEmail` but no email import confirmed)

### Lookup Accelerators

**`functionIndex`** — maps functionId to a lightweight summary (file + location). Prevents full scan of `files` to hydrate a functionId returned by `actionIndex`.

```ts
interface FunctionIndexEntry {
  filePath: string;
  displayName: string;
  startLine: number;
  endLine: number;
}
// Top-level key: functionId string
```

**`actionIndex`** — maps action keys to lists of functionIds. Keys are:
- `"database_write"` → all functions with any database write
- `"database_write::Booking"` → all functions that write to Booking model
- `"database_write::Booking::create"` → narrowed to create operation
- `"validation"`, `"auth_check"`, `"email_send"`, etc.

`actionIndex` identifies candidates. `get_call_chain` must still prove reachability from the requested entrypoint. The index does not prove a function is on any particular execution path.

**`entrypointIndex`** — maps filePath to functionIds of functions where `isEntrypoint: true`. Used as traversal seed: `get_call_chain` starts from the function in `entrypointIndex[entrypointPath]` rather than scanning all functions.

---

## Rationale

**Why file-indexed source of truth with derived accelerators:**

A flat array of all FunctionRecords across all files would require a full scan to find functions in a given file during traversal. A pure functionId index would require reconstituting the file context (imports, etc.) for every resolution step. File-indexed source of truth matches how traversal actually works: "I resolved this call to file X — now give me all functions in file X and find the one named Y."

**Why not store chains in the artifact:**

Pre-computing chains for every possible (entrypoint, targetBehavior) pair is exponential and would make the artifact stale after any code change. Chains are computed at query time from the stable graph in `action_bindings.json`. The graph is stable; the traversal is on-demand.

**Why include test files but exclude them from default traversal:**

Test files often import the same symbols as production code. Excluding them from the artifact would miss import patterns that can help resolve production symbols. But including them in call chain traversal would pollute production flow chains with test setup code. The `sourceRole` field lets `get_call_chain` filter at traversal time.

---

## Consequences

- `packages/brain/src/pipeline/binding.ts` implements extraction and artifact writing.
- The artifact is written on every `scan_project` call, overwriting the previous version (same pattern as other stage artifacts).
- `action_bindings.json` can be large for monorepos. For Cal.com, expect O(10,000–50,000) FunctionRecords. JSON serialization of this is acceptable for a local file tool; streaming or binary formats are deferred.
- `get_call_chain` reads `action_bindings.json` from disk on each call. Brain does not cache it in memory between MCP calls (same pattern as `analysis.json`).
- Schema version is `1`. Breaking schema changes require a version bump and a migration note in CHANGELOG.md.
