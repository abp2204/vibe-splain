# ADR-034 — Repo-Agnostic Core + Optional Domain Adapters

**Status:** Accepted — Implemented
**Deciders:** Aayush Patel

---

## Context

`brain` is a static-analysis engine that must run against arbitrary repositories. Earlier iterations baked product-specific vocabulary directly into the core — domain `SideEffect` members, a `ProductDomain` enum, domain severity rules, surface patterns, and write-intent inference. That made the core *not* repo-agnostic: every new product would either pollute one shared vocabulary or fork the engine.

Separately, static-import gravity is structurally blind to files that are important for behavioral reasons but are not heavily imported — e.g. plugin/node implementations loaded dynamically at runtime via a manifest rather than through `import` statements. Their static fan-in is near zero, so they never reach the top of the gravity ranking.

## Decision

`brain` core owns only **generic, repo-agnostic analysis**. Any product- or framework-specific *interpretation* lives behind an optional `DomainAdapter` boundary.

**Core owns** (structure): AST parsing, import graph, PageRank/fan-in/cyclomatic/publicSurface, `staticGravity`, generic side effects, canonical severity baseline, pillar clustering.

**An adapter may own** (meaning): domain side effects, domain severity boosts, write intents, surface patterns, pillar labels, `behavioralLift`, `executionRole`, and a domain taxonomy (`adapterDomain`, `domainTags[]`).

### Composition is additive and non-destructive

- The import graph is **not** mutated by adapters. `staticGravity` stays the pristine import-graph score.
- Behavioral lift is computed **post-hoc** from adapter evidence and folded in at the gravity assembly seam:
  `gravity = max(staticGravity, min(100, staticGravity + behavioralLift))`.
- Lift never demotes (it is `>= 0`). Severity/load-bearing boosts compose via `max`; tags/patterns via set-union. Composition is order-independent.

### Adapters are compiled-in and optional

Adapters are registered with the in-process `AdapterRegistry` (`brain/src/pipeline/adapters/`). There is **no dynamic loading, no network, no config**. The open-source core ships with the registry **empty** — when no adapter fires, every adapter hook is a no-op, `behavioralLift = 0`, and `gravity == staticGravity`. This is the universal-fallback guarantee verified by `test_no_adapter_safety.ts`.

## Consequences

- A neutral core scans any codebase; a project that wants product-aware ranking implements a single `DomainAdapter` (see `brain/src/pipeline/adapters/types.ts`) and registers it — without touching core.
- Adapter-scoped fields (`adapterDomain`, `domainTags`, `executionRole`, `behavioralLift`) are additive metadata; consumers that ignore them see pure static analysis.
- The seam is invoked at the existing pipeline stages where domain logic would otherwise live, so a future adapter is a localized addition rather than a core rewrite.
