import { join } from 'path';
import { writeFile, readFile } from 'fs/promises';
import type Parser from 'web-tree-sitter';
import type { InventoryResult, WorkItem, RawNamedImport } from './inventory.js';
import type { ResolutionResult } from './resolution.js';
import { resolveImportWithAliasMap } from './resolution.js';

export interface ActionBindingsArtifact {
  schemaVersion: 1;
  projectRoot: string;
  generatedAt: string;
  files: Record<string, FileBindingRecord>;
  functionIndex: Record<string, FunctionIndexEntry>;
  actionIndex: Record<string, string[]>;
  entrypointIndex: Record<string, string[]>;
}

export interface FileBindingRecord {
  filePath: string;
  language: string;
  sourceRole: 'production' | 'test' | 'config' | 'script';
  imports: ImportBinding[];
  functions: FunctionRecord[];
}

export interface ImportBinding {
  localName: string;
  importedName: string;
  moduleSpecifier: string;
  resolvedFilePath: string | null;
  importKind: 'named' | 'default' | 'namespace' | 'side_effect';
  isTypeOnly: boolean;
  sourceLine: number;
  confidence: 'high' | 'medium' | 'low';
  evidenceText: string;
}

export type NameSource =
  | 'function_declaration'
  | 'method_definition'
  | 'parent_variable_declarator'
  | 'parent_assignment'
  | 'object_property_key'
  | 'export_const'
  | 'position_fallback';

export type FunctionKind = string;

export interface FunctionRecord {
  functionId: string;
  displayName: string;
  nameSource: NameSource;
  functionKind: FunctionKind;
  filePath: string;
  startLine: number;
  endLine: number;
  startCol: number;
  isExported: boolean;
  isEntrypoint: boolean;
  calls: CallRecord[];
  semanticActions: SemanticActionRecord[];
  evidenceText: string;
}

export type ResolutionKind =
  | 'same_file_function'
  | 'named_import_match'
  | 'namespace_import_property'
  | 'semantic_action_only'
  | 'unresolved';

export interface CallRecord {
  callId: string;
  sourceFunctionId: string;
  calleeText: string;
  calleeRoot: string;
  calleeProperty: string | null;
  sourceLine: number;
  sourceSpan: { startLine: number; endLine: number };
  resolvedTargetFunctionId: string | null;
  resolvedFilePath: string | null;
  resolutionKind: ResolutionKind;
  confidence: 'high' | 'medium' | 'low' | 'unresolved';
  evidenceText: string;
}

export type SemanticActionKind =
  | 'database_write'
  | 'database_read'
  | 'external_api_call'
  | 'validation'
  | 'auth_check'
  | 'email_send'
  | 'calendar_mutation'
  | 'webhook_delivery'
  | 'webhook_ingress'
  | 'cache_revalidation'
  | 'redirect'
  | 'analytics_event'
  | 'side_effect';

export interface SemanticActionRecord {
  actionId: string;
  sourceFunctionId: string;
  actionKind: SemanticActionKind;
  targetModel: string | null;
  targetOperation: string | null;
  calleeText: string;
  sourceLine: number;
  confidence: 'high' | 'medium' | 'low';
  evidenceText: string;
}

export interface FunctionIndexEntry {
  filePath: string;
  displayName: string;
  startLine: number;
  endLine: number;
}

export interface ActionBindingResult {
  artifact: ActionBindingsArtifact;
}

export interface GetCallChainArgs {
  entrypointPath: string;
  maxDepth?: number;
  targetActionKind?: string;
  targetModel?: string;
  targetOperation?: string;
  targetFunctionName?: string;
  includeTests?: boolean;
}

export interface ChainStep {
  functionId: string;
  displayName: string;
  filePath: string;
  startLine: number;
  edgeKind: 'call_edge' | 'semantic_action';
  actionKind?: string;
  targetModel?: string;
  targetOperation?: string;
  confidence: 'high' | 'medium' | 'low' | 'unresolved';
  evidenceText: string;
  isTarget?: boolean;
  depth: number;
}

export interface UnresolvedEdge {
  fromFunctionId: string;
  calleeText: string;
  sourceLine: number;
  reason: string;
}

