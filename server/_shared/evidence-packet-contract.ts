import { z } from 'zod';

/**
 * Fail-closed runtime contract for EvidencePacket v0.1.0.
 *
 * The YAML contract remains the authority. This module mirrors its closed
 * object shapes and adds the referential checks that JSON Schema cannot
 * express without application context. Error messages deliberately omit
 * rejected values so packets cannot leak evidence through logs.
 */

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const CUT = /^\d{5}$/;
const LEGAL_ENTITY_RUT = /^\d{7,8}-[\dKk]$/;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

const nonEmpty = z.string().min(1);
const nullableString = z.string().nullable();
const dateTime = z.string().regex(DATE_TIME).refine((value) => validCalendarDate(value) && !Number.isNaN(Date.parse(value)));
const nullableDateTime = dateTime.nullable();
const date = z.string().regex(DATE).refine(validCalendarDate);
const digest = z.string().regex(SHA256);
const cutCode = z.string().regex(CUT);
const uriReference = z.string().refine((value) => {
  if (/\s/.test(value)) return false;
  try {
    new URL(value, 'file:///');
    return true;
  } catch {
    return false;
  }
});

const uniqueStrings = (minimum = 0, nonEmptyItems = true) => z.array(nonEmptyItems ? nonEmpty : z.string())
  .min(minimum)
  .refine((values) => new Set(values).size === values.length);

const markingSchema = z.enum([
  'PUBLIC', 'PII', 'LICENSED', 'MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW', 'AUTHORITY_ONLY',
]);

const addressSchema = z.object({
  original: nonEmpty,
  normalized: nullableString.optional(),
  unit: nullableString.optional(),
  municipality_cut: cutCode,
}).strict();

const pinnedReleaseSchema = z.object({
  producer: nonEmpty,
  product: nonEmpty,
  capability: nonEmpty,
  capability_version: nonEmpty,
  release_id: nonEmpty,
  schema_version: nonEmpty,
  data_as_of: dateTime,
  promoted_at: dateTime,
  quality_status: z.enum(['promoted', 'trusted']),
  availability: z.enum(['current', 'stale_last_good']),
  data_marking: markingSchema,
  last_good_release_id: nullableString,
  quality_report_uri: uriReference,
  queried_at: dateTime,
  response_sha256: digest.nullable().optional(),
  limitation_ids: uniqueStrings().optional(),
}).strict().superRefine((value, context) => {
  if (value.availability === 'stale_last_good' && !value.last_good_release_id) {
    context.addIssue({ code: 'custom', path: ['last_good_release_id'], message: 'required for stale_last_good availability' });
  }
});

const commercialLicenseSnapshotSchema = z.object({
  license_id: nonEmpty,
  source_license_id: nonEmpty,
  license_number: nullableString.optional(),
  municipality_cut: cutCode,
  license_type: nonEmpty,
  reported_status: nonEmpty,
  provisional_status: z.enum(['provisional', 'definitive', 'unknown']),
  applied_at: nullableDateTime.optional(),
  granted_at: nullableDateTime.optional(),
  renewed_at: nullableDateTime.optional(),
  expires_at: nullableDateTime.optional(),
  address: addressSchema,
  activities: z.array(z.string()).optional(),
  observed_at: dateTime,
  source_refs: uniqueStrings(1),
}).strict();

const licenseEventSchema = z.object({
  event_id: nonEmpty,
  event_type: z.enum([
    'application', 'granted', 'renewed', 'modified', 'holder_changed', 'activity_changed',
    'address_changed', 'provisional_converted', 'suspended', 'expired', 'revoked', 'closed',
    'reopened', 'regularized', 'other',
  ]),
  effective_at: nullableDateTime.optional(),
  observed_at: dateTime,
  previous_status: nullableString.optional(),
  next_status: nullableString.optional(),
  administrative_act_ref: nullableString.optional(),
  source_refs: uniqueStrings(1),
}).strict();

const establishmentSchema = z.object({
  establishment_id: nonEmpty,
  name: nullableString.optional(),
  address: addressSchema,
  valid_from: nullableDateTime.optional(),
  valid_to: nullableDateTime.optional(),
  source_refs: uniqueStrings(1),
}).strict().superRefine((value, context) => {
  if (value.valid_from && value.valid_to && Date.parse(value.valid_from) > Date.parse(value.valid_to)) {
    context.addIssue({ code: 'custom', path: ['valid_to'], message: 'must not predate valid_from' });
  }
});

