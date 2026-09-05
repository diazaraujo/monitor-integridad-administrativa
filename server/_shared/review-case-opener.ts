import { z } from 'zod';

import {
  CommercialLicensesClientError,
  type CommercialLicensesRepresentation,
} from './commercial-licenses-client';
import type {
  EvidencePacketBuilder,
  EvidencePacketSupplement,
} from './evidence-packet-builder';
import { EvidencePacketBuilderError } from './evidence-packet-builder';
import {
  canonicalizeJson,
  hashEvidencePacketContent,
  sha256CanonicalJson,
} from './evidence-packet-canonical';
import {
  parseEvidencePacket,
  type EvidencePacket,
  type Marking,
} from './evidence-packet-contract';
import {
  parseReviewCaseSnapshot,
  type ReviewCasePacketRef,
  type ReviewCaseSnapshot,
} from './review-case-contract';

const DEFAULT_MAX_PACKET_BYTES = 2 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CUT = /^\d{5}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const OPERATION_KEY = /^[\x21-\x7e]{1,255}$/;

const commandSchema = z.object({
  operationKey: z.string().regex(OPERATION_KEY),
  municipalityCut: z.string().regex(CUT),
  licenseId: z.string().regex(IDENTIFIER),
  releaseId: z.string().min(1).max(300),
  effectiveOn: z.string().regex(DATE).optional(),
  representation: z.enum(['public', 'municipal_restricted']).optional(),
}).strict();

const authoritySchema = z.object({
  authority_id: z.string().regex(IDENTIFIER),
  authority_version: z.number().int().min(1),
  actor_id: z.string().regex(IDENTIFIER),
  municipality_cut: z.string().regex(CUT),
  roles: z.array(z.enum(['rentas', 'control'])).min(1)
    .refine((values) => new Set(values).size === values.length),
  permitted_actions: z.array(z.literal('OpenLicenseReview')).min(1),
  allowed_markings: z.array(z.enum([
    'PUBLIC', 'PII', 'LICENSED', 'MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW', 'AUTHORITY_ONLY',
  ])).min(1).refine((values) => new Set(values).size === values.length),
  allowed_representations: z.array(z.enum(['public', 'municipal_restricted'])).min(1)
    .refine((values) => new Set(values).size === values.length),
  valid_from: z.string().datetime({ offset: true }),
  valid_to: z.string().datetime({ offset: true }).nullable(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

const jsonObjects = z.array(z.record(z.string(), z.unknown()));
const queryRecordsSchema = z.array(z.object({
  producer: z.string().min(1),
  capability: z.string().min(1),
  releaseId: z.string().min(1),
  request: z.unknown(),
  response: z.unknown(),
}).strict());
const supplementSchema = z.object({
  sourceRefs: jsonObjects.optional(),
  pinnedReleases: jsonObjects.optional(),
  queryRecords: queryRecordsSchema.optional(),
  evidence: jsonObjects.optional(),
  gaps: jsonObjects.optional(),
  conflicts: jsonObjects.optional(),
  alternativeExplanations: jsonObjects.optional(),
  legalAuthorities: jsonObjects.optional(),
}).strict();

const actionPolicySchema = z.object({
  permittedNextActions: z.array(z.record(z.string(), z.unknown())).min(1),
  recommendedNextActionId: z.string().min(1).nullable().optional(),
  supplement: supplementSchema.optional(),
}).strict();

const markingSchema = z.enum([
  'PUBLIC', 'PII', 'LICENSED', 'MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW', 'AUTHORITY_ONLY',
]);
const packetRefShapeSchema = z.object({
  packet_id: z.string().min(1),
  packet_content_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  packet_schema_version: z.literal('0.1.0'),
  packet_generated_at: z.string().datetime({ offset: true }),
  primary_release_id: z.string().min(1),
  required_markings: z.array(markingSchema).min(1),
}).strict();
const replayActionSchema = z.object({
  schema_version: z.literal('0.1.0'),
  action_id: z.string().regex(IDENTIFIER),
  action_type: z.literal('OpenLicenseReview'),
  case_id: z.string().regex(IDENTIFIER),
  municipality_cut: z.string().regex(CUT),
  license_id: z.string().regex(IDENTIFIER),
  previous_case_version: z.literal(0),
  resulting_case_version: z.literal(1),
  actor_id: z.string().regex(IDENTIFIER),
  actor_roles: z.array(z.enum(['rentas', 'control'])).min(1)
    .refine((values) => new Set(values).size === values.length),
  authority_id: z.string().regex(IDENTIFIER),
  authority_version: z.number().int().min(1),
  occurred_at: z.string().datetime({ offset: true }),
  legal_effect: z.literal('none'),
  packet_ref: packetRefShapeSchema,
  command_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();
const replayReceiptSchema = z.object({
  schema_version: z.literal('0.1.0'),
  case: z.unknown(),
  action: replayActionSchema,
  replayed: z.boolean(),
}).strict();
const operationResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('miss') }).strict(),
  z.object({ kind: z.literal('replayed'), receipt: z.unknown() }).strict(),
  z.object({ kind: z.literal('operation_conflict') }).strict(),
]);
const commitResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('committed') }).strict(),
  z.object({ kind: z.literal('replayed'), receipt: z.unknown() }).strict(),
  z.object({ kind: z.literal('operation_conflict') }).strict(),
  z.object({ kind: z.literal('active_case_conflict') }).strict(),
  z.object({ kind: z.literal('cas_conflict') }).strict(),
]);