export interface CallChainResult {
  targetReached: boolean;
  truncatedAtDepth?: boolean;
  chain: ChainStep[];
  unresolvedEdges: UnresolvedEdge[];
}

export interface FunctionActionSummary {
  functionId: string;
  displayName: string;
  functionKind: string;
  startLine: number;
  endLine: number;
  isEntrypoint: boolean;
  isExported: boolean;
  actionKinds: string[];
  targetModels: string[];
  targetOperations: string[];
  outboundCallCount: number;
  resolvedOutboundCallCount: number;
  semanticActionCount: number;
  evidence: FunctionEvidenceItem[];
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

export interface FunctionEvidenceItem {
  sourceLine: number;
  text: string;
  actionKind: string;
  targetModel: string | null;
  targetOperation: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const FUNCTION_TYPES = new Set([
  'function_declaration', 'function_expression', 'arrow_function',
  'method_definition', 'function_definition', 'method_declaration',
  'func_literal', 'function_item', 'closure_expression', 'constructor_declaration',
  'generator_function_declaration', 'generator_function'
]);

function firstLine(s: string): string {
  return s.split('\n')[0].trim();
}

function walkNodes(node: Parser.SyntaxNode, cb: (n: Parser.SyntaxNode) => void) {
  cb(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkNodes(child, cb);
  }
}

function resolveCallee(node: Parser.SyntaxNode): { root: string; prop: string | null } | null {
  if (node.type === 'identifier') {
    return { root: node.text, prop: null };
  }
  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object');
    const prop = node.childForFieldName('property');
    if (obj && prop) {
      const nested = resolveCallee(obj);
      if (nested) {
        return { root: nested.root, prop: nested.prop ? `${nested.prop}.${prop.text}` : prop.text };
      }
    }
  }
  if (node.type === 'parenthesized_expression' || node.type === 'await_expression') {
    const inner = node.namedChildren.find(c => c.type !== '(' && c.type !== ')' && c.type !== 'await');
    if (inner) return resolveCallee(inner);
  }
  return null;
}

export async function runActionBinding(
  projectRoot: string,
  inv: InventoryResult,
  res: ResolutionResult,
): Promise<ActionBindingResult> {
  const artifact: ActionBindingsArtifact = {
    schemaVersion: 1,
    projectRoot,
    generatedAt: new Date().toISOString(),
    files: {},
    functionIndex: {},
    actionIndex: {},
    entrypointIndex: {}
  };

  let filesProcessed = 0;
  let functionsExtracted = 0;
  let callsExtracted = 0;
  let callsResolved = 0;
  let semanticActionsExtracted = 0;
  let entrypointsFound = 0;
  let namedImportsExtracted = 0;

  for (const w of inv.work) {
    if (w.pathDemote) continue;

    filesProcessed++;
    const filePath = w.rel;

    const imports: ImportBinding[] = [];
    for (const raw of w.rawNamedImports) {
      namedImportsExtracted++;
      const { resolved, isAlias } = resolveImportWithAliasMap(
        raw.moduleSpecifier, w.abs, w.lang, projectRoot, inv.fileSet, inv.basenameIndex, res.aliasMap
      );
      
      let confidence: 'high' | 'medium' | 'low' = 'low';
      if (resolved) confidence = 'high';
      else if (isAlias) confidence = 'medium';

      imports.push({
        localName: raw.localName,
        importedName: raw.importedName,
        moduleSpecifier: raw.moduleSpecifier,
        resolvedFilePath: resolved,
        importKind: raw.importKind,
        isTypeOnly: raw.isTypeOnly,
        sourceLine: raw.sourceLine,
        confidence,
        evidenceText: raw.rawText.slice(0, 200)
      });
    }

    const functions: FunctionRecord[] = [];
    const nodeToRecord = new Map<number, FunctionRecord>();

    if (!w.tree) continue;

    const allNodes: Parser.SyntaxNode[] = [];
    walkNodes(w.tree.rootNode, (n) => {
      allNodes.push(n);
    });

    // Pass 1: Extract functions
    for (const node of allNodes) {
      if (!FUNCTION_TYPES.has(node.type)) continue;

      const startLine = node.startPosition.row + 1;
      const startCol = node.startPosition.column;
      const endLine = node.endPosition.row + 1;

      // Deduplication safeguard
      const isDuplicate = functions.some(f => f.startLine === startLine && f.endLine === endLine);
      if (isDuplicate) continue;

      functionsExtracted++;
      let displayName = '';
      let nameSource: NameSource = 'position_fallback';
      
      const p = node.parent;

      if (node.childForFieldName('name')) {
        displayName = node.childForFieldName('name')!.text;
        nameSource = node.type === 'method_definition' ? 'method_definition' : 'function_declaration';
      } else if (p?.type === 'variable_declarator' && p.childForFieldName('name')) {
        displayName = p.childForFieldName('name')!.text;
        nameSource = 'parent_variable_declarator';
      } else if (p?.type === 'assignment_expression' && p.childForFieldName('left')) {
        displayName = p.childForFieldName('left')!.text;
        nameSource = 'parent_assignment';
      } else if (p?.type === 'pair' && p.childForFieldName('key')) {
        displayName = p.childForFieldName('key')!.text;
        nameSource = 'object_property_key';
      } else if (p?.type === 'export_statement') {
        const idNode = p.children.find(c => c.type === 'identifier');
        if (idNode) {
          displayName = idNode.text;
          nameSource = 'export_const';
        }
      } else if (p?.type === 'lexical_declaration' || p?.type === 'variable_declaration') {
        const decl = p.children.find(c => c.type === 'variable_declarator');
        if (decl && decl.childForFieldName('name')) {
          displayName = decl.childForFieldName('name')!.text;
          nameSource = 'parent_variable_declarator';
        }
      }

      if (!displayName) {
        displayName = `anonymous@${startLine}:${startCol}`;
        nameSource = 'position_fallback';
      }

      const functionId = `${filePath}::${displayName}::${startLine}:${startCol}`;

      let isExported = false;
      if (p?.type === 'export_statement') isExported = true;
      if (p?.parent?.type === 'export_statement') isExported = true;
      if (w.ast.exportedNames.includes(displayName)) isExported = true;

      const isEntrypoint = (w.frameworkRole.includes('route') || w.frameworkRole.includes('page')) && isExported;
      if (isEntrypoint) entrypointsFound++;

      const fnRecord: FunctionRecord = {
        functionId,
        displayName,
        nameSource,
        functionKind: node.type,
        filePath,
        startLine,
        endLine: node.endPosition.row + 1,
        startCol,
        isExported,
        isEntrypoint,
        calls: [],
        semanticActions: [],
        evidenceText: firstLine(node.text).slice(0, 200)
      };

      functions.push(fnRecord);
      nodeToRecord.set(node.id, fnRecord);
    }

    // Pass 2: Extract calls and semantic actions
    for (const node of allNodes) {
      if (node.type !== 'call_expression' && node.type !== 'call') continue;

      // Find innermost containing function
      let curr = node.parent;
      let containingFnRecord: FunctionRecord | null = null;
      while (curr) {
        const rec = nodeToRecord.get(curr.id);
        if (rec) {
          containingFnRecord = rec;
          break;
        }
        curr = curr.parent;
      }
      if (!containingFnRecord) continue;

      callsExtracted++;

      const calleeNode = node.childForFieldName('function') || node.namedChild(0);
      if (!calleeNode) continue;
      
      const resolvedCallee = resolveCallee(calleeNode);
      if (!resolvedCallee) continue;

      const { root: calleeRoot, prop: calleeProperty } = resolvedCallee;
      const calleeText = calleeNode.text.slice(0, 100);
      const sourceLine = node.startPosition.row + 1;

      let isSemantic = false;
      let actionKind: SemanticActionKind | null = null;
      let targetModel: string | null = null;
      let targetOperation: string | null = null;

      // Semantic rules
      if (calleeRoot === 'prisma' && calleeProperty) {
        if (/\.(create|update|upsert|delete|deleteMany|updateMany|createMany|executeRaw|queryRaw)$/.test('.' + calleeProperty)) {
          isSemantic = true; actionKind = 'database_write';
          const parts = calleeProperty.split('.');
          if (parts.length >= 2) {
            targetModel = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            targetOperation = parts[parts.length - 1];
          }
        } else if (/\.(findMany|findUnique|findFirst|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy)$/.test('.' + calleeProperty)) {
          isSemantic = true; actionKind = 'database_read';
          const parts = calleeProperty.split('.');
          if (parts.length >= 2) {
            targetModel = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            targetOperation = parts[parts.length - 1];
          }
        }
      } else if (calleeRoot === 'trpc' && calleeProperty && /\.(useMutation|mutate|mutateAsync)$/.test('.' + calleeProperty)) {
        isSemantic = true; actionKind = 'external_api_call';
        const parts = calleeProperty.split('.');
        if (parts.length >= 2) {
            targetModel = parts[0];
            targetOperation = parts[parts.length - 1];
        }
      }
      
      if (!isSemantic) {
        if (calleeRoot === 'fetch' || (calleeRoot === 'axios' && calleeProperty && /\.(get|post|put|patch|delete)$/.test('.' + calleeProperty))) {
          isSemantic = true; actionKind = 'external_api_call';
        } else if (/validate|schema\.parse|schema\.safeParse|z\.parse/i.test(calleeText) || /validate|validator/i.test(calleeRoot)) {
          isSemantic = true; actionKind = 'validation';
        } else if (/getSession|getServerSession|auth\(\)|verifyToken|requireAuth|checkPermission/i.test(calleeText) || (/auth|session/i.test(calleeRoot) && calleeProperty && /check|verify|get|require/i.test('.' + calleeProperty))) {
          isSemantic = true; actionKind = 'auth_check';
        } else if (/sendEmail|sendMail|mailer\./i.test(calleeText)) {
          isSemantic = true; actionKind = 'email_send';
        } else if (/createCalendarEvent|updateCalendarEvent|deleteCalendarEvent|calendar\.events\.(insert|update|delete)/i.test(calleeText)) {
          isSemantic = true; actionKind = 'calendar_mutation';
        } else if (/triggerWebhook|sendWebhook|webhook\.send/i.test(calleeText)) {
          isSemantic = true; actionKind = 'webhook_delivery';
        } else if (/stripe\.webhooks\.constructEvent|validateWebhook|verifySignature/i.test(calleeText)) {
          isSemantic = true; actionKind = 'webhook_ingress';
        } else if (/revalidatePath|revalidateTag/i.test(calleeText)) {
          isSemantic = true; actionKind = 'cache_revalidation';
        } else if (/posthog\.|mixpanel\.|amplitude\.|ga\(/i.test(calleeText)) {
          isSemantic = true; actionKind = 'analytics_event';
        } else if (calleeRoot === 'redirect' || (/router|redirect|notFound|permanentRedirect/.test(calleeRoot) && calleeProperty && /push|replace|back/i.test('.' + calleeProperty))) {
          isSemantic = true; actionKind = 'redirect';
        } else if (/cookies\(\)|headers\(\)/.test(calleeText) || calleeRoot === 'cookies' || calleeRoot === 'headers') {
          isSemantic = true; actionKind = 'side_effect';
        } else if (/checkRateLimitAndThrowError/i.test(calleeText)) {
          isSemantic = true; actionKind = 'auth_check';
        } else {
          // Check imports for email
          const emailImport = imports.find(i => i.localName === calleeRoot && /nodemailer|resend|sendgrid|postmark|mailgun/i.test(i.moduleSpecifier));
          if (emailImport) {
            isSemantic = true; actionKind = 'email_send';
          }
        }
      }

      if (isSemantic && actionKind) {
        semanticActionsExtracted++;
        const actionId = `${containingFnRecord.functionId}::${actionKind}::${sourceLine}`;
        containingFnRecord.semanticActions.push({
          actionId,
          sourceFunctionId: containingFnRecord.functionId,
          actionKind,
          targetModel,
          targetOperation,
          calleeText,
          sourceLine,
          confidence: 'high',
          evidenceText: firstLine(node.text).slice(0, 200)
        });
        
        if (!artifact.actionIndex[actionKind]) artifact.actionIndex[actionKind] = [];
        artifact.actionIndex[actionKind].push(containingFnRecord.functionId);
        if (targetModel) {
          const key1 = `${actionKind}::${targetModel}`;
          if (!artifact.actionIndex[key1]) artifact.actionIndex[key1] = [];
          artifact.actionIndex[key1].push(containingFnRecord.functionId);
          if (targetOperation) {
            const key2 = `${actionKind}::${targetModel}::${targetOperation}`;
            if (!artifact.actionIndex[key2]) artifact.actionIndex[key2] = [];
            artifact.actionIndex[key2].push(containingFnRecord.functionId);
          }
        }
      } else {
        // Resolve Call Edge
        let resolvedTargetFunctionId: string | null = null;
        let resolvedFilePath: string | null = null;
        let resolutionKind: ResolutionKind = 'unresolved';
        let confidence: 'high' | 'medium' | 'low' | 'unresolved' = 'unresolved';

        const sameFileFn = functions.find(f => f.displayName === calleeRoot);
        if (sameFileFn) {
          resolvedTargetFunctionId = sameFileFn.functionId;
          resolutionKind = 'same_file_function';
          confidence = 'high';
        } else {
          const namedImp = imports.find(i => i.localName === calleeRoot && i.importKind !== 'namespace' && !i.isTypeOnly);
          if (namedImp && namedImp.resolvedFilePath) {
            resolvedFilePath = namedImp.resolvedFilePath;
            resolutionKind = 'named_import_match';
            confidence = 'high';
          } else {
            const nsImp = imports.find(i => i.localName === calleeRoot && i.importKind === 'namespace');
            if (nsImp && nsImp.resolvedFilePath) {
              resolvedFilePath = nsImp.resolvedFilePath;
              resolutionKind = 'namespace_import_property';
              confidence = 'medium';
            }
          }
        }

        if (resolutionKind !== 'unresolved') callsResolved++;

        containingFnRecord.calls.push({
          callId: `${containingFnRecord.functionId}::${calleeText}::${sourceLine}`,
          sourceFunctionId: containingFnRecord.functionId,
          calleeText,
          calleeRoot,
          calleeProperty,
          sourceLine,
          sourceSpan: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
          resolvedTargetFunctionId,
          resolvedFilePath,
          resolutionKind,
          confidence,
          evidenceText: firstLine(node.text).slice(0, 200)
        });
      }
    }

    artifact.files[filePath] = {
      filePath,
      language: w.lang,
      sourceRole: w.frameworkRole === 'test' ? 'test' : 'production',
      imports,
      functions
    };

    for (const fn of functions) {
      artifact.functionIndex[fn.functionId] = {
        filePath,
        displayName: fn.displayName,
        startLine: fn.startLine,
        endLine: fn.endLine
      };
      if (fn.isEntrypoint) {
        if (!artifact.entrypointIndex[filePath]) artifact.entrypointIndex[filePath] = [];
        artifact.entrypointIndex[filePath].push(fn.functionId);
      }
    }
  }

  // Second pass for named_import_match function ID resolution
  for (const fileRec of Object.values(artifact.files)) {
    for (const fnRec of fileRec.functions) {
      for (const callRec of fnRec.calls) {
        if (callRec.resolutionKind === 'named_import_match' && callRec.resolvedFilePath) {
          const targetFile = artifact.files[callRec.resolvedFilePath];
          if (targetFile) {
            const targetFn = targetFile.functions.find(f => f.displayName === callRec.calleeRoot);
            if (targetFn) {
              callRec.resolvedTargetFunctionId = targetFn.functionId;
            }
          }
        }
      }
    }
  }

  await writeFile(join(projectRoot, '.vibe-splainer', 'action_bindings.json'), JSON.stringify(artifact, null, 2), 'utf8');

  const summary = {
    filesProcessed,
    functionsExtracted,
    callsExtracted,
    callsResolved,
    semanticActionsExtracted,
    entrypointsFound,
    namedImportsExtracted
  };
  await writeFile(join(projectRoot, '.vibe-splainer', 'stage-09-action-bindings-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  return { artifact };
}

export async function traverseCallChain(
  projectRoot: string,
  args: GetCallChainArgs,
): Promise<CallChainResult> {
  const artifactPath = join(projectRoot, '.vibe-splainer', 'action_bindings.json');
  let artifact: ActionBindingsArtifact;
  try {
    const raw = await readFile(artifactPath, 'utf8');
    artifact = JSON.parse(raw);
  } catch {
    throw new Error('action_bindings.json not found. Run scan_project first.');
  }

  const { entrypointPath, maxDepth = 6, targetActionKind, targetModel, targetOperation, targetFunctionName, includeTests = false } = args;

  let seedFunctionIds: string[] = [];
  if (artifact.entrypointIndex[entrypointPath]) {
    seedFunctionIds = artifact.entrypointIndex[entrypointPath];
  } else if (artifact.files[entrypointPath]) {
    const fileRec = artifact.files[entrypointPath];
    seedFunctionIds = fileRec.functions.filter(f => f.isEntrypoint).map(f => f.functionId);
    if (seedFunctionIds.length === 0) {
      const firstExported = fileRec.functions.find(f => f.isExported);
      if (firstExported) seedFunctionIds.push(firstExported.functionId);
    }
  }

  if (seedFunctionIds.length === 0) {
    throw new Error(`No entrypoint functions found in ${entrypointPath}`);
  }

  const chain: ChainStep[] = [];
  const unresolvedEdges: UnresolvedEdge[] = [];
  const visited = new Set<string>();
  const queue: { functionId: string, depth: number }[] = seedFunctionIds.map(id => ({ functionId: id, depth: 0 }));

  let targetReached = false;
  let truncatedAtDepth = false;

  while (queue.length > 0) {
    const { functionId, depth } = queue.shift()!;
    if (visited.has(functionId)) continue;
    visited.add(functionId);

    const indexEntry = artifact.functionIndex[functionId];
    if (!indexEntry) continue;
    const fileRec = artifact.files[indexEntry.filePath];
    if (!fileRec) continue;
    if (!includeTests && fileRec.sourceRole === 'test') continue;

    const fnRec = fileRec.functions.find(f => f.functionId === functionId);
    if (!fnRec) continue;

    for (const call of fnRec.calls) {
      if (call.resolutionKind === 'semantic_action_only') continue;

      if (call.resolvedTargetFunctionId) {
        if (depth < maxDepth) {
          queue.push({ functionId: call.resolvedTargetFunctionId, depth: depth + 1 });
          
          let isTarget = false;
          if (targetFunctionName && call.calleeRoot === targetFunctionName) isTarget = true;
          if (isTarget) targetReached = true;

          chain.push({
            functionId: call.resolvedTargetFunctionId,
            displayName: call.calleeRoot,
            filePath: call.resolvedFilePath || 'unknown',
            startLine: call.sourceLine,
            edgeKind: 'call_edge',
            confidence: call.confidence,
            evidenceText: call.evidenceText,
            isTarget,
            depth
          });
        } else {
          unresolvedEdges.push({
            fromFunctionId: functionId,
            calleeText: call.calleeText,
            sourceLine: call.sourceLine,
            reason: 'depth limit reached'
          });
          truncatedAtDepth = true;
        }
      } else {
        unresolvedEdges.push({
          fromFunctionId: functionId,
          calleeText: call.calleeText,
          sourceLine: call.sourceLine,
          reason: call.resolutionKind
        });
      }
    }

    for (const action of fnRec.semanticActions) {
      let isTarget = false;
      if (targetActionKind && action.actionKind === targetActionKind) {
        isTarget = true;
        if (targetModel && action.targetModel !== targetModel) isTarget = false;
        if (targetOperation && action.targetOperation !== targetOperation) isTarget = false;
      } else if (targetModel && action.targetModel === targetModel) {
        isTarget = true;
        if (targetOperation && action.targetOperation !== targetOperation) isTarget = false;
      }
      
      if (isTarget) targetReached = true;

      chain.push({
        functionId: action.sourceFunctionId,
        displayName: action.calleeText,
        filePath: fileRec.filePath,
        startLine: action.sourceLine,
        edgeKind: 'semantic_action',
        actionKind: action.actionKind,
        targetModel: action.targetModel || undefined,
        targetOperation: action.targetOperation || undefined,
        confidence: action.confidence,
        evidenceText: action.evidenceText,
        isTarget,
        depth
      });
    }
  }

  return {
    targetReached,
    truncatedAtDepth,
    chain,
    unresolvedEdges
  };
}