const parcelCandidateSchema = z.object({
  candidate_id: nonEmpty,
  parcel_id: nullableString.optional(),
  role: nullableString.optional(),
  method: z.enum(['source_role_exact', 'normalized_address_exact', 'spatial', 'composite', 'manual_review', 'none']),
  confidence: z.number().finite().min(0).max(1),
  parcel_release_id: nonEmpty,
  explanation: nullableString.optional(),
  source_refs: uniqueStrings(1),
}).strict();

const parcelResolutionSchema = z.object({
  resolution_id: nonEmpty,
  establishment_id: nonEmpty,
  status: z.enum(['resolved', 'ambiguous', 'unresolved']),
  selected_candidate_id: nullableString,
  candidates: z.array(parcelCandidateSchema),
  resolved_at: dateTime,
  justification: nullableString.optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'resolved') {
    if (!value.selected_candidate_id) {
      context.addIssue({ code: 'custom', path: ['selected_candidate_id'], message: 'required for resolved status' });
    } else if (!value.candidates.some((candidate) => candidate.candidate_id === value.selected_candidate_id)) {
      context.addIssue({ code: 'custom', path: ['selected_candidate_id'], message: 'must reference a candidate in this resolution' });
    }
  } else if (value.selected_candidate_id !== null) {
    context.addIssue({ code: 'custom', path: ['selected_candidate_id'], message: 'must be null unless status is resolved' });
  }
});

const temporalHolderSchema = z.object({
  holder_id: nonEmpty,
  holder_kind: z.enum(['legal_entity', 'natural_person_redacted', 'unknown']),
  legal_entity_id: nullableString.optional(),
  legal_entity_rut: z.string().regex(LEGAL_ENTITY_RUT).nullable().optional(),
  display_name: nonEmpty,
  valid_from: dateTime,
  valid_to: nullableDateTime.optional(),
  source_refs: uniqueStrings(1),
}).strict().superRefine((value, context) => {
  if (value.holder_kind === 'natural_person_redacted') {
    if (!hasOwn(value, 'legal_entity_id') || value.legal_entity_id !== null) {
      context.addIssue({ code: 'custom', path: ['legal_entity_id'], message: 'must be explicitly null for a redacted natural person' });
    }
    if (!hasOwn(value, 'legal_entity_rut') || value.legal_entity_rut !== null) {
      context.addIssue({ code: 'custom', path: ['legal_entity_rut'], message: 'must be explicitly null for a redacted natural person' });
    }
    if (value.display_name !== 'REDACTED') {
      context.addIssue({ code: 'custom', path: ['display_name'], message: 'must be REDACTED for a redacted natural person' });
    }
  }
  if (value.legal_entity_rut && value.holder_kind !== 'legal_entity') {
    context.addIssue({ code: 'custom', path: ['legal_entity_rut'], message: 'only allowed for a legal entity' });
  }
  if (value.valid_to && Date.parse(value.valid_from) > Date.parse(value.valid_to)) {
    context.addIssue({ code: 'custom', path: ['valid_to'], message: 'must not predate valid_from' });
  }
});

const requirementSchema = z.object({
  requirement_id: nonEmpty,
  requirement_type: nonEmpty,
  responsible_organization: nullableString.optional(),
  document_ref: nullableString.optional(),
  issued_at: nullableDateTime.optional(),
  expires_at: nullableDateTime.optional(),
  reported_status: nonEmpty,
  verified_at: nullableDateTime.optional(),
  source_refs: uniqueStrings(1),
}).strict();

const evidenceArtifactSchema = z.object({
  evidence_id: nonEmpty,
  artifact_type: z.enum(['source_record', 'document', 'administrative_act', 'image', 'dataset_extract', 'api_response', 'other']),
  title: nonEmpty,
  uri: uriReference.nullable().optional(),
  media_type: nullableString.optional(),
  captured_at: dateTime,
  integrity: z.object({ sha256: digest, byte_size: z.number().int().nonnegative().optional() }).strict(),
  source_refs: uniqueStrings(1),
  supports: uniqueStrings().optional(),
  classification: z.array(markingSchema).min(1).refine((values) => new Set(values).size === values.length),
}).strict();

