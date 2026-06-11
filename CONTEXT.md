# VIBE-SPLAIN — Product Context

## What This Is

VIBE-SPLAIN is "The MRI" — the static analysis half of a two-part legacy modernization platform. It parses a codebase's AST and produces a machine-readable risk map that a runtime orchestrator (Delta Engine) uses to make safe, automated modernization decisions.

## The Two-Part System

```
VIBE-SPLAIN (The MRI)          Delta Engine (The Surgeon)
──────────────────────         ──────────────────────────
Static AST analysis     ──▶    eBPF proxy clones prod traffic
Produces risk map              Write-sink intercepts DB mutations
delta_targets.json      ──▶    Shadow instance runs modernized code
                               LLM hot-patches on mismatch
```

**Operational flow:**
1. Run VIBE-SPLAIN on a legacy repo → generates structural dossier + `delta_targets.json`
2. Delta Engine points eBPF proxy at legacy instance → clones traffic to shadow instance
3. Compare write-intents and API outputs between instances
4. Mismatch detected → use `delta_targets.json` risk map to identify faulty component → local LLM generates hot-patch

## Dual Audience

**Current:** VIBE-SPLAIN is published as an npm CLI + MCP server (`vibe-splain`). It was designed for GitHub distribution and works with Claude Code agents. This is the proving ground.

**Future:** Enterprise product where Delta Engine (not a human agent) is the primary consumer. The `brain` package must stay a pure library so Delta Engine can import it directly, bypassing MCP entirely.

**Rule:** MCP/CLI concerns must never bleed into `packages/brain/`. Brain is the product; MCP is a delivery mechanism.

## Scope: The TS/JS Wedge

Strictly TypeScript and Next.js repositories. Next.js forces architectural boundaries via directory structure, which aligns with graph-based heuristic analysis. Cal.com is the testbed.

We do not parse Python, Java, or COBOL. That was an anti-pattern we explicitly abandoned.

## Delta Engine Interface Contract

`delta_targets.json` is the machine-readable payload Delta Engine reads. Schema (written by `scan_project`, available immediately — no agent required):

```typescript
interface DeltaTarget {
  path: string;         // relative path from project root
  gravity: number;      // 0–100, higher = more structurally complex
  isLoadBearing: boolean; // true if fanIn >= 10 (widely imported = dangerous to change)
  blastRadius: string[]; // files that import this file (change propagation set)
  pillarHint: string | null; // architectural pillar (auth, data, api, etc.)
}
```

`dossier.json` remains human/agent-facing (decision cards, notes, UI viewer). Do not conflate the two.

## Current Status (2026-06-11)

**Delta Engine:** Infrastructure proving ground phase. Milestone = Docker dual-instance + eBPF cloner + write-sink.

**VIBE-SPLAIN:** v0.5 implemented (CLI v3.1.0). The engine is now a fully orchestrated pipeline with hardened security and performance layers. Key features include the Context-as-Cache architecture (ADR-028), content-addressed artifact integrity (ADR-031), and a secure Manager-Worker delegation model (ADR-030). The system is now guarded by a comprehensive regression suite covering WAL concurrency, budget enforcement, and adversarial scope-bypass attempts.

## Architecture Decisions

| ADR | Decision |
|-----|----------|
| [ADR-001](docs/adr/ADR-001-orchestrated-pipeline-architecture.md) | 12-stage pipeline in `packages/brain/src/pipeline/`; `scanner.ts` stays as shim |
| [ADR-002](docs/adr/ADR-002-real-alias-resolution.md) | Stage 4 reads `tsconfig.json` paths + workspaces before graph construction |
| [ADR-028](docs/adr/ADR-028-context-as-cache-architecture.md) | History is volatile; artifacts are the DB; pointers are the bridge |
| [ADR-030](docs/adr/ADR-030-manager-worker-delegation.md) | Strategy stays with Manager; execution noise stays with Worker; scope enforced at Tool layer |
| [ADR-031](docs/adr/ADR-031-content-addressed-integrity.md) | Skeletons/Artifacts are content-hash-bound; patches are preimage-guarded |
| [ADR-033](docs/adr/ADR-033-multi-layer-scope-enforcement.md) | Multi-layer scope enforcement at API and Tool boundaries |
