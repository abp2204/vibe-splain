import { PointerStore } from '../../store/PointerStore.js';
import { SessionScope } from '../SessionScope.js';

export const setSessionScopeTool = {
  name: 'set_session_scope',
  description: 'Sets the active session scope from a Work Order. All subsequent file tools (read_file, get_file_skeleton, apply_patch) will enforce this scope until overwritten or the server restarts.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      workOrderId: { type: 'string', description: 'Work Order ID to load scope from' },
    },
    required: ['projectRoot', 'workOrderId'],
  },
};

export async function handleSetSessionScope(args: Record<string, unknown>): Promise<unknown> {
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

  const policy = SessionScope.fromWorkOrderRow(row);
  SessionScope.set(policy);

  return {
    ok: true,
    workOrderId,
    scope: {
      allowedFiles: policy.allowedFiles,
      allowedGlobs: policy.allowedGlobs,
      deniedGlobs: policy.deniedGlobs,
      requiredProofCount: policy.requiredProof.length,
    },
    message: `Session scope set from work order ${workOrderId}. All file tools will enforce this scope.`,
  };
}