const BASE_CLASSIFICATION: readonly Marking[] = ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'];

export interface OpenLicenseReviewCommand {
  /** Derived from the transport Idempotency-Key header, never from request JSON. */
  operationKey: string;
  municipalityCut: string;
  licenseId: string;
  releaseId: string;
  effectiveOn?: string;
  representation?: CommercialLicensesRepresentation;
}

/** Returned by a server adapter that closes over authenticated request context. */
export interface OpenLicenseReviewAuthority {
  authority_id: string;
  authority_version: number;
  actor_id: string;
  municipality_cut: string;
  roles: ('rentas' | 'control')[];
  permitted_actions: 'OpenLicenseReview'[];
  allowed_markings: Marking[];
  allowed_representations: CommercialLicensesRepresentation[];
  valid_from: string;
  valid_to: string | null;
  revoked_at: string | null;
}

export interface OpenLicenseReviewAuthorityRequest {
  action: 'OpenLicenseReview';
  municipalityCut: string;
}

export type OpenLicenseReviewAuthorityPort = (
  request: OpenLicenseReviewAuthorityRequest,
) => Promise<unknown | null>;

export interface OpenLicenseReviewPolicyRequest {
  action: 'OpenLicenseReview';
  municipalityCut: string;
  licenseId: string;
  actorId: string;
  roles: readonly ('rentas' | 'control')[];
  evaluatedAt: string;
}

export interface OpenLicenseReviewPolicy {
  permittedNextActions: Record<string, unknown>[];
  recommendedNextActionId?: string | null;
  supplement?: EvidencePacketSupplement;
}

/** Policy is server-owned; historical packet actions never authorize this command. */
export type OpenLicenseReviewPolicyPort = (
  request: OpenLicenseReviewPolicyRequest,
) => Promise<unknown>;

export interface OpenLicenseReviewActionEvent {
  schema_version: '0.1.0';
  action_id: string;
  action_type: 'OpenLicenseReview';
  case_id: string;
  municipality_cut: string;
  license_id: string;
  previous_case_version: 0;
  resulting_case_version: 1;
  actor_id: string;
  actor_roles: ('rentas' | 'control')[];
  authority_id: string;
  authority_version: number;
  occurred_at: string;
  legal_effect: 'none';
  packet_ref: ReviewCasePacketRef;
  command_sha256: string;
}

export interface OpenLicenseReviewReceipt {
  schema_version: '0.1.0';
  case: ReviewCaseSnapshot;
  action: OpenLicenseReviewActionEvent;
  replayed: boolean;
}

