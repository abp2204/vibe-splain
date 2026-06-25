# ADR-029 — Manifest-Centric Registry

**Status:** Accepted — Implemented  
**Date:** 2026-06-11  
**Deciders:** Aayush Patel

---

## Context

vibesplain produces multiple outputs per scan. Discovering these via path-guessing is fragile, prevents partial scan success logic, and complicates cross-machine collaboration.

---

## Decision

Introduce `artifact_manifest.json` as the **root meta-index** for every `scan_id`. `dossier.json` is demoted to a child artifact.

### Manifest as Index

The manifest records every artifact produced. It must advertise **Indexes** and **Hydration Capabilities**. Large artifacts (like `analysis.json`) must be summarized and indexed at creation time to prevent full-file reads during agent queries.

### Portability & Bundles

To share "Ground Truth", provide a `vibesplain bundle <scan_id>` command. This packages the manifest, pointer metadata, indexes, and blobs into a portable `vibe-bundle.tar.gz`.

On import (`vibesplain import`), the system validates hashes and inserts pointers into a **Bundle Namespace** using an alias map.

*Rule: Pointers are portable only inside a bundle namespace. Content hashes are globally meaningful.*

### Manifest Schema

```json
{
  "schemaVersion": "2.0.0",
  "scanId": "scan_<timestamp>",
  "generatedAt": "<ISO-8601>",
  "artifacts": [
    {
      "name": "analysis",
      "pointer": "ptr_analysis_<id>",
      "sizeBytes": 12400,
      "indexes": {
        "startHere": "ptr_index_start_here_<id>"
      },
      "hydrators": ["get_project_summary", "get_start_here"]
    }
  ]
}
```

---

## Implementation

- **`ExportOrchestrator.writeBundle()`** (`packages/cli/src/export/ExportOrchestrator.ts`): returns `{ scanId, manifestPointer }`. Registers every artifact in BlobStore + PointerStore. Generates `analysis.index.json` with `startHere`, `topHeat`, `pillarSummary`, `totalFiles`, `realSourceFiles`. Registers manifest pointer as `ptr_manifest_<scanId>`.
- **`scan_project` tool**: generates `scanId = scan_${Date.now()}` before calling `writeBundle`; returns `{ scanId, manifestPointer }` to the agent.
- **`bundleCommand`** (`packages/cli/src/commands/bundle.ts`): stages artifacts in `.vibesplain/tmp/bundle-stage-<scanId>/`, creates gzipped tar with `portable: true`.
- **`importBundleCommand`** (`packages/cli/src/commands/importBundle.ts`): extracts to `.vibesplain/tmp/import-<namespace>/`, verifies blob hashes before inserting; namespaces pointer IDs as `<namespace>::<pointerId>`.
- **Verified by:** `test_portability.ts` (bundle → import hash round-trip), `test_adversarial.ts` check 8 (delegated).

---

## Rationale

Decouples artifact existence from file paths, enables cheap querying via indexes, and makes scans securely portable.

## Consequences

- `ExportOrchestrator` must generate manifests and indexes.
- CLI must implement `bundle` and `import` commands with namespace aliasing.
