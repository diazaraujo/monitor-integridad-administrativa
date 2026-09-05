import type {
  IntegrityServiceHandler,
  ReviewCaseDossierResponse,
  ReviewMutationResponse,
} from '../../../../src/generated/server/worldmonitor/integrity/v1/service_server';
import { ApiError } from '../../../../src/generated/server/worldmonitor/integrity/v1/service_server';

import { createCommercialLicensesClientFromEnv } from '../../../_shared/commercial-licenses-client';
import {
  createConvexReviewCaseAssignmentPortFromEnv,
  ConvexReviewCaseAssignmentPortError,
} from '../../../_shared/convex-review-case-assignment-port';
import {
  createConvexReviewCaseWritePortFromEnv,
  ConvexReviewCaseWritePortError,
} from '../../../_shared/convex-review-case-write-port';
import {
  createConvexReviewWorkflowPortFromEnv,
  ConvexReviewWorkflowPortError,
  type ConvexReviewWorkflowPort,
  type ReviewWorkflowAuthority,
} from '../../../_shared/convex-review-workflow-port';
import { createEvidencePacketBuilder } from '../../../_shared/evidence-packet-builder';
import { hashEvidencePacketContent, sha256CanonicalJson } from '../../../_shared/evidence-packet-canonical';
import { parseEvidencePacket } from '../../../_shared/evidence-packet-contract';
import {
  IntegrityActorScopeError,
  resolveIntegrityActorScope,
  type IntegrityActorScope,
} from '../../../_shared/integrity-actor-scope';
import { markNoCacheResponse } from '../../../_shared/response-headers';
import {
  createReviewCaseAssigner,
  ReviewCaseAssignerError,
} from '../../../_shared/review-case-assigner';
import { parseReviewCaseSnapshot, type ReviewCaseSnapshot } from '../../../_shared/review-case-contract';
import { createReviewCaseOpener, ReviewCaseOpenerError } from '../../../_shared/review-case-opener';

const ACTIONS = [
  'NoObservations', 'RequestMissingRequirement', 'RecordAlternativeExplanation',
  'RecommendInspection', 'RecommendReferral', 'RecordInspectionOutcome',
  'RecommendAdministrativeMeasure', 'RecordOfficialDecision', 'RequestCorrection', 'CloseReview',
] as const;
type WorkflowAction = (typeof ACTIONS)[number];
const ACTION_SET = new Set<string>(ACTIONS);
const REVIEWER_ACTIONS = new Set<WorkflowAction>([
  'NoObservations', 'RequestMissingRequirement', 'RecordAlternativeExplanation',
  'RecommendInspection', 'RecommendReferral', 'RecordInspectionOutcome',
  'RecommendAdministrativeMeasure', 'RequestCorrection',
]);
const ROLE_POLICY: Record<WorkflowAction, readonly string[]> = {
  NoObservations: ['rentas', 'control'],
  RequestMissingRequirement: ['rentas', 'control'],
  RecordAlternativeExplanation: ['rentas', 'control'],
  RecommendInspection: ['control', 'fiscalizacion'],
  RecommendReferral: ['control', 'fiscalizacion'],
  RecordInspectionOutcome: ['fiscalizacion', 'control'],
  RecommendAdministrativeMeasure: ['control', 'fiscalizacion'],
  RecordOfficialDecision: ['control', 'coordinator'],
  RequestCorrection: ['rentas', 'control'],
  CloseReview: ['control', 'coordinator'],
};

interface Dependencies {
  resolveActorScope(request: Request): Promise<IntegrityActorScope>;
  createWorkflowPort(): ConvexReviewWorkflowPort;
  createOpenWritePort: typeof createConvexReviewCaseWritePortFromEnv;
  createAssignmentWritePort: typeof createConvexReviewCaseAssignmentPortFromEnv;
  createLicensesClient: typeof createCommercialLicensesClientFromEnv;
  newId(prefix: 'case' | 'action'): string;
  now(): Date;
}

