import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { makeTmpDir, cleanTmpDir, assert } from './helpers.js';
import { handleScanProject } from '../src/mcp/tools/scan_project.js';
import { initParser, readAnalysis, buildEscalationContext, buildGateIndex, type AnalysisStore, type GateIndex } from '@vibe-splain/brain';
import { decidePreToolUse } from '../src/hook/preToolUse.js';
import { runHookCommand } from '../src/commands/hook.js';
import { addPreToolUseHook } from '../src/commands/install.js';

// A realistic fixture: an entrypoint (src/index.ts) roots a real-source graph so
// nothing demotes. `core.ts` is a high-gravity hub (9 dependents); consumers are
// low-gravity leaves. `auth-service.ts` is a security-sensitive path.
async function buildFixture(): Promise<{ tmp: string; store: AnalysisStore }> {
  const tmp = makeTmpDir();
  const src = join(tmp, 'src');
  await mkdir(src, { recursive: true });

  await writeFile(join(src, 'core.ts'), `
    export function a(x:number){ if(x>0){for(let i=0;i<x;i++){if(i%2)return i;}} return x>1?1:0; }
    export function b(x:number){ try{ if(x)return x; }catch(e){} return x&&1||0; }
    export function c(x:number){ switch(x){case 1:return 1;case 2:return 2;default:return 0;} }
    export const e=1; export const f=2;`, 'utf8');

  // auth-service is a security-sensitive path; every consumer imports it, so it
  // also becomes a high-blast hub (security + high gravity in one file).
  await writeFile(join(src, 'auth-service.ts'),
    `import { a } from './core';\nexport function login(){ return a(1); }`, 'utf8');

  let idx = '';
  for (let i = 0; i < 8; i++) {
    await writeFile(join(src, `consumer${i}.ts`),
      `import { a, b, c } from './core';\nimport { login } from './auth-service';\nexport function run${i}(){ return a(1)+b(2)+c(3)+login(); }`, 'utf8');
    idx += `import { run${i} } from './consumer${i}';\n`;
  }
  idx += `import { login } from './auth-service';\n`;
  idx += `export function main(){ return ${Array.from({ length: 8 }, (_, i) => `run${i}()`).join('+')}+login(); }`;
  await writeFile(join(src, 'index.ts'), idx, 'utf8');

  await writeFile(join(tmp, 'package.json'),
    JSON.stringify({ name: 'fixture', main: 'src/index.ts', dependencies: {} }), 'utf8');

  await handleScanProject({ projectRoot: tmp }, { watch: false });
  const store = await readAnalysis(tmp);
  assert(store !== null, 'fixture scan should produce an analysis store');
  return { tmp, store: store! };
}

// A second fixture whose hub lands in the MEDIUM band: a low-complexity,
// single-export hub imported by 8 consumers scores ~65 gravity (medium), vs the
// high-complexity hub in buildFixture which scores ~98 (high).
async function buildMediumFixture(): Promise<{ tmp: string; store: AnalysisStore }> {
  const tmp = makeTmpDir();
  const src = join(tmp, 'src');
  await mkdir(src, { recursive: true });
  await writeFile(join(src, 'hub.ts'), `export function a(x:number){return x>0?1:0;} export const e=1;`, 'utf8');
  let idx = '';
  for (let i = 0; i < 8; i++) {
    await writeFile(join(src, `consumer${i}.ts`),
      `import { a } from './hub';\nexport function run${i}(){ return a(1); }`, 'utf8');
    idx += `import { run${i} } from './consumer${i}';\n`;
  }
  idx += `export function main(){ return ${Array.from({ length: 8 }, (_, i) => `run${i}()`).join('+')}; }`;
  await writeFile(join(src, 'index.ts'), idx, 'utf8');
  await writeFile(join(tmp, 'package.json'),
    JSON.stringify({ name: 'mid-fixture', main: 'src/index.ts', dependencies: {} }), 'utf8');
  await handleScanProject({ projectRoot: tmp }, { watch: false });
  const store = await readAnalysis(tmp);
  assert(store !== null, 'medium fixture scan should produce a store');
  return { tmp, store: store! };
}

