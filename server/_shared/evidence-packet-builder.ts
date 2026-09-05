import type {
  CommercialLicensesClient,
  CommercialLicensesRepresentation,
} from './commercial-licenses-client';
import { CommercialLicensesClientError } from './commercial-licenses-client';
import type {
  EstablishmentResolveRequest,
  EstablishmentResolveResponse,
  LicenseEvent,
  Limitation,
  PatentGetResponse,
  PatentTimelineResponse,
  ReleaseMetadata,
  SourceRef as CommercialLicenseSourceRef,
} from './commercial-licenses-contract';
import {
  canonicalizeJson,
  hashEvidencePacketContent,
  sha256CanonicalJson,
} from './evidence-packet-canonical';
import {
  EvidencePacketContractError,
  parseEvidencePacket,
  type EvidencePacket,
} from './evidence-packet-contract';

const CAPABILITY_VERSION = '0.1';
const PACKET_SCHEMA_VERSION = '0.1.0';

type Marking =
  | 'PUBLIC'
  | 'PII'
  | 'LICENSED'
  | 'MUNICIPAL_INTERNAL'
  | 'ACTIVE_REVIEW'
  | 'AUTHORITY_ONLY';

type JsonObject = Record<string, unknown>;

export type EvidencePacketBuilderErrorKind =
  | 'invalid_input'
  | 'release_mismatch'
  | 'source_conflict'
  | 'invalid_reference'
  | 'invalid_packet';

/** Safe error: details intentionally exclude source values and query payloads. */
export class EvidencePacketBuilderError extends Error {
  readonly kind: EvidencePacketBuilderErrorKind;

  constructor(kind: EvidencePacketBuilderErrorKind, message: string) {
    super(message);
    this.name = 'EvidencePacketBuilderError';
    this.kind = kind;
  }
}

export interface EvidencePacketQueryRecord {
  producer: string;
  capability: string;
  releaseId: string;
  request: unknown;
  response: unknown;
}

export interface EvidencePacketSupplement {
  sourceRefs?: JsonObject[];
  pinnedReleases?: JsonObject[];
  queryRecords?: EvidencePacketQueryRecord[];
  evidence?: JsonObject[];
  gaps?: JsonObject[];
  conflicts?: JsonObject[];
  alternativeExplanations?: JsonObject[];
  legalAuthorities?: JsonObject[];
}

export interface BuildEvidencePacketInput extends EvidencePacketSupplement {
  packetId?: string;
  caseId: string;
  municipalityCut: string;
  classification: Marking[];
  builderVersion: string;
  generatedAt: string;
  requestedReleaseId: string;
  effectiveOn?: string;
  patent: PatentGetResponse;
  timeline?: PatentTimelineResponse;
  timelineUnavailable?: boolean;
  establishmentResolution?: EstablishmentResolveResponse;
  establishmentResolutionUnavailable?: boolean;
  permittedNextActions: JsonObject[];
  recommendedNextActionId?: string | null;
}

export interface OrchestratedEvidencePacketInput extends EvidencePacketSupplement {
  packetId?: string;
  caseId: string;
  municipalityCut: string;
  classification: Marking[];
  licenseId: string;
  releaseId: string;
  effectiveOn?: string;
  representation?: CommercialLicensesRepresentation;
  establishmentRequest?: EstablishmentResolveRequest;
  permittedNextActions: JsonObject[];
  recommendedNextActionId?: string | null;
}

export interface EvidencePacketBuilderConfig {
  client: CommercialLicensesClient;
  builderVersion: string;
  now?: () => Date;
}

export interface EvidencePacketBuilder {
  build(input: OrchestratedEvidencePacketInput): Promise<EvidencePacket>;
}