const sourceRefSchema = z.object({
  source_ref: nonEmpty,
  producer: nonEmpty,
  product: nullableString.optional(),
  release_id: nullableString.optional(),
  source_kind: z.enum([
    'active_transparency', 'access_response', 'municipal_export', 'administrative_act',
    'official_registry', 'legal_authority', 'capability_response', 'other',
  ]),
  municipality_cut: cutCode.nullable().optional(),
  source_record_id: nullableString.optional(),
  uri: uriReference.nullable().optional(),
  sha256: digest.nullable().optional(),
  observed_at: dateTime,
  effective_at: nullableDateTime.optional(),
}).strict();

const dataGapSchema = z.object({
  gap_id: nonEmpty,
  code: z.enum([
    'missing_field', 'incomplete_timeline', 'stale_release', 'unavailable_capability',
    'restricted_field', 'unresolved_match', 'coverage_gap', 'other',
  ]),
  description: nonEmpty,
  affected_objects: uniqueStrings(),
  consequence: nonEmpty,
  status: z.enum(['open', 'mitigated', 'resolved', 'accepted']),
  detected_at: dateTime,
  source_refs: uniqueStrings(1).optional(),
}).strict();

const evidenceConflictSchema = z.object({
  conflict_id: nonEmpty,
  description: nonEmpty,
  assertions: z.array(z.object({
    object_ref: nullableString.optional(),
    field: nullableString.optional(),
    value: z.json(),
    effective_at: nullableDateTime.optional(),
    source_refs: uniqueStrings(1),
  }).strict()).min(2),
  status: z.enum(['open', 'resolved', 'accepted_unresolved']),
  resolution: nullableString.optional(),
  resolved_at: nullableDateTime.optional(),
  detected_at: dateTime,
}).strict();

const alternativeExplanationSchema = z.object({
  explanation_id: nonEmpty,
  description: nonEmpty,
  status: z.enum(['proposed', 'under_review', 'supported', 'rejected', 'inconclusive']),
  recorded_at: dateTime,
  recorded_by_actor_id: nullableString.optional(),
  evidence_refs: uniqueStrings(),
  source_refs: uniqueStrings(1),
  reviewer_note: nullableString.optional(),
}).strict();

const legalAuthoritySchema = z.object({
  authority_id: nonEmpty,
  authority_type: z.enum(['law', 'regulation', 'ordinance', 'administrative_ruling', 'court_decision', 'official_guidance', 'other']),
  citation: nonEmpty,
  title: nullableString.optional(),
  issuing_authority: nullableString.optional(),
  proposition: nonEmpty,
  relevance: nonEmpty,
  effective_from: date.nullable().optional(),
  effective_to: date.nullable().optional(),
  retrieved_at: dateTime,
  source_refs: uniqueStrings(1),
}).strict().superRefine((value, context) => {
  if (value.effective_from && value.effective_to && value.effective_from > value.effective_to) {
    context.addIssue({ code: 'custom', path: ['effective_to'], message: 'must not predate effective_from' });
  }
});

const permittedNextActionSchema = z.object({
  action_id: nonEmpty,
  action_type: z.enum([
    'OpenLicenseReview', 'AssignReviewer', 'NoObservations', 'RequestMissingRequirement', 'ResolveEstablishment',
    'RecordAlternativeExplanation', 'RecommendInspection', 'RecordInspectionOutcome',
    'RecommendReferral', 'RecommendAdministrativeMeasure', 'RecordOfficialDecision', 'RequestCorrection', 'CloseReview',
  ]),
  permitted: z.boolean(),
  authorized_roles: z.array(nonEmpty),
  reason: nonEmpty,
  legal_effect: z.enum(['none', 'external_communication_only', 'reflects_external_act']),
  prerequisites: z.array(z.string()).optional(),
  blocking_gap_ids: uniqueStrings().optional(),
  blocking_conflict_ids: uniqueStrings().optional(),
  legal_authority_refs: uniqueStrings().optional(),
  evaluated_at: dateTime,
}).strict();