const defaults: Dependencies = {
  resolveActorScope: resolveIntegrityActorScope,
  createWorkflowPort: createConvexReviewWorkflowPortFromEnv,
  createOpenWritePort: createConvexReviewCaseWritePortFromEnv,
  createAssignmentWritePort: createConvexReviewCaseAssignmentPortFromEnv,
  createLicensesClient: createCommercialLicensesClientFromEnv,
  newId: (prefix) => `${prefix}-${crypto.randomUUID()}`,
  now: () => new Date(),
};
let dependencies = defaults;

export function __setReviewWorkflowDependenciesForTests(overrides: Partial<Dependencies> | null) {
  dependencies = overrides ? { ...defaults, ...overrides } : defaults;
}

function operationKey(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!key || key.length > 255 || !/^[\x21-\x7e]+$/u.test(key)) {
    throw new ApiError(400, 'A valid Idempotency-Key header is required', '');
  }
  return key;
}

async function actorFor(request: Request): Promise<IntegrityActorScope> {
  try { return await dependencies.resolveActorScope(request); } catch (error) {
    if (error instanceof IntegrityActorScopeError) {
      if (error.kind === 'unauthenticated') throw new ApiError(401, 'Authentication required', '');
      if (error.kind === 'forbidden') throw new ApiError(403, 'Municipal scope not authorized', '');
    }
    throw new ApiError(503, 'Municipal authorization unavailable', '');
  }
}

function currentAuthority(
  authority: ReviewWorkflowAuthority | null,
  actor: IntegrityActorScope,
  action?: string,
): ReviewWorkflowAuthority {
  const instant = dependencies.now().getTime();
  if (!authority || authority.actor_id !== actor.actor_id
    || authority.municipality_cut !== actor.municipality_cut
    || authority.revoked_at !== null || Date.parse(authority.valid_from) > instant
    || (authority.valid_to !== null && Date.parse(authority.valid_to) < instant)
    || (action !== undefined && !authority.permitted_actions.includes(action))
    || !sameSet(authority.roles, actor.roles)) {
    throw new ApiError(403, 'Municipal action not authorized', '');
  }
  return authority;
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function mapStorageError(error: unknown): never {
  if (error instanceof ConvexReviewWorkflowPortError
    || error instanceof ConvexReviewCaseWritePortError
    || error instanceof ConvexReviewCaseAssignmentPortError) {
    throw new ApiError(503, 'Review storage unavailable', '');
  }
  throw error;
}

function workflowPort(): ConvexReviewWorkflowPort {
  try { return dependencies.createWorkflowPort(); } catch (error) { return mapStorageError(error); }
}

async function storageCall<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { return mapStorageError(error); }
}

function mutationResponse(
  snapshot: ReviewCaseSnapshot,
  action: { action_id: string; action_type: string; legal_effect: string },
  replayed: boolean,
): ReviewMutationResponse {
  return {
    caseId: snapshot.case_id, caseVersion: snapshot.case_version, status: snapshot.status,
    actionId: action.action_id, actionType: action.action_type,
    legalEffect: action.legal_effect, replayed,
  };
}

function mapDomainError(error: unknown): never {
  if (error instanceof ReviewCaseOpenerError || error instanceof ReviewCaseAssignerError) {
    if (error.kind === 'invalid_request') throw new ApiError(400, error.message, '');
    if (error.kind === 'not_found_or_denied') throw new ApiError(404, 'Review case unavailable', '');
    if (error.kind === 'idempotency_conflict' || error.kind === 'case_conflict') {
      throw new ApiError(409, error.message, '');
    }
    if (error.kind === 'upstream_unavailable' || error.kind === 'storage_unavailable'
      || error.kind === 'authority_unavailable' || error.kind === 'policy_unavailable'
      || error.kind === 'reviewer_unavailable') throw new ApiError(503, error.message, '');
  }
  throw new ApiError(500, 'Review workflow failed', '');
}

function policyActions(evaluatedAt: string, actorRoles: readonly string[]) {
  return ACTIONS.map((action) => ({
    action_id: `policy-${action}`,
    action_type: action,
    permitted: actorRoles.some((role) => ROLE_POLICY[action].includes(role)),
    authorized_roles: [...ROLE_POLICY[action]],
    reason: 'Subject to current server-side authority and case state.',
    legal_effect: action === 'RecordOfficialDecision'
      ? 'reflects_external_act'
      : action === 'RequestMissingRequirement' || action === 'RequestCorrection'
        ? 'external_communication_only'
        : 'none',
    evaluated_at: evaluatedAt,
  }));
}

