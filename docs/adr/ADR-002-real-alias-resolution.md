# ADR-002 — Real Pre-Graph Alias Resolution (Stage 4)

**Status:** Accepted — Implemented (v2.5.0)
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

The previous alias resolver was a hardcoded static list in `scanner.ts`:

```ts
const MONOREPO_ALIASES = [
  { prefix: '@calcom/features/', replacement: '../packages/features/' },
  { prefix: '@calcom/lib/',      replacement: '../packages/lib/' },
  // ...
];
```

This ran inline during graph construction, not as a pre-pass. The problems:

1. The alias map was not derived from the project — it was hardcoded for Cal.com. Any project with different `tsconfig.json` paths or workspace naming conventions would silently fail to resolve imports.
2. Failed alias resolutions were tracked as `importsUnresolved` but there was no artifact showing *why* a specific alias failed or *which config file* was the source of truth.
3. `importedBy` chains for cross-package hooks (e.g. `useBookings.ts` importing `@calcom/trpc/react`) were incomplete, causing `entrypointTraceStatus: blocked_by_alias_resolution` with no actionable debug information.
4. `runtimeEntrypoints`, `blastRadius`, and `loadBearingScore` all depend on accurate `importedBy` chains. Classification errors downstream were often alias resolution failures upstream.

---

## Decision

Stage 4 (`pipeline/resolution.ts`) is a real pre-graph normalization stage that builds a canonical alias map **before** graph construction.

**Alias map construction (in priority order):**
1. Read `tsconfig.json` → `compilerOptions.paths`
2. Read root `package.json` → `workspaces` array → find each workspace's `package.json` → extract `name` field
3. Read any app-level `tsconfig.json` files (e.g. `apps/web/tsconfig.json`)
4. Fallback: conventional aliases (`~/`, `@lib/`, `@server/`, `@components/`)
5. JS/TS extension + index expansion: try `.ts`, `.tsx`, `.js`, `.jsx`, `index.ts`, `index.tsx`

**Stage artifact — `stage-04-aliases.json`:**
```json
{
  "resolvedAliases": {
    "@calcom/features/bookings": "packages/features/bookings"
  },
  "workspacePackages": {
    "@calcom/ui": "packages/ui",
    "@calcom/trpc": "packages/trpc"
  },
  "unresolvedImports": ["@calcom/platform/..."],
  "resolutionFailuresByFile": {
    "modules/bookings/hooks/useBookings.ts": ["@calcom/trpc/react"]
  },
  "resolutionFailureReasons": {
    "@calcom/trpc/react": "workspace package found but path mapping missing in tsconfig"
  }
}
```

All subsequent pipeline stages consume resolved import paths from this map. Graph construction never sees raw alias strings.

**Acceptance check:** If any file with gravity ≥ 40 still has unresolved aliases after this stage, `resolutionFailuresByFile` must name the exact import string and `resolutionFailureReasons` must name the config file that was insufficient or missing.

---

## Rationale

- **Root cause of entrypoint trace failures:** `useBookings.ts` tracing only to event-type configuration pages (wrong surface) was caused by broken `importedBy` chains from unresolved `@calcom/*` aliases, not a defect in the entrypoint tracer itself.
- **Generality:** Hardcoded Cal.com aliases broke for any other project. Reading `tsconfig.json` paths and `package.json` workspaces works across any monorepo.
- **Debug parity:** `stage-04-aliases.json` makes alias failures attributable. "Why does useBookings.ts have `blocked_by_alias_resolution`?" → open the artifact → see the exact import and the missing config.

---

## Consequences

- `resolution.ts` must handle missing or malformed `tsconfig.json` gracefully (e.g. `extends` chains, JSON with comments). Use a lenient parser or strip comments before parsing.
- The static `MONOREPO_ALIASES` fallback list in the old `scanner.ts` can be kept as a last-resort fallback but must not be the primary source.
- Resolution failures for low-gravity files do not need to be reported — only failures on files with `gravity ≥ 40` or `isRealSource: true` need entries in `resolutionFailuresByFile`.