export function createEvidencePacketBuilder(
  config: EvidencePacketBuilderConfig,
): EvidencePacketBuilder {
  const now = config.now ?? (() => new Date());

  return {
    async build(input) {
      const generatedAt = now().toISOString();
      const patentRequest = compactDefined({
        municipalityCut: input.municipalityCut,
        sourceLicenseId: input.licenseId,
        releaseId: input.releaseId,
        effectiveOn: input.effectiveOn,
        representation: input.representation,
      });
      const patent = await config.client.getPatent(patentRequest);
      const queryRecords: EvidencePacketQueryRecord[] = [
        queryRecord('patents.get', patentRequest, patent),
      ];

      let timeline: PatentTimelineResponse | undefined;
      let timelineUnavailable = false;
      const timelineRequest = compactDefined({
        municipalityCut: input.municipalityCut,
        sourceLicenseId: input.licenseId,
        releaseId: input.releaseId,
        representation: input.representation,
      });
      try {
        timeline = await config.client.getPatentTimeline(timelineRequest);
        queryRecords.push(queryRecord('patents.timeline', timelineRequest, timeline));
      } catch (error) {
        if (!isAvailabilityFailure(error)) throw error;
        timelineUnavailable = true;
      }

      let establishmentResolution: EstablishmentResolveResponse | undefined;
      let establishmentResolutionUnavailable = false;
      if (input.establishmentRequest !== undefined) {
        const options = {
          releaseId: input.releaseId,
          representation: input.representation,
        };
        try {
          establishmentResolution = await config.client.resolveEstablishment(
            input.establishmentRequest,
            options,
          );
          queryRecords.push(
            queryRecord(
              'establishments.resolve',
              { request: input.establishmentRequest, options },
              establishmentResolution,
            ),
          );
        } catch (error) {
          if (!isAvailabilityFailure(error)) throw error;
          establishmentResolutionUnavailable = true;
        }
      }

      return buildEvidencePacket({
        ...input,
        builderVersion: config.builderVersion,
        generatedAt,
        requestedReleaseId: input.releaseId,
        patent,
        timeline,
        timelineUnavailable,
        establishmentResolution,
        establishmentResolutionUnavailable,
        queryRecords: [...queryRecords, ...(input.queryRecords ?? [])],
      });
    },
  };
}