export const openLicenseReview: IntegrityServiceHandler['openLicenseReview'] = async (ctx, req) => {
  markNoCacheResponse(ctx.request);
  const actor = await actorFor(ctx.request);
  if (actor.representation !== 'public') throw new ApiError(403, 'Representation unavailable', '');
  const port = workflowPort();
  const authority = currentAuthority(
    await storageCall(() => port.readAuthority(actor.actor_id, actor.municipality_cut)),
    actor, 'OpenLicenseReview',
  );
  const roles = authority.roles.filter((role): role is 'rentas' | 'control' => (
    role === 'rentas' || role === 'control'
  ));
  if (roles.length === 0) throw new ApiError(403, 'Municipal action not authorized', '');
  const opener = createReviewCaseOpener({
    evidencePacketBuilder: createEvidencePacketBuilder({
      client: dependencies.createLicensesClient(), builderVersion: '0.1.0', now: dependencies.now,
    }),
    resolveAuthority: async () => ({
      ...authority,
      roles,
      permitted_actions: ['OpenLicenseReview'] as 'OpenLicenseReview'[],
      allowed_markings: ['PUBLIC', 'MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW'],
      allowed_representations: ['public'],
    }),
    evaluatePolicy: async ({ evaluatedAt, roles: evaluatedRoles }) => ({
      permittedNextActions: policyActions(evaluatedAt, evaluatedRoles),
    }),
    writePort: (() => {
      try { return dependencies.createOpenWritePort(); } catch (error) { return mapStorageError(error); }
    })(),
    newCaseId: () => dependencies.newId('case'),
    newActionId: () => dependencies.newId('action'),
    now: dependencies.now,
  });
  try {
    const receipt = await opener.openLicenseReview({
      operationKey: operationKey(ctx.request), municipalityCut: actor.municipality_cut,
      licenseId: req.licenseId, releaseId: req.releaseId,
      effectiveOn: req.effectiveOn || undefined, representation: 'public',
    });
    return mutationResponse(receipt.case, receipt.action, receipt.replayed);
  } catch (error) { return mapDomainError(error); }
};

async function validatedDossier(
  port: ConvexReviewWorkflowPort,
  actor: IntegrityActorScope,
  caseId: string,
  caseVersion: number,
) {
  const stored = await storageCall(() => port.readDossier({
    actorId: actor.actor_id, municipalityCut: actor.municipality_cut, caseId, caseVersion,
  }));
  if (!stored) throw new ApiError(404, 'Review case unavailable', '');
  try {
    const snapshot = parseReviewCaseSnapshot(JSON.parse(stored.caseJson));
    const packet = parseEvidencePacket(JSON.parse(stored.evidencePacketJson));
    const digest = await hashEvidencePacketContent(packet);
    if (snapshot.case_id !== caseId || snapshot.case_version !== caseVersion
      || snapshot.municipality_cut !== actor.municipality_cut
      || snapshot.packet_ref.packet_id !== packet.packet_id
      || snapshot.packet_ref.packet_content_sha256 !== digest
      || packet.reproducibility.packet_content_sha256 !== digest) throw new Error('mismatch');
    const actions = stored.actionJson.map((value) => JSON.parse(value) as Record<string, unknown>);
    return { stored, snapshot, packet, actions };
  } catch {
    throw new ApiError(500, 'Review case integrity check failed', '');
  }
}