function editInput(filePath: string) {
  return { tool_name: 'Edit', tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' } };
}

// ── Behavior 1 (tracer): high-blast file escalates to `ask` and names dependents ──
async function highBlastAsksAndNamesDependents() {
  const { tmp, store } = await buildFixture();
  try {
    const result = decidePreToolUse(editInput('src/core.ts'), buildGateIndex(store));
    assert(result.action === 'emit', `high-blast edit should emit a decision, got ${result.action}`);
    if (result.action !== 'emit') return;
    assert(result.output.hookSpecificOutput.permissionDecision === 'ask',
      `high-blast should ask, got ${result.output.hookSpecificOutput.permissionDecision}`);
    const reason = result.output.hookSpecificOutput.permissionDecisionReason || '';
    assert(/depend/i.test(reason), `reason should mention dependents; got: ${reason}`);
    assert(reason.includes('consumer') , `reason should name a real dependent file; got: ${reason}`);
    console.log('[test_pretooluse_hook] PASS: high-blast → ask + names dependents');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 2: low-blast (leaf) file defers — no friction on safe edits ──
async function lowBlastDefers() {
  const { tmp, store } = await buildFixture();
  try {
    const result = decidePreToolUse(editInput('src/consumer0.ts'), buildGateIndex(store));
    assert(result.action === 'defer', `low-blast edit should defer, got ${result.action}`);
    console.log('[test_pretooluse_hook] PASS: low-blast → defer');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 3: non-edit tool defers even when a file_path is present ──
async function nonEditToolDefers() {
  const { tmp, store } = await buildFixture();
  try {
    // A tool that is not Edit/Write/MultiEdit must never trip the gate, even if
    // it happens to carry a file_path pointing at a high-blast file.
    const bash = { tool_name: 'Bash', tool_input: { file_path: 'src/core.ts', command: 'cat src/core.ts' } };
    const result = decidePreToolUse(bash, buildGateIndex(store));
    assert(result.action === 'defer', `non-edit tool should defer, got ${result.action}`);
    console.log('[test_pretooluse_hook] PASS: non-edit tool → defer');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 4: a brand-new file (not in the scan) defers ──
async function newFileDefers() {
  const { tmp, store } = await buildFixture();
  try {
    const result = decidePreToolUse(editInput('src/brand-new-file.ts'), buildGateIndex(store));
    assert(result.action === 'defer', `unknown file should defer, got ${result.action}`);
    console.log('[test_pretooluse_hook] PASS: new file → defer');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 5: no scan artifact → never gates (gate is opt-in on a scanned repo) ──
async function noStoreDefers() {
  const result = decidePreToolUse(editInput('src/core.ts'), null);
  assert(result.action === 'defer', `null store should defer, got ${result.action}`);
  console.log('[test_pretooluse_hook] PASS: no store → defer');
}

// ── Behavior 6: an absolute file_path (what Claude Code actually sends) resolves
//    to the repo-relative scan key and still gates ──
async function absolutePathResolvesAndGates() {
  const { tmp, store } = await buildFixture();
  try {
    const abs = join(tmp, 'src', 'core.ts');
    const result = decidePreToolUse(editInput(abs), buildGateIndex(store));
    assert(result.action === 'emit', `absolute high-blast path should emit, got ${result.action}`);
    if (result.action !== 'emit') return;
    assert(result.output.hookSpecificOutput.permissionDecision === 'ask', 'absolute high-blast path should ask');
    console.log('[test_pretooluse_hook] PASS: absolute path → resolves + gates');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 7: editing a security-sensitive path surfaces a security warning ──
async function securityPathSurfacesWarning() {
  const { tmp, store } = await buildFixture();
  try {
    const result = decidePreToolUse(editInput('src/auth-service.ts'), buildGateIndex(store));
    assert(result.action === 'emit', `security high-blast file should emit, got ${result.action}`);
    if (result.action !== 'emit') return;
    const block = result.output.hookSpecificOutput.additionalContext || '';
    assert(/security-sensitive/i.test(block), `block should carry a security warning; got: ${block}`);
    console.log('[test_pretooluse_hook] PASS: security path → security warning surfaced');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 8: medium-blast file allows (non-blocking) but injects context ──
async function mediumBlastAllowsWithContext() {
  const { tmp, store } = await buildMediumFixture();
  try {
    const ctx = buildEscalationContext('src/hub.ts', buildGateIndex(store));
    assert(ctx?.blastRadius === 'medium', `fixture hub should be medium, got ${ctx?.blastRadius} (gravity ${ctx?.gravity})`);
    const result = decidePreToolUse(editInput('src/hub.ts'), buildGateIndex(store));
    assert(result.action === 'emit', `medium-blast should emit, got ${result.action}`);
    if (result.action !== 'emit') return;
    assert(result.output.hookSpecificOutput.permissionDecision === 'allow',
      `medium-blast should allow (non-blocking), got ${result.output.hookSpecificOutput.permissionDecision}`);
    assert((result.output.hookSpecificOutput.additionalContext || '').length > 0,
      'medium-blast should still inject additionalContext');
    console.log('[test_pretooluse_hook] PASS: medium-blast → allow + context');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 9: the command reads stdin JSON, finds the scan via cwd, and emits
//    hook JSON to stdout (defers with no output when the edit is safe) ──
async function commandReadsStdinAndEmitsJson() {
  const { tmp, store: _store } = await buildFixture();
  try {
    // high-blast edit → JSON on stdout with an `ask` decision
    const highStdin = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(tmp, 'src', 'core.ts'), old_string: 'a', new_string: 'b' },
      cwd: tmp,
    });
    const high = await runHookCommand(highStdin);
    assert(high.stdout !== null, 'high-blast edit should produce stdout');
    const parsed = JSON.parse(high.stdout!);
    assert(parsed.hookSpecificOutput.permissionDecision === 'ask', 'command should emit ask for high-blast');

    // safe edit → defer → no stdout (exit 0, nothing printed)
    const lowStdin = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: join(tmp, 'src', 'consumer0.ts'), old_string: 'a', new_string: 'b' },
      cwd: tmp,
    });
    const low = await runHookCommand(lowStdin);
    assert(low.stdout === null, 'safe edit should produce no stdout (defer)');
    console.log('[test_pretooluse_hook] PASS: command reads stdin → emits/defers correctly');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 10: install registers the PreToolUse hook for Edit/Write/MultiEdit,
//    idempotently ──
function installRegistersHookIdempotently() {
  const config: Record<string, any> = {};
  const once = addPreToolUseHook(config);
  const entries = once.hooks?.PreToolUse;
  assert(Array.isArray(entries) && entries.length === 1, 'should register one PreToolUse entry');
  assert(/Edit/.test(entries[0].matcher) && /Write/.test(entries[0].matcher),
    `matcher should cover edit tools; got ${entries[0].matcher}`);
  const cmd = entries[0].hooks?.[0]?.command || '';
  assert(/vibe-splain hook pretooluse/.test(cmd), `command should invoke the gate; got ${cmd}`);

  // idempotent: running install again must not duplicate the entry
  const twice = addPreToolUseHook(once);
  assert(twice.hooks.PreToolUse.length === 1, 'second install should not duplicate the hook entry');
  console.log('[test_pretooluse_hook] PASS: install registers PreToolUse hook idempotently');
}

// ── Behavior 11: hybrid blast radius with behavioral substance & demote reason override ──
async function hybridBlastRadiusAndDemoteReason() {
  const { tmp, store } = await buildFixture();
  try {
    const gateIndex = buildGateIndex(store);

    // Let's inspect src/core.ts in the gate index
    const coreEntry = gateIndex.files['src/core.ts'];
    assert(coreEntry !== undefined, 'core.ts should exist in the index');
    assert(coreEntry.hasBehavioralSubstance === true, 'core.ts should have behavioral substance');
    assert(coreEntry.dependents.length >= 8, 'core.ts should have at least 8 dependents');

    // Let's synthesize a gate index for testing escalation logic directly
    const mockIndex: GateIndex = {
      files: {
        'src/high-substance.ts': {
          relativePath: 'src/high-substance.ts',
          gravity: 20, // Low gravity, but...
          demoteReason: null,
          hasBehavioralSubstance: true,
          dependents: Array.from({ length: 10 }, (_, i) => `src/dep${i}.ts`), // 10 dependents
          fanIn: 10,
          fanOut: 0,
          centrality: 0.1,
          severity: 1,
          sideEffects: [],
          riskTypes: []
        },
        'src/medium-substance.ts': {
          relativePath: 'src/medium-substance.ts',
          gravity: 20, // Low gravity, but...
          demoteReason: null,
          hasBehavioralSubstance: true,
          dependents: Array.from({ length: 4 }, (_, i) => `src/dep${i}.ts`), // 4 dependents
          fanIn: 4,
          fanOut: 0,
          centrality: 0.1,
          severity: 1,
          sideEffects: [],
          riskTypes: []
        },
        'src/low-substance.ts': {
          relativePath: 'src/low-substance.ts',
          gravity: 20,
          demoteReason: null,
          hasBehavioralSubstance: false,
          dependents: Array.from({ length: 10 }, (_, i) => `src/dep${i}.ts`), // 10 dependents
          fanIn: 10,
          fanOut: 0,
          centrality: 0.1,
          severity: 1,
          sideEffects: [],
          riskTypes: []
        },
        'src/generated-high.generated.ts': {
          relativePath: 'src/generated-high.generated.ts',
          gravity: 95, // High gravity, but...
          demoteReason: 'generated file',
          hasBehavioralSubstance: true,
          dependents: Array.from({ length: 15 }, (_, i) => `src/dep${i}.ts`),
          fanIn: 15,
          fanOut: 0,
          centrality: 0.9,
          severity: 1,
          sideEffects: [],
          riskTypes: []
        }
      }
    };

    // 1. High substance (gravity low, but substance + 10 dependents -> high blast radius)
    const ctxHigh = buildEscalationContext('src/high-substance.ts', mockIndex);
    assert(ctxHigh?.blastRadius === 'high', `expected high blast radius, got ${ctxHigh?.blastRadius}`);

    // 2. Medium substance (gravity low, but substance + 4 dependents -> medium blast radius)
    const ctxMed = buildEscalationContext('src/medium-substance.ts', mockIndex);
    assert(ctxMed?.blastRadius === 'medium', `expected medium blast radius, got ${ctxMed?.blastRadius}`);

    // 3. Low substance (gravity low, no substance -> low blast radius)
    const ctxLow = buildEscalationContext('src/low-substance.ts', mockIndex);
    assert(ctxLow?.blastRadius === 'low', `expected low blast radius, got ${ctxLow?.blastRadius}`);

    // 4. Generated/vendored override (gravity high, but demoteReason is set -> low blast radius)
    const ctxGen = buildEscalationContext('src/generated-high.generated.ts', mockIndex);
    assert(ctxGen?.blastRadius === 'low', `expected low blast radius for generated file, got ${ctxGen?.blastRadius}`);

    console.log('[test_pretooluse_hook] PASS: hybrid blast radius & demote reason override');
  } finally {
    cleanTmpDir(tmp);
  }
}

// ── Behavior 12: warn-once warning is returned exactly once per session when gate.json is missing ──
async function warnOnceOnlyWarnsFirstTime() {
  const tmp = makeTmpDir();
  try {
    const sessionId = `session-${Date.now()}`;
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: join(tmp, 'src', 'core.ts'), old_string: 'a', new_string: 'b' },
      cwd: tmp,
      session_id: sessionId,
    };

    // First call: should emit the warning (permissionDecision: 'allow')
    const firstResult = decidePreToolUse(input, null, { warningShown: false });
    assert(firstResult.action === 'emit', `first call should emit, got ${firstResult.action}`);
    if (firstResult.action === 'emit') {
      assert(firstResult.output.hookSpecificOutput.permissionDecision === 'allow', 'first call should allow');
      const msg = firstResult.output.hookSpecificOutput.additionalContext || '';
      assert(msg.includes('gate.json is missing'), `expected warning message, got: ${msg}`);
    }

    // Second call: should defer (no warning shown again)
    const secondResult = decidePreToolUse(input, null, { warningShown: true });
    assert(secondResult.action === 'defer', `second call should defer, got ${secondResult.action}`);

    console.log('[test_pretooluse_hook] PASS: warn-once only warns first time');
  } finally {
    cleanTmpDir(tmp);
  }
}

async function runTest() {
  await initParser();
  installRegistersHookIdempotently();
  await highBlastAsksAndNamesDependents();
  await lowBlastDefers();
  await nonEditToolDefers();
  await newFileDefers();
  await noStoreDefers();
  await absolutePathResolvesAndGates();
  await securityPathSurfacesWarning();
  await mediumBlastAllowsWithContext();
  await hybridBlastRadiusAndDemoteReason();
  await warnOnceOnlyWarnsFirstTime();
  await commandReadsStdinAndEmitsJson();
}

runTest().catch(err => {
  console.error('[test_pretooluse_hook] FAIL:', err);
  process.exit(1);
});
