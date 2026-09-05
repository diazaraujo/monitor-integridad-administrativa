import { z } from 'zod';

import {
  parseEvidencePacket,
  type EvidencePacket,
  type Marking,
} from './evidence-packet-contract';

/** Closed, read-only contract for ReviewCase dossier projections. */

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const CUT = /^\d{5}$/;

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const candidate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return candidate.getUTCFullYear() === Number(match[1])
    && candidate.getUTCMonth() === Number(match[2]) - 1
    && candidate.getUTCDate() === Number(match[3]);
}

const nonEmpty = z.string().min(1);
const dateTime = z.string().regex(DATE_TIME).refine((value) => (
  validCalendarDate(value) && !Number.isNaN(Date.parse(value))
));
const digest = z.string().regex(SHA256);
const markingSchema = z.enum([
  'PUBLIC', 'PII', 'LICENSED', 'MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW', 'AUTHORITY_ONLY',
]);
const uniqueStrings = z.array(nonEmpty).refine((values) => new Set(values).size === values.length);

const packetRefSchema = z.object({
  packet_id: nonEmpty,
  packet_content_sha256: digest,
  packet_schema_version: z.literal('0.1.0'),
  packet_generated_at: dateTime,
  primary_release_id: nonEmpty,
  required_markings: z.array(markingSchema).min(1).refine((values) => new Set(values).size === values.length),
}).strict();

const reviewCaseAssignmentSchema = z.object({
  reviewer_id: z.string().min(1).max(200),
  assigned_by: z.string().min(1).max(200),
  assigned_at: dateTime,
}).strict();

const reviewCaseSnapshotSchema = z.object({
  schema_version: z.literal('0.1.0'),
  case_id: z.string().min(1).max(200),
  case_version: z.number().int().min(1),
  municipality_cut: z.string().regex(CUT),
  license_id: nonEmpty,
  status: z.enum(['open', 'in_review', 'waiting_external', 'closed']),
  classification: z.array(markingSchema).min(1).refine((values) => new Set(values).size === values.length),
  created_at: dateTime,
  updated_at: dateTime,
  packet_ref: packetRefSchema,
  assignment: reviewCaseAssignmentSchema.optional(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'must not predate created_at' });
  }
  if (value.assignment && (
    Date.parse(value.assignment.assigned_at) < Date.parse(value.created_at)
      || Date.parse(value.assignment.assigned_at) > Date.parse(value.updated_at)
  )) {
    context.addIssue({
      code: 'custom',
      path: ['assignment', 'assigned_at'],
      message: 'must fall within the case snapshot lifetime',
    });
  }
});

const historicalActionEvaluationSchema = z.object({
  action_id: nonEmpty,
  action_type: z.enum([
    'OpenLicenseReview', 'AssignReviewer', 'RequestMissingRequirement', 'ResolveEstablishment',
    'RecordAlternativeExplanation', 'RecommendInspection', 'RecordInspectionOutcome',
    'RecommendAdministrativeMeasure', 'RecordOfficialDecision', 'RequestCorrection', 'CloseReview',
  ]),
  evaluated_at: dateTime,
  packet_reported_permitted: z.boolean(),
  executable: z.literal(false),
}).strict();

const dossierAssessmentSchema = z.object({
  gap_ids: uniqueStrings,
  conflict_ids: uniqueStrings,
  has_stale_release: z.boolean(),
  action_snapshot_stale: z.boolean(),
  historical_action_evaluations: z.array(historicalActionEvaluationSchema),
  historical_recommended_action_id: nonEmpty.nullable(),
}).strict().superRefine((value, context) => {
  const ids = value.historical_action_evaluations.map((item) => item.action_id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['historical_action_evaluations'], message: 'action identifiers must be unique' });
  }
});

const reviewCaseDossierOuterSchema = z.object({
  schema_version: z.literal('0.1.0'),
  case: reviewCaseSnapshotSchema,
  evidence_packet_snapshot: z.object({
    nature: z.literal('historical_non_executable'),
    packet: z.unknown(),
  }).strict(),
  assessment: dossierAssessmentSchema,
}).strict();

export type ReviewCaseStatus = 'open' | 'in_review' | 'waiting_external' | 'closed';
export type ReviewCasePacketRef = z.infer<typeof packetRefSchema>;
export type ReviewCaseAssignment = z.infer<typeof reviewCaseAssignmentSchema>;
export type ReviewCaseSnapshot = z.infer<typeof reviewCaseSnapshotSchema>;
export type HistoricalReviewCaseActionEvaluation = z.infer<typeof historicalActionEvaluationSchema>;
export type ReviewCaseDossierAssessment = z.infer<typeof dossierAssessmentSchema>;
export interface ReviewCaseDossier {
  schema_version: '0.1.0';
  case: ReviewCaseSnapshot;
  evidence_packet_snapshot: {
    nature: 'historical_non_executable';
    packet: EvidencePacket;
  };
  assessment: ReviewCaseDossierAssessment;
}

export class ReviewCaseContractError extends Error {
  readonly path: string;
  readonly code: string;

  constructor(path: string, code: string) {
    super(`${path}: ReviewCase validation failed (${code})`);
    this.name = 'ReviewCaseContractError';
    this.path = path;
    this.code = code;
  }
}

function issuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, part) => (
    typeof part === 'number' ? `${result}[${part}]` : `${result}.${String(part)}`
  ), '$');
}

function fail(path: string, code: string): never {
  throw new ReviewCaseContractError(path, code);
}

function parseShape<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  if (!issue) fail('$', 'invalid_shape');
  return fail(issuePath(issue.path), issue.code);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