/** Pure composition boundary, apart from deterministic canonical hashing. */
export async function buildEvidencePacket(
  input: BuildEvidencePacketInput,
): Promise<EvidencePacket> {
  requireNonEmpty(input.caseId, 'case identifier');
  requireNonEmpty(input.builderVersion, 'builder version');
  requireNonEmpty(input.requestedReleaseId, 'release identifier');
  if (input.patent.license.municipality_cut !== input.municipalityCut) {
    throw new EvidencePacketBuilderError('invalid_input', 'Municipality does not match the patent');
  }

  assertRelease(input.patent.metadata, input.requestedReleaseId);
  if (input.timeline !== undefined) {
    assertRelease(input.timeline.metadata, input.requestedReleaseId);
    if (input.timeline.metadata.release_id !== input.patent.metadata.release_id) {
      throw new EvidencePacketBuilderError(
        'release_mismatch',
        'Patent snapshot and timeline use different releases',
      );
    }
    if (input.timeline.license_id !== input.patent.license.license_id) {
      throw new EvidencePacketBuilderError('invalid_input', 'Timeline does not match the patent');
    }
  }
  if (input.establishmentResolution !== undefined) {
    assertRelease(input.establishmentResolution.metadata, input.requestedReleaseId);
  }

  const generatedAt = parseDateTime(input.generatedAt, 'generation timestamp');
  if (input.effectiveOn !== undefined) parseEffectiveDate(input.effectiveOn);
  const upstreamResponses = [
    responseSource(input.patent.metadata, input.patent.source_refs),
    ...(input.timeline === undefined
      ? []
      : [responseSource(input.timeline.metadata, input.timeline.source_refs)]),
    ...(input.establishmentResolution === undefined
      ? []
      : [
          responseSource(
            input.establishmentResolution.metadata,
            input.establishmentResolution.source_refs,
          ),
        ]),
  ];
  const sourceRefs = deduplicateSources([
    ...upstreamResponses.flatMap((entry) => entry.sources),
    ...(input.sourceRefs ?? []),
  ]);

  const effectiveOn = input.effectiveOn;
  const holders = await Promise.all(input.patent.license.holders
    .filter((holder) => intervalContains(holder.valid_from, holder.valid_to, effectiveOn))
    .map(async (holder) => ({
      holder_id: await derivedId('holder', {
        license: input.patent.license.license_id,
        kind: holder.holder_kind,
        entity: holder.legal_entity_id ?? null,
        from: holder.valid_from,
        to: holder.valid_to ?? null,
      }),
      holder_kind: holder.holder_kind,
      legal_entity_id: holder.legal_entity_id ?? null,
      legal_entity_rut: holder.legal_entity_rut ?? null,
      display_name: holder.display_name,
      valid_from: holder.valid_from,
      valid_to: holder.valid_to ?? null,
      source_refs: stableUnique(holder.source_refs),
    })));
  const establishments = input.patent.establishments
    .filter((item) => intervalContains(item.valid_from, item.valid_to, effectiveOn))
    .map((item) => ({
      establishment_id: item.establishment_id,
      name: item.name ?? null,
      address: compactAddress(item.address),
      valid_from: item.valid_from ?? null,
      valid_to: item.valid_to ?? null,
      source_refs: stableUnique(item.source_refs),
    }));

  const gaps = [...(input.gaps ?? [])];
  const patentLimitationIds: string[] = [];
  const timelineLimitationIds: string[] = [];
  const establishmentLimitationIds: string[] = [];
  for (const limitation of input.patent.limitations) {
    const gap = await limitationToGap(
      limitation,
      generatedAt,
      input.patent.license.license_id,
    );
    gaps.push(gap);
    patentLimitationIds.push(String(gap.gap_id));
  }
  if (input.timelineUnavailable || input.timeline === undefined) {
    gaps.push(
      await makeGap(
        'unavailable_capability',
        'The patent timeline capability was unavailable.',
        [input.patent.license.license_id],
        'Timeline completeness cannot be established.',
        generatedAt,
        input.patent.license.source_refs,
      ),
    );
  } else {
    for (const limitation of input.timeline.limitations) {
      const gap = await limitationToGap(
        limitation,
        generatedAt,
        input.patent.license.license_id,
      );
      gaps.push(gap);
      timelineLimitationIds.push(String(gap.gap_id));
    }
  }
  if (
    input.patent.metadata.availability === 'stale_last_good' &&
    !input.patent.limitations.some((limitation) => limitation.code === 'stale_release')
  ) {
    const staleGap = await makeGap(
        'stale_release',
        'The last known good commercial-licenses release was used.',
        [input.patent.license.license_id],
        'Recent changes may not be represented.',
        generatedAt,
        input.patent.license.source_refs,
    );
    gaps.push(staleGap);
    patentLimitationIds.push(String(staleGap.gap_id));
  }
  if (input.establishmentResolution !== undefined) {
    for (const limitation of input.establishmentResolution.limitations) {
      const gap = await limitationToGap(
        limitation,
        generatedAt,
        input.patent.license.license_id,
      );
      gaps.push(gap);
      establishmentLimitationIds.push(String(gap.gap_id));
    }
  }
  if (input.establishmentResolutionUnavailable) {
    gaps.push(
      await makeGap(
        'unavailable_capability',
        'The establishment resolution capability was unavailable.',
        establishments.map((item) => String(item.establishment_id)),
        'Establishment and parcel resolution cannot be established.',
        generatedAt,
        input.patent.license.source_refs,
      ),
    );
  }

  const parcelResolutions = await buildParcelResolutions(
    input,
    establishments,
    generatedAt,
    gaps,
  );
  const timeline = filterTimeline(
    input.timeline?.events ?? input.patent.timeline,
    effectiveOn,
  );
  const conflicts = [
    ...(input.conflicts ?? []),
    ...(input.timeline === undefined
      ? []
      : await detectTimelineConflicts(
          input.patent.timeline,
          input.timeline.events,
          generatedAt,
          effectiveOn,
        )),
  ];
  const uniqueGaps = deduplicateObjects(gaps, 'gap_id');

  const pinnedReleases = await Promise.all([
    makePinnedRelease(
      input.patent.metadata,
      'patents.get',
      generatedAt,
      input.patent,
      patentLimitationIds,
    ),
    ...(input.timeline === undefined
      ? []
      : [makePinnedRelease(
          input.timeline.metadata,
          'patents.timeline',
          generatedAt,
          input.timeline,
          timelineLimitationIds,
        )]),
    ...(input.establishmentResolution === undefined
      ? []
      : [
          makePinnedRelease(
            input.establishmentResolution.metadata,
            'establishments.resolve',
            generatedAt,
            input.establishmentResolution,
            establishmentLimitationIds,
          ),
        ]),
  ]);
  pinnedReleases.push(...(input.pinnedReleases ?? []));

  const queryRecords = input.queryRecords ?? [
    queryRecord(
      'patents.get',
      compactDefined({
        municipalityCut: input.municipalityCut,
        sourceLicenseId: input.patent.license.source_license_id,
        releaseId: input.requestedReleaseId,
        effectiveOn,
      }),
      input.patent,
    ),
    ...(input.timeline === undefined
      ? []
      : [
          queryRecord(
            'patents.timeline',
            {
              municipalityCut: input.municipalityCut,
              sourceLicenseId: input.patent.license.source_license_id,
              releaseId: input.requestedReleaseId,
            },
            input.timeline,
          ),
        ]),
  ];
  const inputQueries = await Promise.all(
    queryRecords.map(async (record) => ({
      producer: record.producer,
      capability: record.capability,
      release_id: record.releaseId,
      request_sha256: await sha256CanonicalJson(orderInsensitiveJson(record.request)),
      response_sha256: await sha256CanonicalJson(orderInsensitiveJson(record.response)),
    })),
  );
  assertEveryPinnedReleaseHasQuery(pinnedReleases, inputQueries);

  validateActions(
    input.permittedNextActions,
    input.recommendedNextActionId ?? null,
    uniqueGaps,
    conflicts,
  );

  const packetId = input.packetId ??
    `ep-${(await sha256CanonicalJson({
      case_id: input.caseId,
      license_id: input.patent.license.license_id,
      release_id: input.requestedReleaseId,
      effective_on: effectiveOn ?? null,
    })).slice(0, 24)}`;
  const activities = stableUnique(
    input.patent.license.activities
      .filter((activity) => intervalContains(activity.valid_from, activity.valid_to, effectiveOn))
      .map((activity) => activity.activity),
  );

  const draft = {
    packet_id: packetId,
    schema_version: PACKET_SCHEMA_VERSION,
    generated_at: generatedAt,
    case_id: input.caseId,
    municipality_cut: input.municipalityCut,
    classification: stableUnique(input.classification),
    pinned_releases: stableSort(pinnedReleases, 'capability'),
    license: {
      license_id: input.patent.license.license_id,
      source_license_id: input.patent.license.source_license_id,
      license_number: input.patent.license.license_number ?? null,
      municipality_cut: input.patent.license.municipality_cut,
      license_type: input.patent.license.license_type,
      reported_status: input.patent.license.reported_status,
      provisional_status: input.patent.license.provisional_status,
      applied_at: input.patent.license.applied_at ?? null,
      granted_at: input.patent.license.granted_at ?? null,
      renewed_at: input.patent.license.renewed_at ?? null,
      expires_at: input.patent.license.expires_at ?? null,
      address: compactAddress(input.patent.license.address),
      activities,
      observed_at: latestSourceObservation(input.patent.source_refs, input.patent.metadata.data_as_of),
      source_refs: stableUnique(input.patent.license.source_refs),
    },
    timeline: stableSort(timeline, 'event_id'),
    establishments: stableSort(establishments, 'establishment_id'),
    parcel_resolutions: stableSort(parcelResolutions, 'resolution_id'),
    holders: stableSort(holders, 'holder_id'),
    requirements: stableSort(
      input.patent.requirements.map((item) => ({
        ...item,
        responsible_organization: item.responsible_organization ?? null,
        document_ref: item.document_ref ?? null,
        issued_at: item.issued_at ?? null,
        expires_at: item.expires_at ?? null,
        verified_at: item.verified_at ?? null,
        source_refs: stableUnique(item.source_refs),
      })),
      'requirement_id',
    ),
    evidence: stableSort(input.evidence ?? [], 'evidence_id'),
    source_refs: stableSort(sourceRefs, 'source_ref'),
    gaps: stableSort(uniqueGaps, 'gap_id'),
    conflicts: stableSort(conflicts, 'conflict_id'),
    alternative_explanations: stableSort(
      input.alternativeExplanations ?? [],
      'explanation_id',
    ),
    legal_authorities: stableSort(input.legalAuthorities ?? [], 'authority_id'),
    permitted_next_actions: stableSort(input.permittedNextActions, 'action_id'),
    recommended_next_action_id: input.recommendedNextActionId ?? null,
    reproducibility: {
      builder: 'chile-monitor',
      builder_version: input.builderVersion,
      input_queries: stableSort(inputQueries, 'capability'),
      packet_content_sha256: '0'.repeat(64),
    },
  };

  assertReferences(draft);
  draft.reproducibility.packet_content_sha256 = await hashEvidencePacketContent(draft);
  try {
    return parseEvidencePacket(draft);
  } catch (error) {
    if (error instanceof EvidencePacketContractError) {
      throw new EvidencePacketBuilderError(
        'invalid_packet',
        `EvidencePacket validation failed (${error.code} at ${error.path})`,
      );
    }
    throw new EvidencePacketBuilderError('invalid_packet', 'EvidencePacket validation failed');
  }
}

