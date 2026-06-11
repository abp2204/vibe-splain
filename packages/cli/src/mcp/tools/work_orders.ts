import { PointerStore, type ProofDescriptor } from '../../store/PointerStore.js';
import { v4 as uuidv4 } from 'uuid';

export const createWorkOrderTool = {
  name: 'create_work_order',
  description: 'Creates a new Work Order defining intent, allowed file scope, and required verifiable proof. Returns the workOrderId and a manifestPointer for use with spawn_worker.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      intent: { type: 'string', description: 'Plain-language description of what the worker should do' },
      allowedFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit file paths (relative to projectRoot) the worker may read/write',
      },
      allowedGlobs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns for allowed files',
      },
      deniedGlobs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns that override allowedFiles/allowedGlobs',
      },
      requiredProof: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            proofId: { type: 'string' },
            schemaName: { type: 'string', description: 'e.g. test_report.v1, patch_hash' },
            description: { type: 'string' },
          },
          required: ['proofId', 'schemaName', 'description'],
        },
        description: 'Machine-verifiable evidence the worker must provide',
      },
    },
    required: ['projectRoot', 'intent', 'allowedFiles'],
  },
};

export async function handleCreateWorkOrder(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const intent = args.intent as string;
  const allowedFiles = (args.allowedFiles as string[]) ?? [];
  const allowedGlobs = (args.allowedGlobs as string[]) ?? [];
  const deniedGlobs = (args.deniedGlobs as string[]) ?? [];
  const requiredProof = (args.requiredProof as ProofDescriptor[]) ?? [];

  if (!projectRoot || !intent) {
    throw new Error('projectRoot and intent are required');
  }

  const workOrderId = `wo_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const pointerStore = PointerStore.open(projectRoot);

  await pointerStore.insertWorkOrder({
    workOrderId,
    intent,
    allowedFiles: JSON.stringify(allowedFiles),
    allowedGlobs: JSON.stringify(allowedGlobs),
    deniedGlobs: JSON.stringify(deniedGlobs),
    requiredProof: JSON.stringify(requiredProof),
    status: 'pending',
    createdAt: Date.now(),
  });

  return {
    ok: true,
    workOrderId,
    intent,
    allowedFiles,
    allowedGlobs,
    deniedGlobs,
    requiredProof,
    nextStep: `Call spawn_worker with workOrderId "${workOrderId}" to generate a DelegationRequest`,
  };
}

export const spawnWorkerTool = {
  name: 'spawn_worker',
  description: 'Generates a DelegationRequest from a Work Order. The Client Orchestrator uses this object to spawn an isolated Worker session. The MCP server does NOT spawn any subprocess.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      workOrderId: { type: 'string', description: 'ID returned by create_work_order' },
    },
    required: ['projectRoot', 'workOrderId'],
  },
};

export async function handleSpawnWorker(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const workOrderId = args.workOrderId as string;

  if (!projectRoot || !workOrderId) {
    throw new Error('projectRoot and workOrderId are required');
  }

  const pointerStore = PointerStore.open(projectRoot);
  const row = pointerStore.getWorkOrder(workOrderId);

  if (!row) {
    throw new Error(`WorkOrderNotFound: ${workOrderId}`);
  }
  if (row.status === 'completed' || row.status === 'failed' || row.status === 'active') {
    throw new Error(`WorkOrderClosed: ${workOrderId} is already ${row.status}`);
  }

  await pointerStore.updateWorkOrderStatus(workOrderId, 'active');

  const delegationRequest = {
    schemaVersion: '1.0.0',
    workOrderId: row.workOrderId,
    intent: row.intent,
    sessionScope: {
      allowedFiles: JSON.parse(row.allowedFiles) as string[],
      allowedGlobs: JSON.parse(row.allowedGlobs) as string[],
      deniedGlobs: JSON.parse(row.deniedGlobs) as string[],
    },
    requiredProof: JSON.parse(row.requiredProof) as ProofDescriptor[],
    instructions: [
      `1. Call set_session_scope with workOrderId "${workOrderId}" before any file operations.`,
      '2. Only read/write files within the sessionScope.',
      '3. If you need a file outside scope, call yield_for_scope_expansion — do NOT proceed.',
      '4. On completion, call submit_receipt with proof for every requiredProof entry.',
    ],
  };

  return {
    ok: true,
    delegationRequest,
    note: 'The Client Orchestrator must spawn the Worker session using this DelegationRequest. The MCP server does not spawn subprocesses.',
  };
}
