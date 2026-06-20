// PreToolUse hook decision logic — the deterministic gate.
//
// Pure: given the agent's intended tool call and the scan artifact, decide
// whether to escalate and how. No stdin/stdout, no filesystem — the CLI command
// wraps this with I/O. This separation is what makes the gate testable against
// real scanned stores.

import { buildEscalationContext } from '@vibe-splain/brain/dist/network/escalation.js';
import type { EscalationContext } from '@vibe-splain/brain/dist/network/escalation.js';
import type { GateIndex } from '@vibe-splain/brain/dist/network/gateIndex.js';

export interface PreToolUseInput {
  tool_name?: string;
  tool_input?: { file_path?: string; [k: string]: unknown };
  cwd?: string;
  session_id?: string;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'ask';
    permissionDecisionReason?: string;
    additionalContext?: string;
    systemMessage?: string;
  };
}

export type HookResult =
  | { action: 'defer' }
  | { action: 'emit'; output: HookOutput };

const DEFER: HookResult = { action: 'defer' };

// Only file-editing tools can have a blast radius. Anything else defers.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function decidePreToolUse(
  input: PreToolUseInput,
  gateIndex: GateIndex | null,
  sessionState?: { warningShown?: boolean }
): HookResult {
  if (!EDIT_TOOLS.has(input.tool_name ?? '')) return DEFER;

  if (!gateIndex) {
    if (sessionState && !sessionState.warningShown) {
      const warnMsg = "vibe-splain: .vibe-splainer/gate.json is missing. Please run 'vibe-splain scan' to generate the scan architecture and enable tool guarding.";
      return {
        action: 'emit',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            additionalContext: warnMsg,
            systemMessage: warnMsg,
          },
        },
      };
    }
    return DEFER;
  }

  const filePath = input.tool_input?.file_path;
  if (!filePath) return DEFER;

  const ctx = buildEscalationContext(filePath, gateIndex);
  if (!ctx || ctx.blastRadius === 'low') return DEFER;

  const block = formatEscalation(ctx);

  // high → stop-and-reconsider (human gate). medium → non-blocking awareness:
  // the agent sees the context on its next request without being interrupted.
  if (ctx.blastRadius === 'high') {
    return {
      action: 'emit',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: block,
          additionalContext: block,
        },
      },
    };
  }

  return {
    action: 'emit',
    output: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: block,
      },
    },
  };
}

export function formatEscalation(ctx: EscalationContext): string {
  const lines: string[] = [];
  lines.push(`vibe-splain: ${ctx.blastRadius} blast radius — ${ctx.targetFile} (gravity ${ctx.gravity}).`);

  if (ctx.dependentCount > 0) {
    const shown = ctx.dependents.slice(0, 8);
    const more = ctx.dependentCount - shown.length;
    lines.push(`${ctx.dependentCount} file(s) depend on it:`);
    for (const d of shown) lines.push(`  - ${d}`);
    if (more > 0) lines.push(`  … (+${more} more)`);
  }

  for (const w of ctx.riskWarnings) lines.push(`[${w.level}] ${w.message}`);

  lines.push(ctx.smallestSafeChange.summary);
  return lines.join('\n');
}