function queryRecord(capability: string, request: unknown, response: { metadata: ReleaseMetadata }): EvidencePacketQueryRecord {
  return {
    producer: response.metadata.producer,
    capability,
    releaseId: response.metadata.release_id,
    request,
    response,
  };
}

function assertRelease(metadata: ReleaseMetadata, requestedReleaseId: string): void {
  if (metadata.release_id !== requestedReleaseId) {
    throw new EvidencePacketBuilderError('release_mismatch', 'A response did not use the pinned release');
  }
}

async function makePinnedRelease(
  metadata: ReleaseMetadata,
  capability: string,
  queriedAt: string,
  response: unknown,
  limitationIds: string[],
): Promise<JsonObject> {
  return {
    ...metadata,
    capability,
    capability_version: CAPABILITY_VERSION,
    queried_at: queriedAt,
    response_sha256: await sha256CanonicalJson(orderInsensitiveJson(response)),
    limitation_ids: stableUnique(limitationIds),
  };
}

function responseSource(metadata: ReleaseMetadata, refs: CommercialLicenseSourceRef[]) {
  return {
    sources: refs.map((ref) => ({
      source_ref: ref.source_ref,
      producer: metadata.producer,
      product: metadata.product,
      release_id: metadata.release_id,
      source_kind: ref.source_kind,
      municipality_cut: ref.municipality_cut ?? null,
      source_record_id: ref.source_record_id ?? null,
      uri: ref.uri ?? null,
      sha256: ref.sha256 ?? null,
      observed_at: ref.observed_at,
      effective_at: ref.effective_at ?? null,
    })),
  };
}

