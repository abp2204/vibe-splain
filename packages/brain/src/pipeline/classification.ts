import { join, basename, extname, sep } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import type {
  GravitySignals, HeatSignals,
  FrameworkRole, ProductDomain, SideEffect, RiskType, RuntimeEntrypoint,
} from '../signals.js';
import type { HotSpan, WriteIntent } from '../analysis.js';
import type { PillarDef, ProjectMap } from '../dossier.js';
import { computeHeat, matchPillarByImports, matchPillarByPath, MEANINGLESS_SEGMENTS } from './inventory.js';
import type { InventoryResult } from './inventory.js';
import type { ResolutionResult } from './resolution.js';
import { adapterRegistry } from './adapters/index.js';
import type { AdapterContext, AdapterStageResult } from './adapters/index.js';

// ── Side effect inference (stage 5 — expanded) ────────────────────────────────

export function inferSideEffectProfile(
  source: string,
  importSpecs: string[],
  productDomain: ProductDomain,
  frameworkRole: FrameworkRole,
): SideEffect[] {
  const effects = new Set<SideEffect>();

  if (/router\.(push|replace|back)\(|redirect\(|notFound\(|permanentRedirect\(/.test(source)) {
    effects.add('redirect');
  }

  if (/["']use server["']/.test(source)) effects.add('server_action');

  if (/useMutation\b|\.mutate\b|\.mutateAsync\b/.test(source)) effects.add('trpc_mutation');

  if (
    /sdkActionManager\.fire|telemetry\.|posthog\.|mixpanel\.|amplitude\.|ga\(/.test(source) ||
    importSpecs.some(s => /analytics|telemetry|posthog|mixpanel|amplitude/.test(s))
  ) effects.add('analytics_event');

  if (/prisma\s*[.?]\s*\w+\s*[.?]\s*(create|update|upsert|delete|deleteMany|updateMany|createMany|transaction|executeRaw|queryRaw)\b/.test(source)) {
    effects.add('database_write');
  }

  if (/prisma\s*[.?]\s*\w+\s*[.?]\s*(findMany|findUnique|findFirst|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)\b/.test(source)) {
    effects.add('database_read');
  }

  if (
    /sendEmail|sendMail\b|mailer\./.test(source) ||
    importSpecs.some(s => /nodemailer|resend|sendgrid|postmark|mailgun/.test(s))
  ) effects.add('email_send');

  if (/revalidatePath\b|revalidateTag\b/.test(source)) effects.add('cache_revalidation');

  if (/localStorage\.|sessionStorage\./.test(source)) effects.add('local_storage');
  if (/indexedDB\b|new Dexie|idb\./.test(source)) effects.add('indexed_db');

  if (/\bfetch\s*\(|axios\.(get|post|put|patch|delete)\b/.test(source)) {
    effects.add('external_api_call');
  }

  if (effects.size === 0) effects.add('none_detected');
  return [...effects];
}

// ── Write intent inference (stage 6) ─────────────────────────────────────────
// Domain-specific intents (booking/payment/event/availability/auth/
// settings/send_webhook) are supplied by an optional domain adapter. Core keeps only
// the GENERIC, repo-agnostic intent: persisting client-side state, driven by
// generic storage side effects. The none_detected fallback is applied after the
// core + adapter intents are merged (see runClassification).

export function inferGenericWriteIntents(sideEffectProfile: SideEffect[]): WriteIntent[] {
  const intents: WriteIntent[] = [];
  if (sideEffectProfile.includes('local_storage') || sideEffectProfile.includes('indexed_db')) {
    intents.push('persist_local_state');
  }
  return intents;
}

// ── Risk type inference (stage 7 — two-pass) ──────────────────────────────────

const ENTRYPOINT_ROLES = new Set<FrameworkRole>([
  'app_route_page', 'app_route_handler',
  'pages_route', 'pages_api_route', 'trpc_api_route',
]);

function inferRiskTypesPass1(
  rel: string,
  frameworkRole: FrameworkRole,
  productDomain: ProductDomain,
  sideEffectProfile: SideEffect[],
  gravitySignals: GravitySignals,
  smellKinds: Set<string>,
): RiskType[] {
  const types: RiskType[] = [];

  // state_machine — role-aware threshold
  const smThreshold = (['provider', 'store'] as FrameworkRole[]).includes(frameworkRole) ? 8 : 20;
  if (gravitySignals.cyclomatic > smThreshold) types.push('state_machine');

  if (smellKinds.has('god-file')) {
    if (frameworkRole === 'hook') types.push('god_hook');
    else types.push('god_component');
  }

  if (sideEffectProfile.length > 3 && !sideEffectProfile.includes('none_detected')) {
    types.push('side_effect_coupling');
  }

  // registry_bottleneck — lowered threshold (OR, not AND)
  if (
    productDomain === 'forms' &&
    (gravitySignals.fanIn > 3 || gravitySignals.publicSurface > 5)
  ) types.push('registry_bottleneck');

  if (
    sideEffectProfile.some(s => ['database_write', 'trpc_mutation', 'external_api_call'].includes(s)) &&
    gravitySignals.cyclomatic > 10
  ) types.push('mutation_orchestration');

  if (ENTRYPOINT_ROLES.has(frameworkRole) && sideEffectProfile.includes('database_write')) {
    types.push('route_handler_write_path');
  }

  if (smellKinds.has('swallowed-catch')) types.push('error_swallowing');

  if (sideEffectProfile.includes('local_storage') || sideEffectProfile.includes('indexed_db')) {
    types.push('storage_persistence_risk');
  }

  return types;
}

// ── Entrypoint surface quality patterns (ADR-006) ────────────────────────────
// Domain-specific patterns are not baked into core. They are supplied by an
// optional domain adapter's getSurfacePatterns() and threaded in as
// a domain -> { expected, wrong } map. Core has no built-in patterns; when no
// adapter fires the map is empty and the wrong-surface check is simply skipped.

/** domain -> surface quality patterns, supplied by fired adapters. */
export type SurfacePatternMap = Map<string, { expected: RegExp[]; wrong: RegExp[] }>;

// ── Entrypoint tracing (stage 8) ──────────────────────────────────────────────

export function findRuntimeEntrypoints(
  relPath: string,
  importedByMap: Map<string, Set<string>>,
  persisted: Map<string, { frameworkRole: FrameworkRole; productDomain: ProductDomain }>,
  maxDepth = 8,
): RuntimeEntrypoint[] {
  const results: RuntimeEntrypoint[] = [];
  const seen = new Set<string>();
  const queue: { path: string; depth: number }[] = [{ path: relPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.path)) continue;
    seen.add(current.path);

    const meta = persisted.get(current.path);
    if (meta && ENTRYPOINT_ROLES.has(meta.frameworkRole)) {
      results.push({
        path: current.path,
        frameworkRole: meta.frameworkRole,
        productDomain: meta.productDomain,
        distance: current.depth,
      });
      if (results.length >= 8) break;
      // If we found an entrypoint, don't keep searching up from it
      continue;
    }

    if (current.depth >= maxDepth) continue;

    const importers = importedByMap.get(current.path);
    if (!importers) continue;
    for (const importer of importers) {
      if (!seen.has(importer)) queue.push({ path: importer, depth: current.depth + 1 });
    }
  }

  const byPath = new Map<string, RuntimeEntrypoint>();
  for (const r of results) {
    const existing = byPath.get(r.path);
    if (!existing || r.distance < existing.distance) byPath.set(r.path, r);
  }
  return [...byPath.values()].sort((a, b) => a.distance - b.distance);
}

export function deriveEntrypointTraceStatus(
  domain: string,
  entrypoints: RuntimeEntrypoint[],
  unresolved: string[],
  surfacePatterns: SurfacePatternMap = new Map(),
): 'complete' | 'partial' | 'partial_wrong_surface' | 'blocked_by_alias_resolution' | 'no_runtime_entrypoint_found' {
  if (entrypoints.length === 0 && unresolved.length > 0) return 'blocked_by_alias_resolution';
  if (entrypoints.length === 0) return 'no_runtime_entrypoint_found';

  const patterns = surfacePatterns.get(domain);
  if (patterns) {
    const allWrong = entrypoints.every(e =>
      patterns.wrong.some(p => p.test(e.path)) &&
      !patterns.expected.some(p => p.test(e.path))
    );
    if (allWrong) return 'partial_wrong_surface';
  }

  return unresolved.length === 0 ? 'complete' : 'partial';
}

// ── Load-bearing score (stage 8) ─────────────────────────────────────────────

export function computeLoadBearingScore(
  gravity: number,
  heat: number,
  importedByCount: number,
  sideEffectProfile: SideEffect[],
  productDomain: ProductDomain,
  smellMaxSeverity: number,
  runtimeEntrypoints: RuntimeEntrypoint[],
  adapterLoadBearingBoost?: number,
  domainTags?: string[],
): number {
  let score = 0;

  if (gravity >= 85) score += 2;
  if (heat >= 60) score += 1;
  if (runtimeEntrypoints.length >= 2) score += 2;
  if (importedByCount >= 3) score += 1;

  if (sideEffectProfile.includes('database_write')) score += 3;
  if (adapterLoadBearingBoost) score += adapterLoadBearingBoost;
  if (sideEffectProfile.includes('redirect')) score += 1;
  if (sideEffectProfile.includes('analytics_event')) score += 1;

  const highImpactDomains: string[] = [
    'booking_creation', 'booking_ui_delegate', 'payments', 'auth_oauth', 'webhooks', 'payments_webhooks',
  ];
  const effectiveDomain = domainTags?.[0] ?? productDomain;
  if (highImpactDomains.includes(effectiveDomain)) score += 2;

  if (smellMaxSeverity === 5) score += 3;

  return score;
}

// ── PageRank ──────────────────────────────────────────────────────────────────

// execution_reach: for each node, the count of distinct real-source files reachable by
// following importedBy transitively (its downstream blast radius), log-normalized to [0,1]
// across all nodes. Additive signal — see signals.ts. Feeds gravity only under VIBE_GRAVITY_V2.
function computeExecutionReach(
  nodes: string[],
  importedBy: Map<string, Iterable<string>>,
  isRealSource: Map<string, boolean>,
): Map<string, number> {
  const rawReach = new Map<string, number>();
  for (const start of nodes) {
    const visited = new Set<string>([start]);
    const queue: string[] = [start];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of (importedBy.get(u) ?? [])) {
        if (!isRealSource.get(v) || visited.has(v)) continue;
        visited.add(v);
        queue.push(v);
      }
    }
    rawReach.set(start, visited.size - 1);
  }
  let maxLogReach = 0;
  const logReach = new Map<string, number>();
  for (const [node, reach] of rawReach) {
    const logR = Math.log2(1 + reach);
    logReach.set(node, logR);
    if (logR > maxLogReach) maxLogReach = logR;
  }
  const normalized = new Map<string, number>();
  for (const [node, logR] of logReach) {
    normalized.set(node, maxLogReach > 0 ? logR / maxLogReach : 0);
  }
  return normalized;
}

function pageRank(nodes: string[], outEdges: Map<string, Set<string>>, damping = 0.85, iters = 20): Map<string, number> {
  const n = nodes.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;
  for (const node of nodes) rank.set(node, 1 / n);
  const inEdges = new Map<string, string[]>();
  for (const node of nodes) inEdges.set(node, []);
  const outCount = new Map<string, number>();
  for (const [from, tos] of outEdges) {
    const valid = [...tos].filter(t => rank.has(t));
    outCount.set(from, valid.length);
    for (const to of valid) inEdges.get(to)!.push(from);
  }
  for (let it = 0; it < iters; it++) {
    const next = new Map<string, number>();
    let dangling = 0;
    for (const node of nodes) {
      if ((outCount.get(node) || 0) === 0) dangling += rank.get(node)!;
    }
    for (const node of nodes) {
      let sum = 0;
      for (const from of inEdges.get(node)!) {
        sum += rank.get(from)! / (outCount.get(from) || 1);
      }
      next.set(node, (1 - damping) / n + damping * (sum + dangling / n));
    }
    for (const node of nodes) rank.set(node, next.get(node)!);
  }
  let max = 0;
  for (const v of rank.values()) max = Math.max(max, v);
  if (max > 0) for (const node of nodes) rank.set(node, rank.get(node)! / max);
  return rank;
}

// ── Community detection ───────────────────────────────────────────────────────

function detectCommunities(nodes: string[], adjacency: Map<string, Map<string, number>>): Map<string, number> {
  const label = new Map<string, number>();
  nodes.forEach((node, i) => label.set(node, i));
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const node of nodes) {
      const neighbors = adjacency.get(node);
      if (!neighbors || neighbors.size === 0) continue;
      const counts = new Map<number, number>();
      for (const [nb, weight] of neighbors) {
        const l = label.get(nb)!;
        counts.set(l, (counts.get(l) || 0) + weight);
      }
      let best = label.get(node)!, bestCount = -1;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && l < best)) { best = l; bestCount = c; }
      }
      if (best !== label.get(node)) { label.set(node, best); changed = true; }
    }
    if (!changed) break;
  }
  return label;
}

