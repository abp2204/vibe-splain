# ADR-022: Multi-Target Export Orchestration

## Status
Accepted

## Context
VIBE-SPLAIN currently couples dossier generation and UI regeneration within `packages/brain/src/dossier.ts`. As we expand to support multiple output formats (`delta_targets.json`, `dossier.agent.md`, `dossier.pdf`), this coupling leads to schema drift and renderer logic bleeding into the core analysis engine. 

Furthermore, human-authored "Decision Cards" are currently persisted in `dossier.json`, but fresh scans should remain pure fact snapshots.

## Decision
We will introduce a dedicated `ExportOrchestrator` to coordinate the generation of all scan artifacts.

1. **Responsibility Separation**:
    - **Brain**: Owns raw analysis facts (`AnalysisStore`) and fresh scan results.
    - **ExportOrchestrator**: Owns the merging of fresh facts with persisted decision cards, pulls advice from the Policy Engine, and executes renderers.
    - **Renderers**: Own format-specific layout (JSON, HTML, MD, PDF).
    - **ArtifactBundleWriter**: Owns atomic file system commits and staging.

2. **Orchestration Flow**:
    - The CLI invokes `ExportOrchestrator.writeBundle()`.
    - The Orchestrator loads the existing `dossier.json` (if present).
    - It extracts persisted cards and revalidates them against fresh facts using `evidenceHash` and stable path identifiers.
    - It constructs a `DossierViewModel` (merged facts + valid cards + recommendations).
    - It passes the view model to active renderers.

3. **Package Location**:
    - The Orchestrator and Renderers will live in `packages/cli/src/export/` or a new `packages/renderers` package. 
    - `packages/brain` will be refactored to remove all UI-specific paths and `regenerateUI` calls.

## Consequences
- The CLI becomes a thin coordinator.
- `packages/brain` remains a pure, presentation-agnostic library.
- Consistency between multiple artifacts is guaranteed by the Orchestrator.
- New formats can be added by implementing a renderer interface without touching the scanner.