function deduplicateSources(sources: JsonObject[]): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  for (const source of sources) {
    const id = typeof source.source_ref === 'string' ? source.source_ref : '';
    if (id === '') {
      throw new EvidencePacketBuilderError('invalid_reference', 'A source has no identifier');
    }
    const prior = byId.get(id);
    if (prior !== undefined && canonicalizeJson(prior) !== canonicalizeJson(source)) {
      throw new EvidencePacketBuilderError(
        'source_conflict',
        'A source identifier has incompatible definitions',
      );
    }
    byId.set(id, source);
  }
  return [...byId.values()];
}

function deduplicateObjects(values: JsonObject[], idKey: string): JsonObject[] {
  const byId = new Map<string, JsonObject>();
  for (const value of values) {
    const id = typeof value[idKey] === 'string' ? value[idKey] : '';
    if (id === '') {
      throw new EvidencePacketBuilderError('invalid_reference', 'An object has no identifier');
    }
    const prior = byId.get(id);
    if (prior !== undefined && canonicalizeJson(prior) !== canonicalizeJson(value)) {
      throw new EvidencePacketBuilderError(
        'source_conflict',
        'An identifier has incompatible definitions',
      );
    }
    byId.set(id, value);
  }
  return [...byId.values()];
}

async function buildParcelResolutions(
  input: BuildEvidencePacketInput,
  establishments: JsonObject[],
  generatedAt: string,
  gaps: JsonObject[],
): Promise<JsonObject[]> {
  const response = input.establishmentResolution;
  if (response === undefined) {
    if (input.patent.parcel_matches.length > 0 && establishments.length === 1) {
      const status = inferResolutionStatus(input.patent.parcel_matches);
      if (status !== 'resolved') {
        gaps.push(
          await makeGap(
            'unresolved_match',
            'The establishment-to-parcel resolution is not conclusive.',
            establishments.map((item) => String(item.establishment_id)),
            'Parcel-dependent conclusions and actions remain blocked.',
            generatedAt,
            input.patent.parcel_matches.flatMap((match) => match.source_refs),
          ),
        );
      }
      return [
        await parcelResolution(
          String(establishments[0]?.establishment_id),
          status,
          input.patent.parcel_matches,
          generatedAt,
        ),
      ];
    }
    if (establishments.length > 0) {
      gaps.push(
        await makeGap(
          'unresolved_match',
          'No unambiguous establishment-to-parcel resolution is available.',
          establishments.map((item) => String(item.establishment_id)),
          'Parcel-dependent conclusions and actions remain blocked.',
          generatedAt,
          input.patent.license.source_refs,
        ),
      );
    }
    return [];
  }

  const selected = response.selected_candidate_id;
  const grouped = new Map<string, typeof response.candidates>();
  for (const candidate of response.candidates) {
    const id = candidate.establishment.establishment_id;
    grouped.set(id, [...(grouped.get(id) ?? []), candidate]);
  }
  const resolutions: JsonObject[] = [];
  for (const [establishmentId, candidates] of grouped) {
    const selectedForEstablishment = candidates.some((item) => item.candidate_id === selected)
      ? selected
      : null;
    const status = selectedForEstablishment === null
      ? response.resolution_status === 'resolved' ? 'ambiguous' : response.resolution_status
      : 'resolved';
    resolutions.push(
      await parcelResolution(
        establishmentId,
        status,
        candidates.map((item) => item.parcel_match),
        generatedAt,
        selectedForEstablishment,
      ),
    );
  }
  if (response.resolution_status !== 'resolved') {
    gaps.push(
      await makeGap(
        'unresolved_match',
        'The establishment-to-parcel resolution is not conclusive.',
        [...grouped.keys()],
        'Parcel-dependent conclusions and actions remain blocked.',
        generatedAt,
        response.source_refs.map((item) => item.source_ref),
      ),
    );
  }
  return resolutions;
}

