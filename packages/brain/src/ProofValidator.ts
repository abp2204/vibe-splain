import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

export interface ProofPointerRef {
  pointer: string;
  schemaName: string;
  contentHash: string;
}

export interface ChangedFileRecord {
  path: string;
  prePatchHash: string;
  postPatchHash: string;
}

export interface WorkerReceipt {
  workOrderId: string;
  status: 'completed' | 'failed' | 'blocked';
  proofPointers: ProofPointerRef[];
  changedFiles: ChangedFileRecord[];
  summary: string;
}

export interface ProofDescriptor {
  proofId: string;
  schemaName: string;
  description: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ProofValidator {
  /**
   * Full validation of a WorkerReceipt against a Work Order's required proofs.
   * Checks all 8 required conditions from the spec.
   *
   * @param receipt - The WorkerReceipt to validate
   * @param requiredProof - Proof descriptors from the Work Order
   * @param isAllowedFile - Predicate built by the CLI layer (handles globs/allowedFiles)
   * @param blobDir - Path to .vibe-splainer/blobs/
   */
  static async validate(
    receipt: WorkerReceipt,
    requiredProof: ProofDescriptor[],
    isAllowedFile: (path: string) => boolean,
    blobDir: string,
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Required proof IDs are present
    for (const req of requiredProof) {
      const found = receipt.proofPointers.find(
        p => p.schemaName === req.schemaName || p.pointer.includes(req.proofId)
      );
      if (!found) {
        errors.push(`MissingProof: required proof "${req.proofId}" (schema: ${req.schemaName}) not in receipt`);
      }
    }

    // 2, 3, 4, 5: For each submitted proof — resolve, schema-match, hash, status
    for (const proof of receipt.proofPointers) {
      const blobPath = resolveBlobPath(blobDir, proof.contentHash);

      // 2. Proof pointers resolve (blob exists)
      if (!existsSync(blobPath)) {
        errors.push(`UnresolvablePointer: blob not found for pointer ${proof.pointer} (hash: ${proof.contentHash})`);
        continue;
      }

      // 4. Blob content hashes match
      const actualHash = await hashBlob(blobPath);
      if (actualHash !== proof.contentHash) {
        errors.push(`HashMismatch: proof ${proof.pointer} expected ${proof.contentHash}, got ${actualHash}`);
        continue;
      }

      // 3. Proof schema is in required list (warning if extra, not an error)
      const reqDescriptor = requiredProof.find(r => r.schemaName === proof.schemaName);
      if (!reqDescriptor) {
        warnings.push(`UnknownSchema: proof ${proof.pointer} has schema "${proof.schemaName}" not listed in requiredProof`);
      }

      // 5. Test/validation status must be pass (for test_report.* schemas)
      if (proof.schemaName.startsWith('test_report')) {
        try {
          const blobContent = await readFile(blobPath, 'utf8');
          const report = JSON.parse(blobContent);
          if (report.status !== 'pass' && report.passed !== true && report.success !== true) {
            errors.push(`TestFailed: proof ${proof.pointer} (schema: ${proof.schemaName}) reports status "${report.status ?? 'unknown'}"`);
          }
        } catch {
          errors.push(`UnreadableProof: cannot parse proof blob for ${proof.pointer}`);
        }
      }
    }

    // 6. Patch touched only allowed files
    for (const changed of receipt.changedFiles) {
      if (!isAllowedFile(changed.path)) {
        errors.push(`ScopeViolation: patch touched out-of-scope file "${changed.path}"`);
      }
    }

    // 7 & 8. Hash format and patch_hash proof presence
    for (const changed of receipt.changedFiles) {
      // 7. prePatchHash must be sha256: format (or sha256:new for new files)
      if (!changed.prePatchHash.startsWith('sha256:') && changed.prePatchHash !== 'sha256:new') {
        errors.push(`InvalidHash: prePatchHash for ${changed.path} is not sha256 format`);
      }
      // 8. postPatchHash must be sha256: format
      if (!changed.postPatchHash.startsWith('sha256:')) {
        errors.push(`InvalidHash: postPatchHash for ${changed.path} is not sha256 format`);
      }
      // Cross-check: a patch_hash proof should exist with matching postPatchHash
      const matchingPatch = receipt.proofPointers.find(
        p => p.schemaName === 'patch_hash' && p.contentHash === changed.postPatchHash
      );
      if (!matchingPatch) {
        warnings.push(`NoMatchingPatchProof: no patch_hash proof matches postPatchHash for ${changed.path}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

function resolveBlobPath(blobDir: string, contentHash: string): string {
  const hex = contentHash.replace('sha256:', '');
  return `${blobDir}/sha256_${hex}`;
}

async function hashBlob(blobPath: string): Promise<string> {
  const buf = await readFile(blobPath);
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}
