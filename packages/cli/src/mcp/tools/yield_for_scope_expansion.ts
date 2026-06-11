import { SessionScope } from '../SessionScope.js';

export const yieldForScopeExpansionTool = {
  name: 'yield_for_scope_expansion',
  description: 'Worker signals that it needs to access files outside its current scope. Immediately terminates the active scope and returns a Blocked receipt. The Manager must evaluate the evidence and decide whether to spawn a new Worker with expanded scope.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      requestedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths the worker needs but cannot access under current scope',
      },
      reason: {
        type: 'string',
        description: 'Why these paths are needed — root cause found in out-of-scope file',
      },
      evidencePointers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Pointer IDs for artifacts that justify the expansion request',
      },
    },
    required: ['requestedPaths', 'reason'],
  },
};

export async function handleYieldForScopeExpansion(args: Record<string, unknown>): Promise<unknown> {
  const requestedPaths = (args.requestedPaths as string[]) ?? [];
  const reason = args.reason as string;
  const evidencePointers = (args.evidencePointers as string[]) ?? [];

  if (!requestedPaths.length || !reason) {
    throw new Error('requestedPaths and reason are required');
  }

  const currentScope = SessionScope.get();
  const workOrderId = currentScope?.workOrderId ?? 'unknown';

  // Immediately clear the active scope — Worker is now blocked
  SessionScope.clear();

  // Return strict Blocked status per ADR-033
  return {
    status: 'blocked',
    workOrderId,
    requestedPaths,
    reason,
    evidencePointers,
    receipt: {
      workOrderId,
      status: 'blocked',
      proofPointers: [],
      changedFiles: [],
      summary: `Worker blocked: scope expansion required. Reason: ${reason}`,
    },
    managerInstructions: [
      'Worker has been terminated. Active session scope has been cleared.',
      'Evaluate the evidence pointers and reason.',
      'If expansion is warranted, create a new Work Order with the expanded allowedFiles and spawn a new Worker.',
      'If expansion is NOT warranted, the task is failed — do not retry with same scope.',
    ],
  };
}
