import { traverseCallChain } from '@vibe-splain/brain';

export const getCallChainTool = {
  name: 'get_call_chain',
  description: `Trace how behavior is reached from an entrypoint by following function call edges through the codebase. Returns a step-by-step chain with exact function names, file paths, line numbers, action kinds, and evidence text. Every edge has a confidence level; unresolved edges are listed explicitly.

Use structured filters when you know the target:
  targetModel + targetOperation: "where does Booking get created?"
  targetActionKind: "where is auth enforced?"  
  targetFunctionName: "how is function X reached?"
No filter returns the full call tree up to maxDepth.

Run scan_project first — this tool reads from the generated action_bindings.json.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string' },
      entrypointPath: { type: 'string', description: 'Relative path to the entrypoint file' },
      maxDepth: { type: 'number', description: 'Max traversal depth. Default 6, max 12.' },
      targetActionKind: { type: 'string', description: 'Stop at this semantic action kind.' },
      targetModel: { type: 'string', description: 'Stop at functions touching this model.' },
      targetOperation: { type: 'string', description: 'Narrow targetModel to this operation.' },
      targetFunctionName: { type: 'string', description: 'Stop at a specific function name.' },
      includeTests: { type: 'boolean', description: 'Include test files in traversal. Default false.' },
    },
    required: ['projectRoot', 'entrypointPath'],
  },
};

export async function handleGetCallChain(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const entrypointPath = args.entrypointPath as string;
  if (!projectRoot || !entrypointPath) throw new Error('projectRoot and entrypointPath are required');

  const getCallChainArgs = {
    entrypointPath,
    maxDepth: typeof args.maxDepth === 'number' ? args.maxDepth : undefined,
    targetActionKind: typeof args.targetActionKind === 'string' ? args.targetActionKind : undefined,
    targetModel: typeof args.targetModel === 'string' ? args.targetModel : undefined,
    targetOperation: typeof args.targetOperation === 'string' ? args.targetOperation : undefined,
    targetFunctionName: typeof args.targetFunctionName === 'string' ? args.targetFunctionName : undefined,
    includeTests: typeof args.includeTests === 'boolean' ? args.includeTests : undefined,
  };

  try {
    const result = await traverseCallChain(projectRoot, getCallChainArgs);
    return result;
  } catch (error) {
    throw new Error(`get_call_chain failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
