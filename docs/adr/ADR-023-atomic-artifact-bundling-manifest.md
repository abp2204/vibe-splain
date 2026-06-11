# ADR-023: Atomic Artifact Bundling & Manifest

## Status
Accepted

## Context
A scan produces multiple files. If the process crashes or a specific renderer (like PDF) fails, the output directory can be left in a partially updated state where `dossier.json` matches the new scan but `dossier.html` reflects an old one. 

Additionally, we need a way to track schema versions across artifacts without polluting the strict 5-field contract of `delta_targets.json`.

## Decision
We will implement an `ArtifactBundleWriter` that uses a staging-to-atomic-commit pattern.

1. **Staging Pattern**:
    - All artifacts for a single scan are written to a temporary staging directory (e.g., `.vibe/staged/<scan-id>/`).
    - Only after **all** required artifacts succeed is the bundle committed to the final output directory.
    - Commit is performed via an atomic directory swap or a clean overwrite of the target folder.

2. **The Manifest (`artifact_manifest.json`)**:
    - Every bundle must include a manifest.
    - The manifest records: `scanId`, `generatedAt`, `schemaVersions` for every file, `required` flags, and `status` (written/skipped/error).
    - Consumers (Delta Engine, Agents) MUST read the manifest to verify compatibility before parsing specific artifacts.

3. **Contract Protection**:
    - `delta_targets.json` remains a strict 5-field JSON array (ADR-019).
    - Versioning metadata for `delta_targets.json` lives in the manifest, not in the file itself.

4. **Failure Modes**:
    - `strict`: Any requested artifact failure aborts the bundle commit.
    - `best-effort`: Required artifacts (JSON, HTML) must succeed; optional failures (PDF) are logged in the manifest but the bundle is committed.

## Consequences
- Eliminates "half-baked" scan results.
- Provides a clear location for machine-readable provenance.
- Allows the Delta Engine to safely evolve without breaking strict payload constraints.