const reproducibilitySchema = z.object({
  builder: z.literal('chile-monitor'),
  builder_version: nonEmpty,
  input_queries: z.array(z.object({
    producer: nonEmpty,
    capability: nonEmpty,
    release_id: nonEmpty,
    request_sha256: digest,
    response_sha256: digest,
  }).strict()).min(1),
  packet_content_sha256: digest,
}).strict();

const evidencePacketShapeSchema = z.object({
  packet_id: z.string().min(1).max(200),
  schema_version: z.literal('0.1.0'),
  generated_at: dateTime,
  case_id: z.string().min(1).max(200),
  municipality_cut: cutCode,
  classification: z.array(markingSchema).min(1).refine((values) => new Set(values).size === values.length),
  pinned_releases: z.array(pinnedReleaseSchema).min(1),
  license: commercialLicenseSnapshotSchema,
  timeline: z.array(licenseEventSchema),
  establishments: z.array(establishmentSchema),
  parcel_resolutions: z.array(parcelResolutionSchema),
  holders: z.array(temporalHolderSchema),
  requirements: z.array(requirementSchema),
  evidence: z.array(evidenceArtifactSchema),
  source_refs: z.array(sourceRefSchema).min(1),
  gaps: z.array(dataGapSchema),
  conflicts: z.array(evidenceConflictSchema),
  alternative_explanations: z.array(alternativeExplanationSchema),
  legal_authorities: z.array(legalAuthoritySchema),
  permitted_next_actions: z.array(permittedNextActionSchema).min(1),
  recommended_next_action_id: nullableString.optional(),
  reproducibility: reproducibilitySchema,
}).strict();

export type Marking = z.infer<typeof markingSchema>;
export type PinnedRelease = z.infer<typeof pinnedReleaseSchema>;
export type EvidencePacketAddress = z.infer<typeof addressSchema>;
export type CommercialLicenseSnapshot = z.infer<typeof commercialLicenseSnapshotSchema>;
export type EvidencePacketLicenseEvent = z.infer<typeof licenseEventSchema>;
export type EvidencePacketEstablishment = z.infer<typeof establishmentSchema>;
export type ParcelCandidate = z.infer<typeof parcelCandidateSchema>;
export type ParcelResolution = z.infer<typeof parcelResolutionSchema>;
export type TemporalHolder = z.infer<typeof temporalHolderSchema>;
export type EvidencePacketRequirement = z.infer<typeof requirementSchema>;
export type EvidenceArtifact = z.infer<typeof evidenceArtifactSchema>;
export type EvidencePacketSourceRef = z.infer<typeof sourceRefSchema>;
export type DataGap = z.infer<typeof dataGapSchema>;
export type EvidenceConflict = z.infer<typeof evidenceConflictSchema>;
export type AlternativeExplanation = z.infer<typeof alternativeExplanationSchema>;
export type LegalAuthority = z.infer<typeof legalAuthoritySchema>;
export type PermittedNextAction = z.infer<typeof permittedNextActionSchema>;
export type Reproducibility = z.infer<typeof reproducibilitySchema>;
export type EvidencePacket = z.infer<typeof evidencePacketShapeSchema>;

export class EvidencePacketContractError extends Error {
  readonly path: string;
  readonly code: string;

  constructor(path: string, code: string) {
    super(`${path}: EvidencePacket validation failed (${code})`);
    this.name = 'EvidencePacketContractError';
    this.path = path;
    this.code = code;
  }
}

function contractFail(path: string, code: string): never {
  throw new EvidencePacketContractError(path, code);
}

function issuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, part) => (
    typeof part === 'number' ? `${result}[${part}]` : `${result}.${String(part)}`
  ), '$');
}

function assertUnique<T>(items: T[], id: (item: T) => string, path: string): Set<string> {
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const itemId = id(items[index]!);
    if (ids.has(itemId)) contractFail(`${path}[${index}]`, 'duplicate_identifier');
    ids.add(itemId);
  }
  return ids;
}

function assertReferences(refs: string[] | undefined, ids: Set<string>, path: string, code: string): void {
  refs?.forEach((ref, index) => {
    if (!ids.has(ref)) contractFail(`${path}[${index}]`, code);
  });
}