async function parcelResolution(
  establishmentId: string,
  status: 'resolved' | 'ambiguous' | 'unresolved',
  matches: PatentGetResponse['parcel_matches'],
  resolvedAt: string,
  selectedCandidateId?: string | null,
): Promise<JsonObject> {
  const selected = status === 'resolved'
    ? selectedCandidateId ?? matches.find((item) => item.match_status === 'resolved')?.candidate_id ?? null
    : null;
  if (status === 'resolved' && !matches.some((item) => item.candidate_id === selected)) {
    throw new EvidencePacketBuilderError('invalid_reference', 'Resolved parcel candidate is absent');
  }
  return {
    resolution_id: await derivedId('parcel-resolution', {
      establishmentId,
      matches: matches.map((match) => match.candidate_id).sort(),
    }),
    establishment_id: establishmentId,
    status,
    selected_candidate_id: selected,
    candidates: [...matches]
      .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id))
      .map((match) => ({
        candidate_id: match.candidate_id,
        parcel_id: match.parcel_id ?? null,
        role: match.role ?? null,
        method: match.method,
        confidence: match.confidence,
        parcel_release_id: match.parcel_release_id,
        explanation: match.explanation ?? null,
        source_refs: stableUnique(match.source_refs),
      })),
    resolved_at: resolvedAt,
    justification: null,
  };
}

function inferResolutionStatus(matches: PatentGetResponse['parcel_matches']): 'resolved' | 'ambiguous' | 'unresolved' {
  const resolved = matches.filter((item) => item.match_status === 'resolved');
  if (resolved.length === 1) return 'resolved';
  if (matches.length > 0 && matches.some((item) => item.match_status === 'ambiguous')) return 'ambiguous';
  return 'unresolved';
}

function filterTimeline(events: LicenseEvent[], effectiveOn?: string): JsonObject[] {
  return events
    .filter((event) => eventOccurredBy(event, effectiveOn))
    .map((event) => ({
      event_id: event.event_id,
      event_type: event.event_type,
      effective_at: event.effective_at ?? null,
      observed_at: event.observed_at,
      previous_status: event.previous_status ?? null,
      next_status: event.next_status ?? null,
      administrative_act_ref: event.administrative_act_ref ?? null,
      source_refs: stableUnique(event.source_refs),
    }));
}