export interface CommitOpenLicenseReviewRequest {
  operationKey: string;
  commandSha256: string;
  activeCaseKey: string;
  expectedCaseVersion: 0;
  caseSnapshot: ReviewCaseSnapshot;
  evidencePacketSnapshot: {
    nature: 'historical_non_executable';
    json: string;
    bytes: number;
  };
  action: OpenLicenseReviewActionEvent;
  /** The transaction must compare this fence to current authority before writing. */
  authorityFence: {
    authorityId: string;
    authorityVersion: number;
    actorId: string;
    municipalityCut: string;
    action: 'OpenLicenseReview';
    requiredMarkings: Marking[];
    representation: CommercialLicensesRepresentation;
    evaluatedAt: string;
  };
}

export type CommitOpenLicenseReviewResult =
  | { kind: 'committed' }
  | { kind: 'replayed'; receipt: unknown }
  | { kind: 'operation_conflict' }
  | { kind: 'active_case_conflict' }
  | { kind: 'cas_conflict' };

export interface OpenLicenseReviewOperationLookup {
  /**
   * Storage identity is scoped by actor + this action + key, never by the
   * client key alone. municipalityCut participates in digest validation, not
   * in the idempotency namespace.
   */
  operationKey: string;
  commandSha256: string;
  actorId: string;
  municipalityCut: string;
}

export type OpenLicenseReviewOperationResult =
  | { kind: 'miss' }
  | { kind: 'replayed'; receipt: unknown }
  | { kind: 'operation_conflict' };

/**
 * Must revalidate authorityFence and persist the idempotency binding, packet,
 * case and action in one transaction. A stale authority fence is a CAS conflict.
 */
export interface OpenLicenseReviewWritePort {
  /**
   * Authoritative, fail-closed lookup. It must use the complete lookup tuple;
   * the later commit still resolves lookup/commit races.
   */
  readOpenLicenseReviewOperation(
    lookup: OpenLicenseReviewOperationLookup,
  ): Promise<OpenLicenseReviewOperationResult>;
  commitOpenLicenseReview(
    request: CommitOpenLicenseReviewRequest,
  ): Promise<CommitOpenLicenseReviewResult>;
}

export interface ReviewCaseOpenerConfig {
  evidencePacketBuilder: EvidencePacketBuilder;
  resolveAuthority: OpenLicenseReviewAuthorityPort;
  evaluatePolicy: OpenLicenseReviewPolicyPort;
  writePort: OpenLicenseReviewWritePort;
  newCaseId: () => string;
  newActionId: () => string;
  now?: () => Date;
  maxEvidencePacketBytes?: number;
}

export interface ReviewCaseOpener {
  openLicenseReview(command: OpenLicenseReviewCommand): Promise<OpenLicenseReviewReceipt>;
}

export type ReviewCaseOpenerErrorKind =
  | 'invalid_request'
  | 'not_found_or_denied'
  | 'authority_unavailable'
  | 'policy_unavailable'
  | 'upstream_unavailable'
  | 'packet_too_large'
  | 'integrity_failure'
  | 'storage_unavailable'
  | 'idempotency_conflict'
  | 'case_conflict';

/** Safe error: it never retains command bodies, evidence or storage errors. */
export class ReviewCaseOpenerError extends Error {
  readonly kind: ReviewCaseOpenerErrorKind;

  constructor(kind: ReviewCaseOpenerErrorKind, message: string) {
    super(message);
    this.name = 'ReviewCaseOpenerError';
    this.kind = kind;
  }
}

