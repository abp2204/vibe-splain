import { join } from 'path';
import { PointerStore } from '../../store/PointerStore.js';
import { ProofValidator, type WorkerReceipt } from '@vibe-splain/brain';
import { minimatch } from 'minimatch';
import { v4 as uuidv4 } from 'uuid';

export const submitReceiptTool = {
  name: 'submit_receipt',
  description: 'Worker submits a WorkerReceipt for a completed Work Order. The ProofValidator checks all 8 proof conditions. Returns accept/reject with detailed errors.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectRoot: { type: 'string', description: 'Absolute project root' },
      receipt: {
        type: 'object',
        description: 'WorkerReceipt object',
        properties: {
          workOrderId: { type: 'string' },
          status: { type: 'string', enum: ['completed', 'failed', 'blocked'] },
          proofPointers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                pointer: { type: 'string' },
                schemaName: { type: 'string' },
                contentHash: { type: 'string' },
              },
              required: ['pointer', 'schemaName', 'contentHash'],
            },
          },
          changedFiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                prePatchHash: { type: 'string' },
                postPatchHash: { type: 'string' },
              },
              required: ['path', 'prePatchHash', 'postPatchHash'],
            },
          },
          summary: { type: 'string' },
        },
        required: ['workOrderId', 'status', 'proofPointers', 'changedFiles', 'summary'],
      },
    },
    required: ['projectRoot', 'receipt'],
  },
};

export async function handleSubmitReceipt(args: Record<string, unknown>): Promise<unknown> {
  const projectRoot = args.projectRoot as string;
  const receipt = args.receipt as WorkerReceipt;

  if (!projectRoot || !receipt) {
    throw new Error('projectRoot and receipt are required');
  }

  const pointerStore = PointerStore.open(projectRoot);
  const workOrder = pointerStore.getWorkOrder(receipt.workOrderId);

  if (!workOrder) {
    throw new Error(`WorkOrderNotFound: ${receipt.workOrderId}`);
  }
  if (workOrder.status !== 'active') {
    throw new Error(`WorkOrderNotActive: ${receipt.workOrderId} is "${workOrder.status}", expected "active"`);
  }

  const allowedFiles = JSON.parse(workOrder.allowedFiles) as string[];
  const allowedGlobs = JSON.parse(workOrder.allowedGlobs) as string[];
  const requiredProof = JSON.parse(workOrder.requiredProof) as import('@vibe-splain/brain').ProofDescriptor[];
  const blobDir = join(projectRoot, '.vibe-splainer', 'blobs');

  const isAllowedFile = (filePath: string): boolean => {
    const inExplicit = allowedFiles.some(f =>
      filePath === f || filePath.endsWith('/' + f) || filePath.endsWith(f)
    );
    const inGlobs = allowedGlobs.some(g => minimatch(filePath, g, { matchBase: true }));
    return inExplicit || inGlobs;
  };

  const validation = await ProofValidator.validate(
    receipt,
    requiredProof,
    isAllowedFile,
    blobDir,
  );

  const receiptId = `rcpt_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  const finalStatus = validation.valid ? receipt.status : 'failed';

  await pointerStore.insertReceipt({
    receiptId,
    workOrderId: receipt.workOrderId,
    status: finalStatus,
    proofPointers: receipt.proofPointers,
    changedFiles: receipt.changedFiles,
    summary: receipt.summary,
  });

  await pointerStore.updateWorkOrderStatus(
    receipt.workOrderId,
    validation.valid ? (receipt.status === 'completed' ? 'completed' : 'failed') : 'failed',
  );

  return {
    receiptId,
    accepted: validation.valid,
    workOrderId: receipt.workOrderId,
    validation,
    finalStatus,
  };
}