// ── Result type ───────────────────────────────────────────────────────────────

export interface ClassifiedFile {
  rel: string;
  abs: string;
  lang: import('../signals.js').Language;
  isRealSource: boolean;
  demoteReason: string | null;
  gravity: number;
  staticGravity: number;   // ADR-034: accepted v1 score, pre-lift (pristine import graph)
  behavioralLift: number;  // ADR-034: adapter-supplied lift (>= 0); 0 when no adapter fires
  heat: number;
  gravitySignals: GravitySignals;
  heatSignals: HeatSignals;
  smells: import('../signals.js').SmellHit[];
  pillarHint: string | null;
  importedBy: string[];
  imports: string[];
  importsUnresolved: string[];
  frameworkRole: FrameworkRole;
  productDomain: ProductDomain;
  sideEffectProfile: SideEffect[];
  writeIntents: WriteIntent[];
  riskTypes: RiskType[];
  runtimeEntrypoints: RuntimeEntrypoint[];
  entrypointTraceStatus: 'complete' | 'partial' | 'partial_wrong_surface' | 'blocked_by_alias_resolution' | 'no_runtime_entrypoint_found';
  blockedImports: string[];
  loadBearingScore: number;
  isOperationallyCritical: boolean; // ADR-019
  isLoadBearing: boolean;          // ADR-019 STRICT: fanIn >= 10
  hotSpans: HotSpan[];
  source: string;
  // ADR-034 adapter-scoped domain taxonomy (additive; present only when an
  // adapter classified the file). productDomain stays authoritative for now.
  adapterDomain?: string;
  domainTags?: string[];
  executionRole?: string;
  adapterSideEffects?: string[]; // adapter-mirrored domain side effects (additive)
  adapterPillarLabel?: string;   // adapter-mirrored pillar labels (additive)
}