export function createReviewCaseOpener(config: ReviewCaseOpenerConfig): ReviewCaseOpener {
  const maxPacketBytes = validSizeCap(config.maxEvidencePacketBytes);
  validateIdentifier(config.newCaseId, 'case');
  validateIdentifier(config.newActionId, 'action');
  const now = config.now ?? (() => new Date());

  return {
    async openLicenseReview(rawCommand) {
      const command = parseCommand(rawCommand);
      const authorizedAt = validServerTimestamp(now());
      const authority = await resolveAuthority(config.resolveAuthority, command.municipalityCut);
      requireCurrentAuthority(authority, command.municipalityCut, authorizedAt);
      requireAllowedMarkings(authority, BASE_CLASSIFICATION);
      if (!authority.allowed_representations.includes(command.representation ?? 'public')) {
        throw notFoundOrDenied();
      }

      const commandSha256 = await hashCommand(command, authority.actor_id);
      const priorOperation = await readOperation(config.writePort, {
        operationKey: command.operationKey,
        commandSha256,
        actorId: authority.actor_id,
        municipalityCut: command.municipalityCut,
      });
      if (priorOperation.kind === 'replayed') {
        const receipt = parseReceipt(
          priorOperation.receipt, true, commandSha256, command, authority,
        );
        requireAllowedMarkings(authority, receipt.case.packet_ref.required_markings);
        return receipt;
      }
      if (priorOperation.kind === 'operation_conflict') {
        throw new ReviewCaseOpenerError(
          'idempotency_conflict',
          'The operation key was already used for another command',
        );
      }

      const policy = await evaluatePolicy(config.evaluatePolicy, command, authority, authorizedAt);
      const caseId = generatedIdentifier(config.newCaseId, 'case');
      const actionId = generatedIdentifier(config.newActionId, 'action');
      const packet = await buildPacket(config.evidencePacketBuilder, command, policy, caseId);
      const openedAt = validServerTimestamp(now());
      if (Date.parse(openedAt) < Date.parse(authorizedAt)) {
        throw new ReviewCaseOpenerError('integrity_failure', 'Server clock moved backwards');
      }
      requireCurrentAuthority(authority, command.municipalityCut, openedAt);
      if (Date.parse(packet.generated_at) > Date.parse(openedAt)) {
        throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
      }
      const requiredMarkings = collectEffectiveMarkings(packet);
      requireAllowedMarkings(authority, requiredMarkings);

      const packetJson = canonicalizeJson(packet);
      const packetBytes = new TextEncoder().encode(packetJson).byteLength;
      if (packetBytes > maxPacketBytes) {
        throw new ReviewCaseOpenerError(
          'packet_too_large',
          'The review evidence packet cannot be persisted',
        );
      }

      const packetRef = packetReference(packet, command.releaseId, requiredMarkings);
      const snapshot = parseSnapshot({
        schema_version: '0.1.0',
        case_id: caseId,
        case_version: 1,
        municipality_cut: command.municipalityCut,
        license_id: command.licenseId,
        status: 'open',
        classification: [...BASE_CLASSIFICATION],
        created_at: openedAt,
        updated_at: openedAt,
        packet_ref: packetRef,
      });
      const action = actionEvent({
        actionId,
        snapshot,
        authority,
        openedAt,
        commandSha256,
      });
      const receipt = receiptFor(snapshot, action, false);

      const result = await commit(config.writePort, {
        operationKey: command.operationKey,
        commandSha256,
        activeCaseKey: `${command.municipalityCut}:${command.licenseId}`,
        expectedCaseVersion: 0,
        caseSnapshot: snapshot,
        evidencePacketSnapshot: {
          nature: 'historical_non_executable',
          json: packetJson,
          bytes: packetBytes,
        },
        action,
        authorityFence: {
          authorityId: authority.authority_id,
          authorityVersion: authority.authority_version,
          actorId: authority.actor_id,
          municipalityCut: authority.municipality_cut,
          action: 'OpenLicenseReview',
          requiredMarkings,
          representation: command.representation ?? 'public',
          evaluatedAt: openedAt,
        },
      });

      if (result.kind === 'committed') return receipt;
      if (result.kind === 'replayed') {
        const replayed = parseReceipt(
          result.receipt, true, commandSha256, command, authority,
        );
        requireAllowedMarkings(authority, replayed.case.packet_ref.required_markings);
        return replayed;
      }
      if (result.kind === 'operation_conflict') {
        throw new ReviewCaseOpenerError(
          'idempotency_conflict',
          'The operation key was already used for another command',
        );
      }
      throw new ReviewCaseOpenerError('case_conflict', 'The review case could not be opened');
    },
  };
}

