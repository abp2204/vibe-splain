import { join, basename, extname, sep } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import type {
  GravitySignals, HeatSignals,
  FrameworkRole, ProductDomain, SideEffect, RiskType, RuntimeEntrypoint,
} from '../signals.js';
import type { HotSpan, WriteIntent, DeltaTarget } from '../analysis.js';
import type { PillarDef, ProjectMap } from '../dossier.js';
import { computeHeat, matchPillarByImports, matchPillarByPath, MEANINGLESS_SEGMENTS } from './inventory.js';
import type { InventoryResult } from './inventory.js';
import type { ResolutionResult } from './resolution.js';

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

  // Booking mutation — expanded to tRPC useMutation in booking domain
  if (
    /createBooking|handleNewBooking|cancelBooking|rescheduleBooking|handleBooking|createRecurring/.test(source) ||
    (productDomain === 'booking_creation' && /useMutation\b|\.mutate\b|\.mutateAsync\b/.test(source))
  ) effects.add('booking_mutation');

  // Webhook ingress — expanded
  if (
    /stripe\.webhooks\.(constructEvent|constructEventAsync)|webhookSecret|validateWebhook|verifyWebhook|verifySignature/.test(source) ||
    (productDomain === 'payments_webhooks' && frameworkRole === 'pages_api_route')
  ) effects.add('webhook_ingress');

  // Payment mutation — also fires when webhook confirmed
  if (
    importSpecs.some(s => /stripe|paypal|btcpay|alby/.test(s.toLowerCase())) ||
    /stripe\.|paymentIntent|createPaymentIntent|confirmPayment|createCharge/.test(source) ||
    (productDomain === 'payments_webhooks' && effects.has('webhook_ingress'))
  ) effects.add('payment_mutation');

  if (/signIn\b|signOut\b|createSession|destroySession|issueToken|refreshToken|getToken/.test(source)) {
    effects.add('auth_token_mutation');
  }

  if (/triggerWebhook|sendWebhook|webhook\.send\b/.test(source)) effects.add('webhook_delivery');

  if (
    /sendEmail|sendMail\b|mailer\./.test(source) ||
    importSpecs.some(s => /nodemailer|resend|sendgrid|postmark|mailgun/.test(s))
  ) effects.add('email_send');

  if (/createCalendarEvent|updateCalendarEvent|deleteCalendarEvent|calendar\.events\.(insert|update|delete|patch)/.test(source)) {
    effects.add('calendar_mutation');
  }

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

export function inferWriteIntents(
  productDomain: ProductDomain,
  relPath: string,
  sideEffectProfile: SideEffect[],
): WriteIntent[] {
  const intents: WriteIntent[] = [];

  if (productDomain === 'booking_creation') {
    intents.push('create_booking');
    if (relPath.includes('reschedule') || relPath.includes('Reschedule')) intents.push('reschedule_booking');
    if (relPath.includes('recurring') || relPath.includes('Recurring')) intents.push('create_recurring_booking');
  }
  if (productDomain === 'booking_management') intents.push('cancel_booking');
  if (productDomain === 'event_type_configuration') intents.push('update_event_type');
  if (productDomain === 'availability') intents.push('update_availability');
  if (productDomain === 'payments') intents.push('create_payment');
  if (productDomain === 'payments_webhooks') intents.push('handle_payment_webhook');
  if (productDomain === 'auth_oauth') {
    intents.push('issue_auth_token');
    intents.push('refresh_auth_token');
  }
  if (sideEffectProfile.includes('webhook_delivery')) intents.push('send_webhook');
  if (productDomain === 'settings') intents.push('update_user_settings');
  if (sideEffectProfile.includes('local_storage') || sideEffectProfile.includes('indexed_db')) {
    intents.push('persist_local_state');
  }

  return intents.length > 0 ? intents : ['none_detected'];
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
    sideEffectProfile.some(s => ['booking_mutation', 'payment_mutation', 'auth_token_mutation'].includes(s)) &&
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

const DOMAIN_SURFACE_PATTERNS: Partial<Record<ProductDomain, { expected: RegExp[]; wrong: RegExp[] }>> = {
  booking_creation: {
    expected: [/book/i, /booking/i, /reschedule/i, /booking-success/i, /api\/book/i, /create-booking/i],
    wrong: [/event-type/i, /event-types/i, /eventtypes/i, /availability/i, /schedule/i],
  },
  payments_webhooks: {
    expected: [/webhook/i, /stripe/i, /payment/i],
    wrong: [/settings/i, /onboarding/i, /profile/i],
  },
  auth_oauth: {
    expected: [/oauth/i, /callback/i, /auth/i, /signin/i, /login/i],
    wrong: [/booking/i, /payment/i, /settings/i],
  },
};

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

    if (current.path !== relPath) {
      const meta = persisted.get(current.path);
      if (meta && ENTRYPOINT_ROLES.has(meta.frameworkRole)) {
        results.push({
          path: current.path,
          frameworkRole: meta.frameworkRole,
          productDomain: meta.productDomain,
          distance: current.depth,
        });
        if (results.length >= 8) break;
        continue;
      }
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
  domain: ProductDomain,
  entrypoints: RuntimeEntrypoint[],
  unresolved: string[],
): DeltaTarget['entrypointTraceStatus'] {
  if (entrypoints.length === 0 && unresolved.length > 0) return 'blocked_by_alias_resolution';
  if (entrypoints.length === 0) return 'no_runtime_entrypoint_found';

  const patterns = DOMAIN_SURFACE_PATTERNS[domain];
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
): number {
  let score = 0;

  if (gravity >= 85) score += 2;
  if (heat >= 60) score += 1;
  if (runtimeEntrypoints.length >= 2) score += 2;
  if (importedByCount >= 3) score += 1;

  if (sideEffectProfile.includes('database_write')) score += 3;
  if (sideEffectProfile.includes('booking_mutation')) score += 3;
  if (sideEffectProfile.includes('payment_mutation')) score += 3;
  if (sideEffectProfile.includes('auth_token_mutation')) score += 3;
  if (sideEffectProfile.includes('webhook_delivery')) score += 2;
  if (sideEffectProfile.includes('webhook_ingress')) score += 2;
  if (sideEffectProfile.includes('calendar_mutation')) score += 2;
  if (sideEffectProfile.includes('redirect')) score += 1;
  if (sideEffectProfile.includes('analytics_event')) score += 1;

  const highImpactDomains: ProductDomain[] = [
    'booking_creation', 'payments', 'auth_oauth', 'webhooks', 'payments_webhooks',
  ];
  if (highImpactDomains.includes(productDomain)) score += 2;

  if (smellMaxSeverity === 5) score += 3;

  return score;
}

// ── PageRank ──────────────────────────────────────────────────────────────────

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
  entrypointTraceStatus: DeltaTarget['entrypointTraceStatus'];
  blockedImports: string[];
  loadBearingScore: number;
  hotSpans: HotSpan[];
  source: string;
}