function assertSourceReferences(packet: EvidencePacket, sourceIds: Set<string>): void {
  assertReferences(packet.license.source_refs, sourceIds, '$.license.source_refs', 'unknown_source_ref');
  packet.timeline.forEach((item, index) => {
    assertReferences(item.source_refs, sourceIds, `$.timeline[${index}].source_refs`, 'unknown_source_ref');
  });
  packet.establishments.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.establishments[${index}].source_refs`, 'unknown_source_ref'));
  packet.parcel_resolutions.forEach((resolution, resolutionIndex) => resolution.candidates.forEach((candidate, candidateIndex) => (
    assertReferences(candidate.source_refs, sourceIds, `$.parcel_resolutions[${resolutionIndex}].candidates[${candidateIndex}].source_refs`, 'unknown_source_ref')
  )));
  packet.holders.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.holders[${index}].source_refs`, 'unknown_source_ref'));
  packet.requirements.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.requirements[${index}].source_refs`, 'unknown_source_ref'));
  packet.evidence.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.evidence[${index}].source_refs`, 'unknown_source_ref'));
  packet.gaps.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.gaps[${index}].source_refs`, 'unknown_source_ref'));
  packet.conflicts.forEach((conflict, conflictIndex) => conflict.assertions.forEach((assertion, assertionIndex) => (
    assertReferences(assertion.source_refs, sourceIds, `$.conflicts[${conflictIndex}].assertions[${assertionIndex}].source_refs`, 'unknown_source_ref')
  )));
  packet.alternative_explanations.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.alternative_explanations[${index}].source_refs`, 'unknown_source_ref'));
  packet.legal_authorities.forEach((item, index) => assertReferences(item.source_refs, sourceIds, `$.legal_authorities[${index}].source_refs`, 'unknown_source_ref'));
}