function parseCommand(value: unknown): OpenLicenseReviewCommand {
  const result = commandSchema.safeParse(value);
  if (!result.success || (result.data.effectiveOn && !validCalendarDate(result.data.effectiveOn))) {
    throw new ReviewCaseOpenerError('invalid_request', 'Open review request is invalid');
  }
  return { ...result.data, representation: result.data.representation ?? 'public' };
}

function validSizeCap(value: number | undefined): number {
  const cap = value ?? DEFAULT_MAX_PACKET_BYTES;
  if (!Number.isSafeInteger(cap) || cap <= 0) {
    throw new ReviewCaseOpenerError('invalid_request', 'Review case opener configuration is invalid');
  }
  return cap;
}

function validateIdentifier(factory: () => string, label: string): void {
  if (typeof factory !== 'function') {
    throw new ReviewCaseOpenerError('invalid_request', `${label} identifier factory is invalid`);
  }
}

function generatedIdentifier(factory: () => string, label: string): string {
  let value: string;
  try {
    value = factory();
  } catch {
    throw new ReviewCaseOpenerError('integrity_failure', `${label} identifier could not be generated`);
  }
  if (!IDENTIFIER.test(value)) {
    throw new ReviewCaseOpenerError('integrity_failure', `${label} identifier is invalid`);
  }
  return value;
}

function validServerTimestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ReviewCaseOpenerError('integrity_failure', 'Server clock is invalid');
  }
  return value.toISOString();
}

async function resolveAuthority(
  port: OpenLicenseReviewAuthorityPort,
  municipalityCut: string,
): Promise<OpenLicenseReviewAuthority> {
  let value: unknown | null;
  try {
    value = await port({ action: 'OpenLicenseReview', municipalityCut });
  } catch {
    throw new ReviewCaseOpenerError('authority_unavailable', 'Review authority is unavailable');
  }
  if (value === null) throw notFoundOrDenied();
  const result = authoritySchema.safeParse(value);
  if (!result.success) throw notFoundOrDenied();
  return result.data;
}

function requireCurrentAuthority(
  authority: OpenLicenseReviewAuthority,
  municipalityCut: string,
  openedAt: string,
): void {
  const instant = Date.parse(openedAt);
  if (
    authority.municipality_cut !== municipalityCut
    || authority.revoked_at !== null
    || Date.parse(authority.valid_from) > instant
    || (authority.valid_to !== null && Date.parse(authority.valid_to) < instant)
    || !authority.permitted_actions.includes('OpenLicenseReview')
    || !authority.roles.some((role) => role === 'rentas' || role === 'control')
  ) {
    throw notFoundOrDenied();
  }
}

async function evaluatePolicy(
  port: OpenLicenseReviewPolicyPort,
  command: OpenLicenseReviewCommand,
  authority: OpenLicenseReviewAuthority,
  evaluatedAt: string,
): Promise<OpenLicenseReviewPolicy> {
  let value: unknown;
  try {
    value = await port({
      action: 'OpenLicenseReview',
      municipalityCut: command.municipalityCut,
      licenseId: command.licenseId,
      actorId: authority.actor_id,
      roles: [...authority.roles],
      evaluatedAt,
    });
  } catch {
    throw new ReviewCaseOpenerError('policy_unavailable', 'Review action policy is unavailable');
  }
  const result = actionPolicySchema.safeParse(value);
  if (!result.success) {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review action policy is invalid');
  }
  return result.data;
}