export const getReviewCase: IntegrityServiceHandler['getReviewCase'] = async (ctx, req) => {
  markNoCacheResponse(ctx.request);
  const actor = await actorFor(ctx.request);
  const port = workflowPort();
  const authority = currentAuthority(
    await storageCall(() => port.readAuthority(actor.actor_id, actor.municipality_cut)), actor,
  );
  const dossier = await validatedDossier(port, actor, req.caseId, req.caseVersion);
  const snapshot = dossier.snapshot;
  const permittedActions = snapshot.status === 'closed'
    ? []
    : authority.permitted_actions.filter((action) => {
      if (action === 'AssignReviewer') {
        return snapshot.status === 'open' && sameSet(authority.roles, ['coordinator']);
      }
      if (!ACTION_SET.has(action)) return false;
      const workflowAction = action as WorkflowAction;
      if (!authority.roles.some((role) => ROLE_POLICY[workflowAction].includes(role))) return false;
      if (REVIEWER_ACTIONS.has(workflowAction)) {
        return snapshot.assignment?.reviewer_id === actor.actor_id;
      }
      if (workflowAction === 'CloseReview') {
        return snapshot.last_action_type === 'NoObservations'
          || snapshot.official_outcome !== undefined;
      }
      return true;
    });
  return { ...dossier.stored, permittedActions } satisfies ReviewCaseDossierResponse;
};

export const assignReviewer: IntegrityServiceHandler['assignReviewer'] = async (ctx, req) => {
  markNoCacheResponse(ctx.request);
  const actor = await actorFor(ctx.request);
  const port = workflowPort();
  const authority = currentAuthority(
    await storageCall(() => port.readAuthority(actor.actor_id, actor.municipality_cut)),
    actor, 'AssignReviewer',
  );
  if (!sameSet(authority.roles, ['coordinator'])) {
    throw new ApiError(403, 'Municipal action not authorized', '');
  }
  const reviewer = await storageCall(() => port.readAuthority(
    req.reviewerId, actor.municipality_cut,
  ));
  if (!reviewer || !reviewer.roles.some((role) => ['rentas', 'control', 'fiscalizacion'].includes(role))) {
    throw new ApiError(404, 'Reviewer unavailable', '');
  }
  const assigner = createReviewCaseAssigner({
    resolveAuthority: async () => ({
      ...authority, roles: ['coordinator'], permitted_actions: ['AssignReviewer'],
    }),
    resolveReviewerEligibility: async () => ({
      reviewer_id: reviewer.actor_id, municipality_cut: reviewer.municipality_cut,
      eligible: true, valid_from: reviewer.valid_from,
      valid_to: reviewer.valid_to, revoked_at: reviewer.revoked_at,
    }),
    writePort: (() => {
      try { return dependencies.createAssignmentWritePort(); } catch (error) {
        return mapStorageError(error);
      }
    })(),
    newActionId: () => dependencies.newId('action'), now: dependencies.now,
  });
  try {
    const receipt = await assigner.assignReviewer({
      operationKey: operationKey(ctx.request), caseId: req.caseId,
      expectedCaseVersion: req.expectedCaseVersion, reviewerId: req.reviewerId,
    });
    return mutationResponse(receipt.case, receipt.action, receipt.replayed);
  } catch (error) { return mapDomainError(error); }
};

function legalEffect(action: WorkflowAction) {
  if (action === 'RecordOfficialDecision') return 'reflects_external_act' as const;
  if (action === 'RequestMissingRequirement' || action === 'RequestCorrection') {
    return 'external_communication_only' as const;
  }
  return 'none' as const;
}

function resultingStatus(action: WorkflowAction) {
  if (action === 'CloseReview') return 'closed' as const;
  if (action === 'RequestMissingRequirement' || action === 'RequestCorrection') {
    return 'waiting_external' as const;
  }
  return 'in_review' as const;
}