export interface ClassificationResult {
  projectRoot: string;
  classified: ClassifiedFile[];
  stack: string[];
  entrypoints: Set<string>;
  map: ProjectMap;
  communities: Map<string, number>;
  adapterStage: AdapterStageResult; // ADR-034: empty when no adapters match
}


// ── Pillar building helpers ───────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function domainToGroupLabel(domain: ProductDomain): string {
  const labels: Partial<Record<ProductDomain, string>> = {
    booking_creation: 'Booking', booking_management: 'Booking', booking_audit: 'Booking Audit',
    event_type_configuration: 'Event Types', availability: 'Availability',
    auth: 'Auth', auth_oauth: 'Auth OAuth', payments: 'Payments',
    payments_webhooks: 'Payment Webhooks', webhooks: 'Webhooks',
    apps_marketplace: 'Apps', calendar_integrations: 'Calendar', video: 'Video',
    onboarding: 'Onboarding', settings: 'Settings', admin: 'Admin',
    data_table: 'Data Table', shell_navigation: 'Shell', forms: 'Forms',
    embed: 'Embed', notifications: 'Notifications',
  };
  return labels[domain] || titleCase(domain.replace(/_/g, ' '));
}

function pillarNameFromCluster(
  files: Array<{ rel: string; pillarHint: string | null }>,
): string {
  const hintCounts = new Map<string, number>();
  for (const f of files) {
    if (f.pillarHint && !f.pillarHint.startsWith('community-')) {
      hintCounts.set(f.pillarHint, (hintCounts.get(f.pillarHint) || 0) + 1);
    }
  }
  if (hintCounts.size > 0) {
    const best = [...hintCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best[1] >= files.length * 0.4) return best[0];
  }
  const dirs = files.map(f => dirname_simple(f.rel)).filter(d => d && d !== '.');
  if (dirs.length) {
    const segCounts = new Map<string, number>();
    for (const d of dirs) {
      const segments = d.split(sep).filter(s => !MEANINGLESS_SEGMENTS.has(s.toLowerCase()));
      const meaningful = segments.pop();
      if (meaningful) segCounts.set(meaningful, (segCounts.get(meaningful) || 0) + 1);
    }
    const top = [...segCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) return titleCase(top[0]);
  }
  const topFile = basename(files[0].rel, extname(files[0].rel));
  return titleCase(topFile);
}

