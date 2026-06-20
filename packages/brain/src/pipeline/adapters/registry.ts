// Adapter registry + deterministic composition (ADR-034 §8).
//
// Selection: 0, 1, or many adapters may match. Matching adapters are sorted by
// id so the firing set is deterministic. Composition is order-independent —
// lifts sum, tags/patterns union, severity boosts take max — so the final
// output never depends on registration order. This keeps adapter output stable
// regardless of how adapters are registered.
//
// With zero registered adapters (today), runAdapterStage returns the identity
// result and the pipeline seams are pure no-ops.

import type {
  DomainAdapter, AdapterContext, AdapterStageResult, AdapterSurfacePattern,
} from './types.js';
import { emptyAdapterStageResult } from './types.js';

export class AdapterRegistry {
  private adapters: DomainAdapter[] = [];

  /** Register a compiled-in adapter. Re-registering the same id replaces it. */
  register(adapter: DomainAdapter): void {
    this.adapters = this.adapters.filter(a => a.id !== adapter.id);
    this.adapters.push(adapter);
  }

  /** All registered adapters (for tests/introspection). */
  list(): readonly DomainAdapter[] {
    return [...this.adapters].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Adapters whose detect() matches, in deterministic id order. */
  select(ctx: AdapterContext): DomainAdapter[] {
    return this.adapters
      .filter(a => {
        try { return a.detect(ctx); } catch { return false; }
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Run every matching adapter and compose their contributions into one
   * order-independent result. Returns the identity result when nothing matches.
   */
  runStage(ctx: AdapterContext): AdapterStageResult {
    const matched = this.select(ctx);
    if (matched.length === 0) return emptyAdapterStageResult();

    const out = emptyAdapterStageResult() as {
      firedAdapterIds: string[];
      liftByFile: Map<string, number>;
      severityBoostByFile: Map<string, number>;
      loadBearingBoostByFile: Map<string, number>;
      classificationByFile: Map<string, { adapterDomain?: string; domainTags: string[]; executionRole?: string }>;
      sideEffectsByFile: Map<string, string[]>;
      writeIntentsByFile: Map<string, string[]>;
      pillarLabelsByFile: Map<string, string>;
      pillarRenames: Map<string, string>;
      surfacePatterns: AdapterSurfacePattern[];
      metrics: Record<string, number>;
    };
    out.firedAdapterIds = matched.map(a => a.id); // already id-sorted

    const execRoleCandidates = new Map<string, Set<string>>();

    for (const adapter of matched) {
      // behavioralLift — commutative SUM (clamped at the gravity assembly seam)
      const lift = adapter.computeBehavioralLift?.(ctx);
      if (lift) {
        for (const [rel, v] of Object.entries(lift.byFile)) {
          if (v < 0) continue; // invariant: lift never demotes
          out.liftByFile.set(rel, (out.liftByFile.get(rel) ?? 0) + v);
        }
      }

      // severity boost — commutative MAX
      const sev = adapter.applySeverityPolicy?.(ctx);
      if (sev) {
        for (const [rel, v] of Object.entries(sev.byFile)) {
          if (v < 0) continue;
          out.severityBoostByFile.set(rel, Math.max(out.severityBoostByFile.get(rel) ?? 0, v));
        }
      }


      // load-bearing boost - commutative MAX
      const lb = adapter.applyLoadBearingPolicy?.(ctx);
      if (lb) {
        for (const [rel, v] of Object.entries(lb.byFile)) {
          if (v < 0) continue;
          out.loadBearingBoostByFile.set(rel, Math.max(out.loadBearingBoostByFile.get(rel) ?? 0, v));
        }
      }

      // classification — domainTags UNION; executionRole resolved deterministically below
      const cls = adapter.classify?.(ctx);
      if (cls) {
        for (const [rel, c] of Object.entries(cls.byFile)) {
          const cur = out.classificationByFile.get(rel) ?? { domainTags: [] as string[] };
          if (c.adapterDomain != null) cur.adapterDomain = cur.adapterDomain ?? c.adapterDomain;
          if (c.domainTags) cur.domainTags = unionSorted(cur.domainTags, c.domainTags);
          if (c.executionRole != null) {
            const s = execRoleCandidates.get(rel) ?? new Set<string>();
            s.add(c.executionRole);
            execRoleCandidates.set(rel, s);
          }
          out.classificationByFile.set(rel, cur);
        }
      }

      // domain side effects — UNION
      const eff = adapter.interpretSideEffects?.(ctx);
      if (eff) {
        for (const [rel, arr] of Object.entries(eff.byFile)) {
          out.sideEffectsByFile.set(rel, unionSorted(out.sideEffectsByFile.get(rel) ?? [], arr));
        }
      }

      // write intents — UNION
      const wi = adapter.inferWriteIntents?.(ctx);
      if (wi) {
        for (const [rel, arr] of Object.entries(wi.byFile)) {
          out.writeIntentsByFile.set(rel, unionSorted(out.writeIntentsByFile.get(rel) ?? [], arr));
        }
      }

      // pillar renames and labels — last-by-id-order wins is non-commutative, so only set
      // if not already set (first id-sorted adapter wins → deterministic)
      const pl = adapter.labelPillars?.(ctx);
      if (pl?.renames) {
        for (const [from, to] of Object.entries(pl.renames)) {
          if (!out.pillarRenames.has(from)) out.pillarRenames.set(from, to);
        }
      }
      if (pl?.byFile) {
        for (const [rel, label] of Object.entries(pl.byFile)) {
          if (!out.pillarLabelsByFile.has(rel)) out.pillarLabelsByFile.set(rel, label);
        }
      }

      // surface patterns — concat (union of independent patterns)
      const sp = adapter.getSurfacePatterns?.();
      if (sp) out.surfacePatterns.push(...sp);

      // metrics — sum or set
      const met = adapter.getMetrics?.();
      if (met) {
        for (const [k, v] of Object.entries(met)) {
          out.metrics[k] = (out.metrics[k] ?? 0) + v;
        }
      }
    }

    // Resolve executionRole deterministically: lexicographically-first candidate.
    for (const [rel, roles] of execRoleCandidates) {
      const chosen = [...roles].sort()[0];
      const cur = out.classificationByFile.get(rel) ?? { domainTags: [] as string[] };
      cur.executionRole = chosen;
      out.classificationByFile.set(rel, cur);
    }

    return out;
  }
}

/** Set-union of two string lists, deduped and sorted (order-independent). */
function unionSorted(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

// Singleton registry. Adapters are registered here (compiled-in) during their
// extraction/implementation. EMPTY today — every scan is pure generic core.
export const adapterRegistry = new AdapterRegistry();