async function buildPacket(
  builder: EvidencePacketBuilder,
  command: OpenLicenseReviewCommand,
  policy: OpenLicenseReviewPolicy,
  caseId: string,
): Promise<EvidencePacket> {
  let packet: EvidencePacket;
  try {
    packet = await builder.build({
      ...(policy.supplement ?? {}),
      caseId,
      municipalityCut: command.municipalityCut,
      classification: [...BASE_CLASSIFICATION],
      licenseId: command.licenseId,
      releaseId: command.releaseId,
      effectiveOn: command.effectiveOn,
      representation: command.representation,
      permittedNextActions: policy.permittedNextActions,
      recommendedNextActionId: policy.recommendedNextActionId,
    });
  } catch (error) {
    if (error instanceof EvidencePacketBuilderError) {
      throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
    }
    if (error instanceof CommercialLicensesClientError) {
      const availabilityFailure = error.kind === 'timeout'
        || error.kind === 'network'
        || (error.kind === 'http' && error.retryable === true);
      throw new ReviewCaseOpenerError(
        availabilityFailure ? 'upstream_unavailable' : 'integrity_failure',
        availabilityFailure
          ? 'Review evidence could not be built'
          : 'Review evidence failed validation',
      );
    }
    throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
  }
  try {
    packet = parseEvidencePacket(packet);
  } catch {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
  }
  if (
    packet.case_id !== caseId
    || packet.municipality_cut !== command.municipalityCut
    || packet.license.source_license_id !== command.licenseId
    || !sameSet(packet.classification, BASE_CLASSIFICATION)
  ) {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
  }
  const primaryReleases = packet.pinned_releases.filter(
    (release) => release.capability === 'patents.get',
  );
  const primaryQueries = packet.reproducibility.input_queries.filter(
    (query) => query.capability === 'patents.get',
  );
  let computedHash: string;
  try {
    computedHash = await hashEvidencePacketContent(packet);
  } catch {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
  }
  if (
    primaryReleases.length !== 1
    || primaryQueries.length !== 1
    || primaryReleases[0]?.producer !== 'inteligencia-inmobiliaria'
    || primaryReleases[0]?.product !== 'commercial-licenses'
    || primaryReleases[0]?.release_id !== command.releaseId
    || primaryQueries[0]?.producer !== 'inteligencia-inmobiliaria'
    || primaryQueries[0]?.release_id !== command.releaseId
    || computedHash !== packet.reproducibility.packet_content_sha256
  ) {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review evidence failed validation');
  }
  return packet;
}

function collectEffectiveMarkings(packet: EvidencePacket): Marking[] {
  return [...new Set<Marking>([
    ...packet.classification,
    ...packet.evidence.flatMap((artifact) => artifact.classification),
    ...packet.pinned_releases.map((release) => release.data_marking),
  ])].sort();
}

function requireAllowedMarkings(
  authority: OpenLicenseReviewAuthority,
  requiredMarkings: readonly Marking[],
): void {
  const allowed = new Set(authority.allowed_markings);
  if (!requiredMarkings.every((marking) => allowed.has(marking))) throw notFoundOrDenied();
}

function packetReference(
  packet: EvidencePacket,
  releaseId: string,
  requiredMarkings: Marking[],
): ReviewCasePacketRef {
  return {
    packet_id: packet.packet_id,
    packet_content_sha256: packet.reproducibility.packet_content_sha256,
    packet_schema_version: packet.schema_version,
    packet_generated_at: packet.generated_at,
    primary_release_id: releaseId,
    required_markings: requiredMarkings,
  };
}

function parseSnapshot(value: unknown): ReviewCaseSnapshot {
  try {
    return parseReviewCaseSnapshot(value);
  } catch {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review case snapshot is invalid');
  }
}

async function hashCommand(
  command: OpenLicenseReviewCommand,
  actorId: string,
): Promise<string> {
  try {
    return await sha256CanonicalJson({
      action: 'OpenLicenseReview',
      municipality_cut: command.municipalityCut,
      license_id: command.licenseId,
      release_id: command.releaseId,
      effective_on: command.effectiveOn ?? null,
      representation: command.representation ?? 'public',
      actor_id: actorId,
    });
  } catch {
    throw new ReviewCaseOpenerError('integrity_failure', 'Review command could not be hashed');
  }
}

async function readOperation(
  port: OpenLicenseReviewWritePort,
  lookup: OpenLicenseReviewOperationLookup,
): Promise<OpenLicenseReviewOperationResult> {
  let value: unknown;
  try {
    value = await port.readOpenLicenseReviewOperation(lookup);
  } catch {
    throw new ReviewCaseOpenerError('storage_unavailable', 'Review case storage is unavailable');
  }
  const result = operationResultSchema.safeParse(value);
  if (!result.success) throw integrityFailure();
  return result.data;
}

