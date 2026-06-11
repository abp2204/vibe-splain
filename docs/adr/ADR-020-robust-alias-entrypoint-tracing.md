# ADR-020: Robust Alias and Entrypoint Tracing

**Status:** Accepted — Implemented

## Context
Entrypoint tracing is frequently blocked by failures in alias resolution (`blocked_by_alias_resolution`). This is particularly acute in monorepos where `tsconfig.json` files are nested and complex. Without reliable entrypoint traces, Delta Engine cannot localize mismatches to specific runtime surfaces, reducing its effectiveness for autonomous patching.

## Decision
1. **Recursive Discovery:** Alias resolution will scan the project recursively for `tsconfig.json` files and package workspace definitions, merging them into a unified resolution map.
2. **BaseURL Support:** The resolver will handle `baseUrl` configurations that allow absolute imports without explicit alias prefixes.
3. **Trace Quality Metrics:** A new metric `entrypointTraceCoverage` will be added to the `validation_report.json` to quantify the percentage of targets with successful traces.
4. **Surface Validation:** Entrypoint tracing will validate that the found runtime surfaces (e.g., API routes) align with the file's classified `productDomain`.

## Consequences
- Significant reduction in "blocked" trace statuses in complex projects like Cal.com.
- Higher confidence in Delta Engine's ability to map code changes to runtime behavior.
- Better visibility into scan quality through explicit coverage metrics.