async function detectTimelineConflicts(
  snapshotEvents: LicenseEvent[],
  timelineEvents: LicenseEvent[],
  detectedAt: string,
  effectiveOn?: string,
): Promise<JsonObject[]> {
  const snapshotById = new Map(
    snapshotEvents
      .filter((event) => eventOccurredBy(event, effectiveOn))
      .map((event) => [event.event_id, event] as const),
  );
  const conflicts: JsonObject[] = [];
  for (const timelineEvent of timelineEvents.filter((event) => eventOccurredBy(event, effectiveOn))) {
    const snapshotEvent = snapshotById.get(timelineEvent.event_id);
    if (snapshotEvent === undefined) continue;
    const snapshotFact = eventConflictFact(snapshotEvent);
    const timelineFact = eventConflictFact(timelineEvent);
    if (canonicalizeJson(snapshotFact) === canonicalizeJson(timelineFact)) continue;
    const assertions = [
      {
        object_ref: timelineEvent.event_id,
        field: 'timeline_event',
        value: snapshotFact,
        effective_at: snapshotEvent.effective_at ?? null,
        source_refs: stableUnique(snapshotEvent.source_refs),
      },
      {
        object_ref: timelineEvent.event_id,
        field: 'timeline_event',
        value: timelineFact,
        effective_at: timelineEvent.effective_at ?? null,
        source_refs: stableUnique(timelineEvent.source_refs),
      },
    ].sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)));
    conflicts.push({
      conflict_id: await derivedId('conflict', {
        event_id: timelineEvent.event_id,
        assertions,
      }),
      description: 'The patent snapshot and timeline report incompatible event facts.',
      assertions,
      status: 'open',
      resolution: null,
      resolved_at: null,
      detected_at: detectedAt,
    });
  }
  return conflicts;
}

function eventConflictFact(event: LicenseEvent): JsonObject {
  return {
    event_type: event.event_type,
    effective_at: event.effective_at ?? null,
    observed_at: event.observed_at,
    previous_status: event.previous_status ?? null,
    next_status: event.next_status ?? null,
    administrative_act_ref: event.administrative_act_ref ?? null,
  };
}

function eventOccurredBy(event: LicenseEvent, effectiveOn?: string): boolean {
  if (effectiveOn === undefined) return true;
  return (event.effective_at ?? event.observed_at).slice(0, 10) <= effectiveOn.slice(0, 10);
}

function intervalContains(from: string | null | undefined, to: string | null | undefined, effectiveOn?: string): boolean {
  if (effectiveOn === undefined) return to === undefined || to === null;
  const date = effectiveOn.slice(0, 10);
  return (from === undefined || from === null || from.slice(0, 10) <= date) &&
    (to === undefined || to === null || date < to.slice(0, 10));
}

function compactAddress(address: {
  original: string;
  normalized?: string | null;
  unit?: string | null;
  municipality_cut: string;
}): JsonObject {
  return {
    original: address.original,
    normalized: address.normalized ?? null,
    unit: address.unit ?? null,
    municipality_cut: address.municipality_cut,
  };
}

function limitationGapCode(code: Limitation['code']): string {
  switch (code) {
    case 'stale_release': return 'stale_release';
    case 'restricted_field': return 'restricted_field';
    case 'unresolved_match':
    case 'ambiguous_match': return 'unresolved_match';
    case 'incomplete_timeline': return 'incomplete_timeline';
    case 'unavailable_capability': return 'unavailable_capability';
    case 'data_gap': return 'coverage_gap';
    default: return 'other';
  }
}

async function limitationToGap(
  limitation: Limitation,
  detectedAt: string,
  objectId: string,
): Promise<JsonObject> {
  return makeGap(
    limitationGapCode(limitation.code),
    limitation.message,
    [objectId],
    'The affected information cannot support a conclusive administrative finding.',
    detectedAt,
    limitation.source_refs ?? [],
  );
}

async function makeGap(
  code: string,
  description: string,
  affectedObjects: string[],
  consequence: string,
  detectedAt: string,
  sourceRefs: string[],
): Promise<JsonObject> {
  const seed = {
    code,
    description,
    affectedObjects: stableUnique(affectedObjects),
    consequence,
    sourceRefs: stableUnique(sourceRefs),
  };
  return {
    gap_id: `gap-${(await sha256CanonicalJson(seed)).slice(0, 20)}`,
    code,
    description,
    affected_objects: seed.affectedObjects,
    consequence,
    status: 'open',
    detected_at: detectedAt,
    ...(seed.sourceRefs.length === 0 ? {} : { source_refs: seed.sourceRefs }),
  };
}