function actionEvent(input: {
  actionId: string;
  snapshot: ReviewCaseSnapshot;
  authority: OpenLicenseReviewAuthority;
  openedAt: string;
  commandSha256: string;
}): OpenLicenseReviewActionEvent {
  return {
    schema_version: '0.1.0',
    action_id: input.actionId,
    action_type: 'OpenLicenseReview',
    case_id: input.snapshot.case_id,
    municipality_cut: input.snapshot.municipality_cut,
    license_id: input.snapshot.license_id,
    previous_case_version: 0,
    resulting_case_version: 1,
    actor_id: input.authority.actor_id,
    actor_roles: [...input.authority.roles].sort(),
    authority_id: input.authority.authority_id,
    authority_version: input.authority.authority_version,
    occurred_at: input.openedAt,
    legal_effect: 'none',
    packet_ref: input.snapshot.packet_ref,
    command_sha256: input.commandSha256,
  };
}

function receiptFor(
  snapshot: ReviewCaseSnapshot,
  action: OpenLicenseReviewActionEvent,
  replayed: boolean,
): OpenLicenseReviewReceipt {
  return { schema_version: '0.1.0', case: snapshot, action, replayed };
}

function parseReceipt(
  value: unknown,
  replayed: boolean,
  expectedCommandSha256: string,
  command: OpenLicenseReviewCommand,
  authority: OpenLicenseReviewAuthority,
): OpenLicenseReviewReceipt {
  const result = replayReceiptSchema.safeParse(value);
  if (!result.success) throw integrityFailure();
  const snapshot = parseSnapshot(result.data.case);
  const action = result.data.action;
  if (
    action.command_sha256 !== expectedCommandSha256
    || action.actor_id !== authority.actor_id
    || action.case_id !== snapshot.case_id
    || action.municipality_cut !== snapshot.municipality_cut
    || action.license_id !== snapshot.license_id
    || action.previous_case_version !== 0
    || action.resulting_case_version !== 1
    || snapshot.case_version !== 1
    || snapshot.status !== 'open'
    || !sameSet(snapshot.classification, BASE_CLASSIFICATION)
    || snapshot.municipality_cut !== command.municipalityCut
    || snapshot.license_id !== command.licenseId
    || snapshot.packet_ref.primary_release_id !== command.releaseId
    || action.occurred_at !== snapshot.created_at
    || snapshot.updated_at !== snapshot.created_at
    || !samePacketRef(action.packet_ref, snapshot.packet_ref)
  ) {
    throw integrityFailure();
  }
  return receiptFor(snapshot, action, replayed);
}

async function commit(
  port: OpenLicenseReviewWritePort,
  request: CommitOpenLicenseReviewRequest,
): Promise<CommitOpenLicenseReviewResult> {
  let value: unknown;
  try {
    value = await port.commitOpenLicenseReview(request);
  } catch {
    throw new ReviewCaseOpenerError('storage_unavailable', 'Review case storage is unavailable');
  }
  const result = commitResultSchema.safeParse(value);
  if (!result.success) throw integrityFailure();
  return result.data;
}

function samePacketRef(left: unknown, right: ReviewCasePacketRef): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const wanted = new Set(right);
  return left.every((value) => wanted.has(value));
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const candidate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return candidate.getUTCFullYear() === Number(match[1])
    && candidate.getUTCMonth() === Number(match[2]) - 1
    && candidate.getUTCDate() === Number(match[3]);
}

function notFoundOrDenied(): ReviewCaseOpenerError {
  return new ReviewCaseOpenerError(
    'not_found_or_denied',
    'Review authority or evidence was not found or is not accessible',
  );
}

function integrityFailure(): ReviewCaseOpenerError {
  return new ReviewCaseOpenerError('integrity_failure', 'Review case data failed integrity validation');
}