function assertPacketReferences(packet: EvidencePacket): void {
  assertUnique(
    packet.pinned_releases,
    (item) => `${item.producer}\0${item.product}\0${item.capability}\0${item.release_id}`,
    '$.pinned_releases',
  );
  const sourceIds = assertUnique(packet.source_refs, (item) => item.source_ref, '$.source_refs');
  const establishmentIds = assertUnique(packet.establishments, (item) => item.establishment_id, '$.establishments');
  const eventIds = assertUnique(packet.timeline, (item) => item.event_id, '$.timeline');
  const holderIds = assertUnique(packet.holders, (item) => item.holder_id, '$.holders');
  const requirementIds = assertUnique(packet.requirements, (item) => item.requirement_id, '$.requirements');
  const evidenceIds = assertUnique(packet.evidence, (item) => item.evidence_id, '$.evidence');
  const gapIds = assertUnique(packet.gaps, (item) => item.gap_id, '$.gaps');
  const conflictIds = assertUnique(packet.conflicts, (item) => item.conflict_id, '$.conflicts');
  const explanationIds = assertUnique(packet.alternative_explanations, (item) => item.explanation_id, '$.alternative_explanations');
  const authorityIds = assertUnique(packet.legal_authorities, (item) => item.authority_id, '$.legal_authorities');
  assertUnique(packet.permitted_next_actions, (item) => item.action_id, '$.permitted_next_actions');
  assertUnique(packet.parcel_resolutions, (item) => item.resolution_id, '$.parcel_resolutions');

  assertSourceReferences(packet, sourceIds);

  const objectIds = new Set([
    packet.license.license_id, ...establishmentIds, ...eventIds, ...holderIds, ...requirementIds,
    ...gapIds, ...conflictIds, ...explanationIds, ...authorityIds,
  ]);
  packet.parcel_resolutions.forEach((resolution, index) => {
    if (!establishmentIds.has(resolution.establishment_id)) {
      contractFail(`$.parcel_resolutions[${index}].establishment_id`, 'unknown_establishment_ref');
    }
    assertUnique(resolution.candidates, (item) => item.candidate_id, `$.parcel_resolutions[${index}].candidates`);
  });
  packet.evidence.forEach((item, index) => assertReferences(item.supports, objectIds, `$.evidence[${index}].supports`, 'unknown_supported_object_ref'));
  packet.gaps.forEach((item, index) => assertReferences(item.affected_objects, objectIds, `$.gaps[${index}].affected_objects`, 'unknown_affected_object_ref'));
  packet.conflicts.forEach((item, conflictIndex) => item.assertions.forEach((assertion, assertionIndex) => {
    if (assertion.object_ref !== undefined && assertion.object_ref !== null && !objectIds.has(assertion.object_ref)) {
      contractFail(`$.conflicts[${conflictIndex}].assertions[${assertionIndex}].object_ref`, 'unknown_object_ref');
    }
  }));
  packet.alternative_explanations.forEach((item, index) => assertReferences(item.evidence_refs, evidenceIds, `$.alternative_explanations[${index}].evidence_refs`, 'unknown_evidence_ref'));
  packet.permitted_next_actions.forEach((action, index) => {
    assertReferences(action.blocking_gap_ids, gapIds, `$.permitted_next_actions[${index}].blocking_gap_ids`, 'unknown_gap_ref');
    assertReferences(action.blocking_conflict_ids, conflictIds, `$.permitted_next_actions[${index}].blocking_conflict_ids`, 'unknown_conflict_ref');
    assertReferences(action.legal_authority_refs, authorityIds, `$.permitted_next_actions[${index}].legal_authority_refs`, 'unknown_legal_authority_ref');
  });
  packet.pinned_releases.forEach((release, index) => assertReferences(release.limitation_ids, gapIds, `$.pinned_releases[${index}].limitation_ids`, 'unknown_gap_ref'));

  const releaseKeys = new Set(packet.pinned_releases.map((release) => `${release.producer}\0${release.capability}\0${release.release_id}`));
  packet.reproducibility.input_queries.forEach((query, index) => {
    const releaseKey = `${query.producer}\0${query.capability}\0${query.release_id}`;
    if (!releaseKeys.has(releaseKey)) {
      contractFail(`$.reproducibility.input_queries[${index}].release_id`, 'unknown_pinned_release_ref');
    }
    const release = packet.pinned_releases.find((candidate) =>
      `${candidate.producer}\0${candidate.capability}\0${candidate.release_id}` === releaseKey
    );
    if (release?.response_sha256 && release.response_sha256 !== query.response_sha256) {
      contractFail(`$.reproducibility.input_queries[${index}].response_sha256`, 'release_response_hash_mismatch');
    }
  });
  packet.source_refs.forEach((source, index) => {
    if (source.release_id !== undefined && source.release_id !== null
      && !packet.pinned_releases.some((release) => release.producer === source.producer && release.release_id === source.release_id)) {
      contractFail(`$.source_refs[${index}].release_id`, 'unknown_pinned_release_ref');
    }
  });

  if (!packet.permitted_next_actions.some((action) => action.permitted)) {
    contractFail('$.permitted_next_actions', 'requires_permitted_action');
  }
  if (packet.recommended_next_action_id !== undefined && packet.recommended_next_action_id !== null) {
    const recommended = packet.permitted_next_actions.find((action) => action.action_id === packet.recommended_next_action_id);
    if (!recommended) contractFail('$.recommended_next_action_id', 'unknown_action_ref');
    if (!recommended.permitted) contractFail('$.recommended_next_action_id', 'action_not_permitted');
  }
}

function assertPacketConsistency(packet: EvidencePacket): void {
  if (packet.license.municipality_cut !== packet.municipality_cut
    || packet.license.address.municipality_cut !== packet.municipality_cut) {
    contractFail('$.license.municipality_cut', 'municipality_cut_mismatch');
  }
  packet.establishments.forEach((establishment, index) => {
    if (establishment.address.municipality_cut !== packet.municipality_cut) {
      contractFail(`$.establishments[${index}].address.municipality_cut`, 'municipality_cut_mismatch');
    }
  });
}

export function parseEvidencePacket(value: unknown): EvidencePacket {
  const parsed = evidencePacketShapeSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) throw new EvidencePacketContractError('$', 'invalid_packet');
    throw new EvidencePacketContractError(issuePath(issue.path), issue.code);
  }
  assertPacketReferences(parsed.data);
  assertPacketConsistency(parsed.data);
  return parsed.data;
}