export interface ClassificationResult {
  projectRoot: string;
  classified: ClassifiedFile[];
  stack: string[];
  entrypoints: Set<string>;
  map: ProjectMap;
  communities: Map<string, number>;
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
        const domain = f?.productDomain || 'unknown';
        let bucket: string;
        if (domain !== 'unknown' && domain !== 'routing_infrastructure' && domain !== 'test_infrastructure' && domain !== 'generated_noise') {
          bucket = domainToGroupLabel(domain as ProductDomain);
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

  // Build quick lookup for entrypoint tracing
  const metaLookup = new Map<string, { frameworkRole: FrameworkRole; productDomain: ProductDomain }>();

  // Stage 5+6: side effects and write intents per file
  const sideEffectsByFile = new Map<string, SideEffect[]>();
  const writeIntentsByFile = new Map<string, WriteIntent[]>();
  for (const w of work) {
    const effects = inferSideEffectProfile(w.source, w.importSpecs, w.productDomain, w.frameworkRole);
    sideEffectsByFile.set(w.rel, effects);
    writeIntentsByFile.set(w.rel, inferWriteIntents(w.productDomain, w.rel, effects));
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
    const gs: GravitySignals = {
      fanIn, fanOut: fanOut.get(w.rel) || 0, centrality,
      cyclomatic: w.ast.cyclomatic, publicSurface: w.ast.publicSurface, loc: w.ast.loc,
    };

    const depthRatio = (w.ast.cyclomatic + w.ast.maxNesting * 2) / Math.max(1, w.ast.publicSurface);
    const depthFactor = Math.min(1.0, Math.log2(depthRatio + 1) / 3);
    const adjustedCentrality = centrality * (0.3 + 0.7 * depthFactor);

    let gravityRaw = adjustedCentrality * 50
      + Math.log2(fanIn + 1) * 6
      + Math.log2(w.ast.cyclomatic + 1) * 7
      + Math.log2(w.ast.publicSurface + 1) * 2
      + (w.ast.maxNesting >= 4 ? 5 : 0);
    if (!real) gravityRaw *= 0.2;
    const gravity = Math.max(0, Math.min(100, gravityRaw));
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
    const entrypointTraceStatus = deriveEntrypointTraceStatus(w.productDomain, runtimeEntrypoints, importsUnresolvedArr);

    const smellMaxSeverity = w.ast.smells.length > 0 ? Math.max(...w.ast.smells.map(s => s.severity)) : 0;
    const loadBearingScore = computeLoadBearingScore(
      gravity, heat, fanIn, effects, w.productDomain, smellMaxSeverity, runtimeEntrypoints,
    );

    classified.push({
      rel: w.rel, abs: w.abs, lang: w.lang,
      isRealSource: real, demoteReason: demoteReason.get(w.rel) || null,
      gravity, heat, gravitySignals: gs, heatSignals: hs,
      smells: w.ast.smells, pillarHint,
      importedBy: importedByReal, imports, importsUnresolved: importsUnresolvedArr,
      frameworkRole: w.frameworkRole, productDomain: w.productDomain,
      sideEffectProfile: effects, writeIntents, riskTypes,
      runtimeEntrypoints, entrypointTraceStatus,
      blockedImports: importsUnresolvedArr,
      loadBearingScore, hotSpans: w.ast.hotSpans, source: w.source,
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
    isLoadBearing: f.loadBearingScore >= 5,
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

  return { projectRoot, classified, stack: inv.stack, entrypoints, map, communities };
}