export function parseReviewCaseSnapshot(value: unknown): ReviewCaseSnapshot {
  return parseShape(reviewCaseSnapshotSchema, value);
}

export function parseReviewCaseDossier(value: unknown): ReviewCaseDossier {
  const outer = parseShape(reviewCaseDossierOuterSchema, value);
  let evidencePacket: EvidencePacket;
  try {
    evidencePacket = parseEvidencePacket(outer.evidence_packet_snapshot.packet);
  } catch {
    return fail('$.evidence_packet_snapshot.packet', 'invalid_evidence_packet');
  }

  const snapshot = outer.case;
  const packetRef = snapshot.packet_ref;
  if (evidencePacket.case_id !== snapshot.case_id) fail('$.evidence_packet_snapshot.packet.case_id', 'case_mismatch');
  if (evidencePacket.municipality_cut !== snapshot.municipality_cut) {
    fail('$.evidence_packet_snapshot.packet.municipality_cut', 'municipality_mismatch');
  }
  if (evidencePacket.license.source_license_id !== snapshot.license_id) {
    fail('$.evidence_packet_snapshot.packet.license.source_license_id', 'license_mismatch');
  }
  if (!sameSet(evidencePacket.classification, snapshot.classification)) {
    fail('$.evidence_packet_snapshot.packet.classification', 'classification_mismatch');
  }
  if (evidencePacket.packet_id !== packetRef.packet_id) fail('$.case.packet_ref.packet_id', 'packet_mismatch');
  if (evidencePacket.schema_version !== packetRef.packet_schema_version) {
    fail('$.case.packet_ref.packet_schema_version', 'packet_schema_mismatch');
  }
  if (evidencePacket.generated_at !== packetRef.packet_generated_at) {
    fail('$.case.packet_ref.packet_generated_at', 'packet_timestamp_mismatch');
  }
  if (evidencePacket.reproducibility.packet_content_sha256 !== packetRef.packet_content_sha256) {
    fail('$.case.packet_ref.packet_content_sha256', 'packet_hash_mismatch');
  }
  const primaryQueries = evidencePacket.reproducibility.input_queries.filter((query) => (
    query.producer === 'inteligencia-inmobiliaria' && query.capability === 'patents.get'
  ));
  if (primaryQueries.length !== 1 || primaryQueries[0]?.release_id !== packetRef.primary_release_id) {
    fail('$.case.packet_ref.primary_release_id', 'primary_release_mismatch');
  }
  if (!evidencePacket.pinned_releases.some((release) => (
    release.producer === 'inteligencia-inmobiliaria'
      && release.product === 'commercial-licenses'
      && release.capability === 'patents.get'
      && release.release_id === packetRef.primary_release_id
  ))) {
    fail('$.case.packet_ref.primary_release_id', 'primary_release_not_pinned');
  }
  const effectiveMarkings = new Set<Marking>(evidencePacket.classification);
  evidencePacket.evidence.forEach((artifact) => {
    artifact.classification.forEach((marking) => effectiveMarkings.add(marking));
  });
  evidencePacket.pinned_releases.forEach((release) => effectiveMarkings.add(release.data_marking));
  if (!sameSet(packetRef.required_markings, [...effectiveMarkings])) {
    fail('$.case.packet_ref.required_markings', 'required_markings_mismatch');
  }

  const gapIds = evidencePacket.gaps.map((gap) => gap.gap_id);
  const conflictIds = evidencePacket.conflicts.map((conflict) => conflict.conflict_id);
  if (!sameSet(outer.assessment.gap_ids, gapIds)) fail('$.assessment.gap_ids', 'gap_projection_mismatch');
  if (!sameSet(outer.assessment.conflict_ids, conflictIds)) {
    fail('$.assessment.conflict_ids', 'conflict_projection_mismatch');
  }
  const hasStaleRelease = evidencePacket.pinned_releases.some((release) => release.availability === 'stale_last_good');
  if (outer.assessment.has_stale_release !== hasStaleRelease) {
    fail('$.assessment.has_stale_release', 'freshness_projection_mismatch');
  }
  const historicalActions = outer.assessment.historical_action_evaluations;
  if (historicalActions.length !== evidencePacket.permitted_next_actions.length) {
    fail('$.assessment.historical_action_evaluations', 'action_projection_mismatch');
  }
  evidencePacket.permitted_next_actions.forEach((packetAction) => {
    const projected = historicalActions.find((item) => item.action_id === packetAction.action_id);
    if (!projected
      || projected.action_type !== packetAction.action_type
      || projected.evaluated_at !== packetAction.evaluated_at
      || projected.packet_reported_permitted !== packetAction.permitted) {
      fail('$.assessment.historical_action_evaluations', 'action_projection_mismatch');
    }
  });
  if (outer.assessment.historical_recommended_action_id !== (evidencePacket.recommended_next_action_id ?? null)) {
    fail('$.assessment.historical_recommended_action_id', 'recommendation_projection_mismatch');
  }
  const actionSnapshotStale = evidencePacket.permitted_next_actions.some(
    (action) => Date.parse(action.evaluated_at) < Date.parse(snapshot.updated_at),
  );
  if (outer.assessment.action_snapshot_stale !== actionSnapshotStale) {
    fail('$.assessment.action_snapshot_stale', 'action_freshness_mismatch');
  }

  return {
    schema_version: outer.schema_version,
    case: snapshot,
    evidence_packet_snapshot: {
      nature: outer.evidence_packet_snapshot.nature,
      packet: evidencePacket,
    },
    assessment: outer.assessment,
  };
}

export type { Marking };