function dirname_simple(p: string): string {
  const idx = p.lastIndexOf(sep);
  if (idx < 0) return '.';
  return p.slice(0, idx);
}

function buildPillars(
  classified: ClassifiedFile[],
  communities: Map<string, number>,
): PillarDef[] {
  const real = classified.filter(f => f.isRealSource);

  const keywordGroups = new Map<string, ClassifiedFile[]>();
  const unlabeled: ClassifiedFile[] = [];

  for (const f of real) {
    if (f.pillarHint && !f.pillarHint.startsWith('community-')) {
      if (!keywordGroups.has(f.pillarHint)) keywordGroups.set(f.pillarHint, []);
      keywordGroups.get(f.pillarHint)!.push(f);
    } else {
      unlabeled.push(f);
    }
  }

  const pillars: PillarDef[] = [];
  for (const [name, files] of keywordGroups) {
    const sorted = [...files].sort((a, b) => b.gravity - a.gravity);
    pillars.push({
      name,
      description: `${name} subsystem: ${files.length} file${files.length > 1 ? 's' : ''} centered on ${basename(sorted[0].rel)}.`,
      memberFiles: sorted.map(f => f.rel),
    });
  }

  if (unlabeled.length > 0) {
    const communityGroups = new Map<number, ClassifiedFile[]>();
    for (const f of unlabeled) {
      const c = communities.get(f.rel);
      if (c === undefined) continue;
      if (!communityGroups.has(c)) communityGroups.set(c, []);
      communityGroups.get(c)!.push(f);
    }
    const remainingSlots = Math.max(0, 6 - pillars.length);
    const sorted = [...communityGroups.entries()]
      .map(([id, files]) => ({ id, files, weight: files.reduce((s, f) => s + f.gravity, 0) }))
      .filter(g => g.files.length >= 2)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, remainingSlots);

    for (const g of sorted) {
      const top = [...g.files].sort((a, b) => b.gravity - a.gravity);
      const name = pillarNameFromCluster(top.map(f => ({ rel: f.rel, pillarHint: f.pillarHint })));
      const existing = pillars.find(p => p.name === name);
      if (existing) {
        existing.memberFiles.push(...top.map(f => f.rel));
        existing.description = `${name} subsystem: ${existing.memberFiles.length} files.`;
      } else {
        pillars.push({
          name,
          description: `${g.files.length} files centered on ${basename(top[0].rel)}.`,
          memberFiles: top.map(f => f.rel),
        });
      }
    }
  }

  pillars.sort((a, b) => {
    const gravA = real.filter(f => a.memberFiles.includes(f.rel)).reduce((s, f) => s + f.gravity, 0);
    const gravB = real.filter(f => b.memberFiles.includes(f.rel)).reduce((s, f) => s + f.gravity, 0);
    return gravB - gravA;
  });

  if (pillars.length === 0 && real.length > 0) {
    pillars.push({ name: 'Core', description: 'Primary application code.', memberFiles: real.slice(0, 20).map(f => f.rel) });
  }

  // Subdivide mega-pillars (>15 files)
  const finalPillars: PillarDef[] = [];
  for (const p of pillars) {
    if (p.memberFiles.length > 15) {
      const groups = new Map<string, string[]>();
      for (const rel of p.memberFiles) {
        const f = classified.find(c => c.rel === rel);
        const role = f?.frameworkRole || 'unknown';
        const domain = f?.domainTags?.[0] ?? f?.productDomain ?? 'unknown';
        let bucket: string;
        if (domain !== 'unknown' && domain !== 'routing_infrastructure' && domain !== 'test_infrastructure' && domain !== 'generated_noise') {
          bucket = f?.adapterPillarLabel ?? domainToGroupLabel(domain as ProductDomain);
        } else if (role === 'hook') {
          bucket = 'Hooks';
        } else if (['app_route_page', 'app_route_handler', 'app_route_layout', 'pages_route', 'pages_api_route', 'trpc_api_route'].includes(role)) {
          bucket = 'Routes';
        } else if (role === 'component') {
          bucket = 'Components';
        } else {
          bucket = 'Logic';
        }
        const key = `${p.name} (${bucket})`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(rel);
      }
      for (const [key, files] of groups) {
        if (files.length > 0) finalPillars.push({ name: key, description: `Subdivided from ${p.name}`, memberFiles: files });
      }
    } else {
      finalPillars.push(p);
    }
  }

  // Ensure unique names
  const seen = new Set<string>();
  for (const p of finalPillars) {
    let n = p.name, i = 2;
    while (seen.has(n)) { n = `${p.name} ${i++}`; }
    p.name = n; seen.add(n);
  }

  return finalPillars;
}