export const recordReviewAction: IntegrityServiceHandler['recordReviewAction'] = async (ctx, req) => {
  markNoCacheResponse(ctx.request);
  const actor = await actorFor(ctx.request);
  if (!ACTION_SET.has(req.actionType)) throw new ApiError(400, 'Unsupported review action', '');
  const actionType = req.actionType as WorkflowAction;
  const key = operationKey(ctx.request);
  const port = workflowPort();
  const authority = currentAuthority(
    await storageCall(() => port.readAuthority(actor.actor_id, actor.municipality_cut)),
    actor, actionType,
  );
  if (!authority.roles.some((role) => ROLE_POLICY[actionType].includes(role))) {
    throw new ApiError(403, 'Municipal action not authorized', '');
  }
  const dossier = await validatedDossier(
    port, actor, req.caseId, req.expectedCaseVersion,
  );
  const previous = dossier.snapshot;
  if (previous.status === 'closed') throw new ApiError(409, 'Review case is already closed', '');
  if (REVIEWER_ACTIONS.has(actionType)
    && previous.assignment?.reviewer_id !== actor.actor_id) {
    throw new ApiError(403, 'Review case is assigned to another reviewer', '');
  }
  const note = req.note.trim();
  if (actionType !== 'NoObservations' && actionType !== 'CloseReview' && !note) {
    throw new ApiError(400, 'A review note is required', '');
  }
  if (actionType === 'RecordOfficialDecision'
    && (!req.outcomeCode.trim() || !req.externalReference.trim())) {
    throw new ApiError(400, 'Official outcome and external reference are required', '');
  }
  if (actionType === 'CloseReview'
    && previous.last_action_type !== 'NoObservations' && previous.official_outcome === undefined) {
    throw new ApiError(409, 'An official outcome or no-observations action is required before closure', '');
  }
  const occurredAt = dependencies.now().toISOString();
  const commandSha256 = await sha256CanonicalJson({
    action: actionType, actor_id: actor.actor_id, municipality_cut: actor.municipality_cut,
    case_id: req.caseId, expected_case_version: req.expectedCaseVersion,
    note, outcome_code: req.outcomeCode.trim() || null,
    external_reference: req.externalReference.trim() || null,
  });
  const prior = await storageCall(() => port.readActionOperation({
    actorId: actor.actor_id, municipalityCut: actor.municipality_cut,
    actionType, operationKey: key, commandSha256,
  }));
  if (prior.kind === 'operation_conflict') throw new ApiError(409, 'Idempotency key conflict', '');
  if (prior.kind === 'replayed') {
    const snapshot = parseReviewCaseSnapshot(JSON.parse(prior.caseJson));
    return mutationResponse(snapshot, {
      action_id: prior.actionId, action_type: actionType, legal_effect: legalEffect(actionType),
    }, true);
  }
  const actionId = dependencies.newId('action');
  const resulting: ReviewCaseSnapshot = parseReviewCaseSnapshot({
    ...previous,
    case_version: previous.case_version + 1,
    status: resultingStatus(actionType),
    updated_at: occurredAt,
    last_action_type: actionType,
    ...(actionType === 'RecordOfficialDecision' ? {
      official_outcome: {
        outcome_code: req.outcomeCode.trim(), external_reference: req.externalReference.trim(),
        recorded_by: actor.actor_id, recorded_at: occurredAt,
      },
    } : {}),
    ...(actionType === 'CloseReview' ? { closed_at: occurredAt } : {}),
  });
  const action = {
    schema_version: '0.1.0', action_id: actionId, action_type: actionType,
    case_id: previous.case_id, municipality_cut: previous.municipality_cut,
    license_id: previous.license_id, previous_case_version: previous.case_version,
    resulting_case_version: resulting.case_version, actor_id: actor.actor_id,
    actor_roles: [...authority.roles], authority_id: authority.authority_id,
    authority_version: authority.authority_version, occurred_at: occurredAt,
    legal_effect: legalEffect(actionType), packet_ref: previous.packet_ref,
    command_sha256: commandSha256, note: note || null,
    outcome_code: req.outcomeCode.trim() || null,
    external_reference: req.externalReference.trim() || null,
  };
  const result = await storageCall(() => port.commitAction({
    operationKey: key, actorId: actor.actor_id, actionType,
    commandSha256, expectedCaseVersion: previous.case_version,
    previousCaseSnapshot: previous, resultingCaseSnapshot: resulting,
    action, authorityFence: {
      authorityId: authority.authority_id, authorityVersion: authority.authority_version,
      actorId: actor.actor_id, municipalityCut: actor.municipality_cut,
      action: actionType, evaluatedAt: occurredAt,
    },
  }));
  if (result.kind === 'operation_conflict') throw new ApiError(409, 'Idempotency key conflict', '');
  if (result.kind === 'cas_conflict') throw new ApiError(409, 'Review case version conflict', '');
  const snapshot = parseReviewCaseSnapshot(JSON.parse(result.caseJson));
  return mutationResponse(snapshot, {
    action_id: result.actionId, action_type: actionType, legal_effect: legalEffect(actionType),
  }, result.kind === 'replayed');
};