function validateActions(actions: JsonObject[], recommendedId: string | null, gaps: JsonObject[], conflicts: JsonObject[]): void {
  const actionIds = new Set(actions.map((action) => action.action_id));
  if (!actions.some((action) => action.permitted === true)) {
    throw new EvidencePacketBuilderError('invalid_input', 'At least one action must be permitted');
  }
  if (recommendedId !== null) {
    const action = actions.find((item) => item.action_id === recommendedId);
    if (action === undefined || action.permitted !== true) {
      throw new EvidencePacketBuilderError('invalid_reference', 'Recommended action is not permitted');
    }
  }
  const gapIds = new Set(gaps.map((gap) => gap.gap_id));
  const conflictIds = new Set(conflicts.map((conflict) => conflict.conflict_id));
  for (const action of actions) {
    if (typeof action.action_id !== 'string' || !actionIds.has(action.action_id)) continue;
    for (const id of stringArray(action.blocking_gap_ids)) {
      if (!gapIds.has(id)) throw new EvidencePacketBuilderError('invalid_reference', 'Action references an absent gap');
    }
    for (const id of stringArray(action.blocking_conflict_ids)) {
      if (!conflictIds.has(id)) throw new EvidencePacketBuilderError('invalid_reference', 'Action references an absent conflict');
    }
    if (
      action.permitted === true &&
      (stringArray(action.blocking_gap_ids).length > 0 ||
        stringArray(action.blocking_conflict_ids).length > 0)
    ) {
      throw new EvidencePacketBuilderError(
        'invalid_input',
        'An action with active blockers cannot be permitted',
      );
    }
  }
}

function assertEveryPinnedReleaseHasQuery(
  pinnedReleases: JsonObject[],
  inputQueries: JsonObject[],
): void {
  const queryKeys = new Set(inputQueries.map((query) =>
    `${String(query.producer)}\0${String(query.capability)}\0${String(query.release_id)}`
  ));
  for (const release of pinnedReleases) {
    const key = `${String(release.producer)}\0${String(release.capability)}\0${String(release.release_id)}`;
    if (!queryKeys.has(key)) {
      throw new EvidencePacketBuilderError(
        'invalid_input',
        'Every pinned release requires its explicit query record',
      );
    }
  }
}

function assertReferences(packet: JsonObject): void {
  const sources = new Set(
    (packet.source_refs as JsonObject[]).map((source) => source.source_ref).filter((id): id is string => typeof id === 'string'),
  );
  const visit = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      if (key === 'source_refs') {
        for (const id of value) {
          if (typeof id === 'string' && !sources.has(id)) {
            throw new EvidencePacketBuilderError('invalid_reference', 'An object references an absent source');
          }
        }
        return;
      }
      for (const item of value) visit(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childKey !== 'source_refs' || value !== packet) visit(childValue, childKey);
      }
    }
  };
  for (const [key, value] of Object.entries(packet)) {
    if (key !== 'source_refs') visit(value, key);
  }
}

function latestSourceObservation(refs: CommercialLicenseSourceRef[], fallback: string): string {
  return refs.reduce((latest, ref) => ref.observed_at > latest ? ref.observed_at : latest, fallback);
}

function stableUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function stableSort<T extends JsonObject>(values: T[], key: string): T[] {
  return [...values].sort((left, right) => {
    const byKey = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
    return byKey === 0 ? canonicalizeJson(left).localeCompare(canonicalizeJson(right)) : byKey;
  });
}

async function derivedId(prefix: string, value: unknown): Promise<string> {
  return `${prefix}-${(await sha256CanonicalJson(value)).slice(0, 20)}`;
}

function parseDateTime(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new EvidencePacketBuilderError('invalid_input', `${label} is invalid`);
  }
  return value;
}

function parseEffectiveDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new EvidencePacketBuilderError('invalid_input', 'Effective date is invalid');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new EvidencePacketBuilderError('invalid_input', 'Effective date is invalid');
  }
  return value;
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim() === '') {
    throw new EvidencePacketBuilderError('invalid_input', `${label} is required`);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function compactDefined<T extends JsonObject>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

/**
 * Normalizes unordered response collections before their agreed canonical
 * hash. String sets and arrays of records are order-insensitive; numeric and
 * nested arrays remain ordered so geometry coordinates cannot be rewritten.
 */
function orderInsensitiveJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(orderInsensitiveJson);
    const isUnorderedCollection = normalized.every((item) =>
      typeof item === 'string' || (item !== null && typeof item === 'object' && !Array.isArray(item))
    );
    return isUnorderedCollection
      ? normalized.sort((left, right) => canonicalizeJson(left).localeCompare(canonicalizeJson(right)))
      : normalized;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, orderInsensitiveJson(item)]),
    );
  }
  return value;
}

function isAvailabilityFailure(error: unknown): boolean {
  if (!(error instanceof CommercialLicensesClientError)) return false;
  if (error.kind === 'timeout' || error.kind === 'network') return true;
  return error.kind === 'http' &&
    (error.retryable === true || error.status === 429 || (error.status !== undefined && error.status >= 500));
}