// ── Main stage implementation ─────────────────────────────────────────────────

export async function runClassification(
  projectRoot: string,
  inv: InventoryResult,
  res: ResolutionResult,
): Promise<ClassificationResult> {
  const { work, entrypoints } = inv;
  const { importedBy, importsResolved, importsUnresolved, fanOut } = res;

  // isRealSource determination
  const isRealSource = new Map<string, boolean>();
  const demoteReason = new Map<string, string | null>();
  for (const w of work) {
    if (w.pathDemote) { isRealSource.set(w.rel, false); demoteReason.set(w.rel, w.pathDemote); }
    else { isRealSource.set(w.rel, true); demoteReason.set(w.rel, null); }
  }
  for (const w of work) {
    if (!isRealSource.get(w.rel)) continue;
    if (entrypoints.has(w.rel)) continue;
    const inbound = [...(importedBy.get(w.rel) || [])].filter(src => isRealSource.get(src));
    if (inbound.length === 0) {
      isRealSource.set(w.rel, false);
      demoteReason.set(w.rel, 'no inbound references from application code');
    }
  }

  // PageRank
  const realNodes = work.filter(w => isRealSource.get(w.rel)).map(w => w.rel);
  const realSet = new Set(realNodes);
  const outEdges = new Map<string, Set<string>>();
  const undirected = new Map<string, Map<string, number>>();
  for (const node of realNodes) { outEdges.set(node, new Set()); undirected.set(node, new Map()); }
  for (const w of work) {
    if (!realSet.has(w.rel)) continue;
    for (const target of (importsResolved.get(w.rel) || new Set<string>())) {
      if (!realSet.has(target)) continue;
      outEdges.get(w.rel)!.add(target);
      const wDir = w.rel.split(sep)[0];
      const tDir = target.split(sep)[0];
      const weight = wDir === tDir ? 1.0 : 0.5;
      undirected.get(w.rel)!.set(target, weight);
      undirected.get(target)!.set(w.rel, weight);
    }
  }
  const ranks = pageRank(realNodes, outEdges);
  const communities = detectCommunities(realNodes, undirected);

  // execution_reach: transitive downstream blast radius over the real-source import graph.
  // BFS from each node following importedBy (who depends on me, transitively). Log-normalized to [0,1].
  // Always computed (additive signal); only feeds gravity when VIBE_GRAVITY_V2 is enabled.
  const executionReachByFile = computeExecutionReach(realNodes, importedBy, isRealSource);
  const gravityV2 = process.env.VIBE_GRAVITY_V2 === '1';
  // v2 normalization denominators (max log2 across real source) — only needed for the v2 path.
  let maxLog2FanIn = 0;
  let maxLog2Cyclomatic = 0;
  if (gravityV2) {
    for (const w of work) {
      if (!isRealSource.get(w.rel)) continue;
      const fanIn = [...(importedBy.get(w.rel) || [])].filter(src => isRealSource.get(src)).length;
      maxLog2FanIn = Math.max(maxLog2FanIn, Math.log2(fanIn + 1));
      maxLog2Cyclomatic = Math.max(maxLog2Cyclomatic, Math.log2(w.ast.cyclomatic + 1));
    }
  }

  // Build quick lookup for entrypoint tracing
  const metaLookup = new Map<string, { frameworkRole: FrameworkRole; productDomain: ProductDomain }>();

  // Stage 5+6: side effects and write intents per file
  const sideEffectsByFile = new Map<string, SideEffect[]>();
  const writeIntentsByFile = new Map<string, WriteIntent[]>();
  for (const w of work) {
    const effects = inferSideEffectProfile(w.source, w.importSpecs, w.productDomain, w.frameworkRole);
    sideEffectsByFile.set(w.rel, effects);
    writeIntentsByFile.set(w.rel, inferGenericWriteIntents(effects));
    metaLookup.set(w.rel, { frameworkRole: w.frameworkRole, productDomain: w.productDomain });
  }

  // Stage 7 pass 1: compute all non-cross-file risk types
  const riskTypesByFile = new Map<string, RiskType[]>();

  // Compute gravity and heat first (needed for risk type thresholds)
  const gravityByFile = new Map<string, number>();
  const heatByFile = new Map<string, number>();
  const fanInByFile = new Map<string, number>();
  const centralityByFile = new Map<string, number>();
  const gravitySignalsByFile = new Map<string, GravitySignals>();

  for (const w of work) {
    const real = isRealSource.get(w.rel)!;
    const fanIn = [...(importedBy.get(w.rel) || [])].filter(src => isRealSource.get(src)).length;
    const centrality = real ? (ranks.get(w.rel) || 0) : 0;
    const executionReach = executionReachByFile.get(w.rel) ?? 0;
    const gs: GravitySignals = {
      fanIn, fanOut: fanOut.get(w.rel) || 0, centrality,
      cyclomatic: w.ast.cyclomatic, publicSurface: w.ast.publicSurface, loc: w.ast.loc,
      executionReach,
    };

    let gravity: number;
    if (gravityV2) {
      // Gravity v2 candidate (Phase 0). Non-default — experimental scoring variant.
      const fanInNorm = maxLog2FanIn > 0 ? Math.log2(fanIn + 1) / maxLog2FanIn : 0;
      const cyclomaticNorm = maxLog2Cyclomatic > 0 ? Math.log2(w.ast.cyclomatic + 1) / maxLog2Cyclomatic : 0;
      let gravityRaw = centrality * 0.45
        + fanInNorm * 0.35
        + executionReach * 0.15
        + cyclomaticNorm * 0.05;
      if (!real) gravityRaw *= 0.2;
      gravity = Math.max(0, Math.min(100, gravityRaw * 100));
    } else {
      // Accepted default formula (verified). Do not change without re-verification.
      const depthRatio = (w.ast.cyclomatic + w.ast.maxNesting * 2) / Math.max(1, w.ast.publicSurface);
      const depthFactor = Math.min(1.0, Math.log2(depthRatio + 1) / 3);
      const adjustedCentrality = centrality * (0.3 + 0.7 * depthFactor);

      let gravityRaw = adjustedCentrality * 50
        + Math.log2(fanIn + 1) * 6
        + Math.log2(w.ast.cyclomatic + 1) * 7
        + Math.log2(w.ast.publicSurface + 1) * 2
        + (w.ast.maxNesting >= 4 ? 5 : 0);
      if (!real) gravityRaw *= 0.2;
      gravity = Math.max(0, Math.min(100, gravityRaw));
    }
    const heat = real ? computeHeat(w.ast.smells) : 0;

    gravityByFile.set(w.rel, gravity);
    heatByFile.set(w.rel, heat);
    fanInByFile.set(w.rel, fanIn);
    centralityByFile.set(w.rel, centrality);
    gravitySignalsByFile.set(w.rel, gs);
  }

  for (const w of work) {
    const gs = gravitySignalsByFile.get(w.rel)!;
    const smellKinds = new Set(w.ast.smells.map(s => s.kind));
    const effects = sideEffectsByFile.get(w.rel)!;
    const types = inferRiskTypesPass1(w.rel, w.frameworkRole, w.productDomain, effects, gs, smellKinds);
    riskTypesByFile.set(w.rel, types);
  }

  // Stage 7 pass 2: cross-file registry_consumer + type_boundary_leak
  for (const w of work) {
    if (
      w.productDomain === 'forms' &&
      (w.frameworkRole === 'component' || w.frameworkRole === 'hook')
    ) {
      const importsResolved_w = importsResolved.get(w.rel) || new Set<string>();
      const importsAny = [...importsResolved_w, ...w.importSpecs.filter(s => s.startsWith('@'))];
      const consumesBottleneck = importsAny.some(dep => {
        const types = riskTypesByFile.get(dep);
        return types?.includes('registry_bottleneck');
      });
      if (consumesBottleneck) {
        const existing = riskTypesByFile.get(w.rel)!;
        if (!existing.includes('registry_consumer')) existing.push('registry_consumer');
        if (!existing.includes('type_boundary_leak')) existing.push('type_boundary_leak');
        // Remove complexity_hotspot if present (it's a catch-all fallback)
        const idx = existing.indexOf('complexity_hotspot');
        if (idx >= 0) existing.splice(idx, 1);
      }
    }
    // Apply catch-all fallback if no specific types
    const types = riskTypesByFile.get(w.rel)!;
    if (types.length === 0) types.push('complexity_hotspot');
  }

  // ── Adapter interpretation seam (ADR-034 §4) ────────────────────────────────
  // Runs AFTER staticGravity is assembled and BEFORE stage-8 entrypoint tracing
  // and the topGravity/pillars freeze — so adapter-supplied surface patterns
  // reach deriveEntrypointTraceStatus and behavioralLift can influence the map.
  // With zero adapters this is a pure no-op (identity result, empty patterns).
  const adapterCtx: AdapterContext = {
    projectRoot,
    files: work.map(w => ({
      rel: w.rel, lang: w.lang, isRealSource: isRealSource.get(w.rel)!,
      frameworkRole: w.frameworkRole, productDomain: w.productDomain,
      staticGravity: gravityByFile.get(w.rel)!, gravitySignals: gravitySignalsByFile.get(w.rel)!,
      heatSignals: {
        todos: w.ast.smells.filter(s => s.kind === 'todo').length,
        suppressions: w.ast.smells.filter(s => s.kind === 'suppression').length,
        swallowedCatches: w.ast.swallowedCatches,
        maxNesting: w.ast.maxNesting,
        longFunctions: w.ast.longFunctions,
        magicNumbers: w.ast.magicNumbers,
      },
      sideEffectProfile: sideEffectsByFile.get(w.rel)!,
      importSpecs: w.importSpecs,
      source: w.source,
    })),
  };
  const adapterStage = adapterRegistry.runStage(adapterCtx);

  // Collapse adapter surface patterns into a domain -> { expected, wrong } map
  // for deriveEntrypointTraceStatus (ADR-006 behavior, now adapter-supplied).
  const surfacePatterns: SurfacePatternMap = new Map();
  for (const p of adapterStage.surfacePatterns) {
    surfacePatterns.set(p.domain, { expected: p.expected, wrong: p.wrong });
  }

  // Merge core-generic write intents with adapter-supplied domain intents
  // (ADR-034). Runs for every file: empty adapter contribution ⇒ generic only.
  // The none_detected sentinel is applied here, after the merge.
  for (const w of work) {
    const generic = writeIntentsByFile.get(w.rel) ?? [];
    const fromAdapter = (adapterStage.writeIntentsByFile.get(w.rel) ?? []) as WriteIntent[];
    const merged = [...new Set<WriteIntent>([...generic, ...fromAdapter])];
    writeIntentsByFile.set(w.rel, merged.length > 0 ? merged : ['none_detected']);
  }

  // Snapshot the pristine static gravity BEFORE any lift is applied, so it can
  // be persisted alongside the lifted score (ADR-034 §2). This is the honest
  // proof field: staticGravity + behavioralLift == final gravity (pre-clamp).
  const staticGravityByFile = new Map(gravityByFile);

  if (adapterStage.firedAdapterIds.length > 0) {
    console.error(`[vibe-splain] adapters fired: ${adapterStage.firedAdapterIds.join(', ')}`);
    // Apply behavioralLift to staticGravity before stage-8 reads it.
    // gravity = max(staticGravity, min(100, staticGravity + lift)); lift never demotes.
    for (const w of work) {
      const lift = adapterStage.liftByFile.get(w.rel) ?? 0;
      if (lift > 0) {
        const staticGravity = gravityByFile.get(w.rel)!;
        gravityByFile.set(w.rel, Math.max(staticGravity, Math.min(100, staticGravity + lift)));
      }
    }
  }

  // Stage 8: entrypoint tracing + load bearing per file
  const classified: ClassifiedFile[] = [];

  for (const w of work) {
    const real = isRealSource.get(w.rel)!;
    const fanIn = fanInByFile.get(w.rel)!;
    const gravity = gravityByFile.get(w.rel)!;
    const heat = heatByFile.get(w.rel)!;
    const gs = gravitySignalsByFile.get(w.rel)!;
    const effects = sideEffectsByFile.get(w.rel)!;
    const writeIntents = writeIntentsByFile.get(w.rel)!;
    const riskTypes = riskTypesByFile.get(w.rel)!;

    const hs: HeatSignals = {
      todos: w.ast.smells.filter(s => s.kind === 'todo').length,
      suppressions: w.ast.smells.filter(s => s.kind === 'suppression').length,
      swallowedCatches: w.ast.swallowedCatches,
      maxNesting: w.ast.maxNesting,
      longFunctions: w.ast.longFunctions,
      magicNumbers: w.ast.magicNumbers,
    };

    const keywordPillar = matchPillarByImports(w.importSpecs);
    const pathPillar = matchPillarByPath(w.rel);
    const pillarHint = real ? (keywordPillar || pathPillar || `community-${communities.get(w.rel)}`) : null;

    const importedByReal = [...(importedBy.get(w.rel) || [])].filter(src => isRealSource.get(src));
    const imports = [...(importsResolved.get(w.rel) || new Set<string>())];
    const importsUnresolvedArr = [...(importsUnresolved.get(w.rel) || new Set<string>())];

    const runtimeEntrypoints = findRuntimeEntrypoints(w.rel, importedBy, metaLookup);
    
    // ADR-034 compatibility-mode domain taxonomy (additive). Present only when
    // an adapter classified this file; productDomain stays authoritative.
    const adapterCls = adapterStage.classificationByFile.get(w.rel);
    const effectiveDomain = adapterCls?.domainTags?.[0] ?? w.productDomain;

    const entrypointTraceStatus = deriveEntrypointTraceStatus(effectiveDomain, runtimeEntrypoints, importsUnresolvedArr, surfacePatterns);

    const smellMaxSeverity = w.ast.smells.length > 0 ? Math.max(...w.ast.smells.map(s => s.severity)) : 0;
    const loadBearingScore = computeLoadBearingScore(
      gravity, heat, fanIn, effects, w.productDomain, smellMaxSeverity, runtimeEntrypoints,
      adapterStage.loadBearingBoostByFile.get(w.rel),
      adapterCls?.domainTags,
    );

    // ADR-019 STRICT definitions
    const isLoadBearing = fanIn >= 10;
    const isOperationallyCritical = loadBearingScore >= 5;

    const staticGravity = staticGravityByFile.get(w.rel)!;
    const behavioralLift = adapterStage.liftByFile.get(w.rel) ?? 0;

    classified.push({
      rel: w.rel, abs: w.abs, lang: w.lang,
      isRealSource: real, demoteReason: demoteReason.get(w.rel) || null,
      gravity, staticGravity, behavioralLift, heat, gravitySignals: gs, heatSignals: hs,
      smells: w.ast.smells, pillarHint,
      importedBy: importedByReal, imports, importsUnresolved: importsUnresolvedArr,
      frameworkRole: w.frameworkRole, productDomain: w.productDomain,
      sideEffectProfile: effects, writeIntents, riskTypes,
      runtimeEntrypoints, entrypointTraceStatus,
      blockedImports: importsUnresolvedArr,
      loadBearingScore,
      isOperationallyCritical,
      isLoadBearing,
      hotSpans: w.ast.hotSpans, source: w.source,
      adapterDomain: adapterCls?.adapterDomain,
      domainTags: adapterCls?.domainTags,
      executionRole: adapterCls?.executionRole,
      adapterSideEffects: adapterStage.sideEffectsByFile.get(w.rel),
      adapterPillarLabel: adapterStage.pillarLabelsByFile.get(w.rel),
    });
  }

  // Write stage artifacts
  const dir = join(projectRoot, '.vibe-splainer');
  await mkdir(dir, { recursive: true });

  const stage05 = Object.fromEntries(classified.map(f => [f.rel, f.sideEffectProfile]));
  await writeFile(join(dir, 'stage-05-side-effects.json'), JSON.stringify(stage05, null, 2), 'utf8');

  const stage06 = Object.fromEntries(classified.map(f => [f.rel, f.writeIntents]));
  await writeFile(join(dir, 'stage-06-write-intents.json'), JSON.stringify(stage06, null, 2), 'utf8');

  const stage07 = Object.fromEntries(classified.map(f => [f.rel, f.riskTypes]));
  await writeFile(join(dir, 'stage-07-risk-types.json'), JSON.stringify(stage07, null, 2), 'utf8');

  const stage08 = Object.fromEntries(classified.map(f => [f.rel, {
    isLoadBearing: f.isLoadBearing,
    isOperationallyCritical: f.isOperationallyCritical,
    loadBearingScore: f.loadBearingScore,
    runtimeEntrypoints: f.runtimeEntrypoints.length,
    entrypointTraceStatus: f.entrypointTraceStatus,
  }]));
  await writeFile(join(dir, 'stage-08-load-bearing.json'), JSON.stringify(stage08, null, 2), 'utf8');

  // Build ProjectMap
  const realClassified = classified.filter(f => f.isRealSource).sort((a, b) => b.gravity - a.gravity);
  const wildCandidates = realClassified.filter(f => f.heat >= 60 || f.smells.some(s => s.severity >= 4));
  const pillars = buildPillars(classified, communities);

  const map: ProjectMap = {
    stack: inv.stack,
    entrypoints: [...entrypoints],
    pillars,
    fileCount: work.length,
    realSourceCount: realClassified.length,
    topGravity: realClassified.slice(0, 12).map(f => f.rel),
    topHeat: wildCandidates.slice(0, 12).map(f => f.rel),
    brief: null,
  };

  return { projectRoot, classified, stack: inv.stack, entrypoints, map, communities, adapterStage };
}
