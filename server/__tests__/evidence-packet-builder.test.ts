// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';

import {
  CommercialLicensesClientError,
  type CommercialLicensesClient,
} from '../_shared/commercial-licenses-client';
import type {
  PatentGetResponse,
  PatentTimelineResponse,
  ReleaseMetadata,
} from '../_shared/commercial-licenses-contract';
import {
  buildEvidencePacket,
  createEvidencePacketBuilder,
  EvidencePacketBuilderError,
  type BuildEvidencePacketInput,
} from '../_shared/evidence-packet-builder';
import { sha256CanonicalJson } from '../_shared/evidence-packet-canonical';

const RELEASE_ID = 'commercial-licenses-2026-08-28-001';
const SOURCE_ID = 'source-stock-2026-08';
const GENERATED_AT = '2026-08-28T18:00:00.000Z';

function metadata(overrides: Partial<ReleaseMetadata> = {}): ReleaseMetadata {
  return {
    producer: 'inteligencia-inmobiliaria',
    product: 'commercial-licenses',
    release_id: RELEASE_ID,
    schema_version: '0.1.0',
    data_as_of: '2026-08-28T12:00:00Z',
    promoted_at: '2026-08-28T13:00:00Z',
    quality_status: 'promoted',
    availability: 'current',
    data_marking: 'PUBLIC',
    last_good_release_id: 'commercial-licenses-2026-08-21-001',
    quality_report_uri: 'quality/releases/2026-08-28.json',
    ...overrides,
  };
}

function sourceRef() {
  return {
    source_ref: SOURCE_ID,
    source_kind: 'municipal_export' as const,
    municipality_cut: '13101',
    source_record_id: 'stock-001',
    uri: 'sources/stock-001.csv',
    sha256: 'a'.repeat(64),
    observed_at: '2026-08-28T10:00:00Z',
    effective_at: '2026-08-28T00:00:00Z',
  };
}

function patent(overrides: Partial<PatentGetResponse> = {}): PatentGetResponse {
  return {
    metadata: metadata(),
    source_refs: [sourceRef()],
    limitations: [],
    effective_on: null,
    license: {
      license_id: 'license-001',
      source_license_id: 'municipal-license-001',
      license_number: '1001',
      municipality_cut: '13101',
      license_type: 'commercial',
      reported_status: 'vigente',
      provisional_status: 'definitive',
      applied_at: '2023-12-01T00:00:00Z',
      granted_at: '2024-01-10T00:00:00Z',
      renewed_at: null,
      expires_at: null,
      address: {
        original: 'AVENIDA SINTETICA 100',
        normalized: 'Avenida Sintetica 100',
        unit: null,
        municipality_cut: '13101',
        source_refs: [SOURCE_ID],
      },
      holders: [
        {
          holder_kind: 'legal_entity',
          legal_entity_id: 'entity-old',
          legal_entity_rut: '76543210-K',
          display_name: 'SOCIEDAD SINTETICA ANTIGUA SPA',
          valid_from: '2024-01-10T00:00:00Z',
          valid_to: '2025-01-01T00:00:00Z',
          source_refs: [SOURCE_ID],
        },
        {
          holder_kind: 'legal_entity',
          legal_entity_id: 'entity-current',
          legal_entity_rut: '76543211-8',
          display_name: 'SOCIEDAD SINTETICA ACTUAL SPA',
          valid_from: '2025-01-01T00:00:00Z',
          valid_to: null,
          source_refs: [SOURCE_ID],
        },
      ],
      activities: [
        {
          activity: 'VENTA MINORISTA',
          valid_from: '2024-01-10T00:00:00Z',
          valid_to: null,
          source_refs: [SOURCE_ID],
        },
      ],
      source_refs: [SOURCE_ID],
    },
    timeline: [
      event('event-granted', '2024-01-10T00:00:00Z'),
      event('event-renewed', '2026-01-10T00:00:00Z', 'renewed'),
    ],
    establishments: [
      {
        establishment_id: 'establishment-001',
        name: 'Local sintético',
        address: {
          original: 'AVENIDA SINTETICA 100',
          normalized: 'Avenida Sintetica 100',
          unit: null,
          municipality_cut: '13101',
          source_refs: [SOURCE_ID],
        },
        valid_from: '2024-01-10T00:00:00Z',
        valid_to: null,
        source_refs: [SOURCE_ID],
      },
    ],
    parcel_matches: [
      {
        candidate_id: 'candidate-001',
        parcel_id: 'parcel-001',
        role: '100-20',
        match_status: 'resolved',
        method: 'source_role_exact',
        confidence: 0.99,
        parcel_release_id: 'parcels-2026-08-001',
        geometry: null,
        explanation: null,
        source_refs: [SOURCE_ID],
      },
    ],
    requirements: [
      {
        requirement_id: 'requirement-001',
        requirement_type: 'sanitary',
        responsible_organization: null,
        document_ref: null,
        issued_at: null,
        expires_at: null,
        reported_status: 'informado vigente',
        verified_at: null,
        source_refs: [SOURCE_ID],
      },
    ],
    measures: [],
    ...overrides,
  };
}

function event(
  eventId: string,
  effectiveAt: string,
  eventType: 'granted' | 'renewed' = 'granted',
) {
  return {
    event_id: eventId,
    event_type: eventType,
    effective_at: effectiveAt,
    observed_at: '2026-08-28T10:00:00Z',
    previous_status: null,
    next_status: 'vigente',
    administrative_act_ref: null,
    source_refs: [SOURCE_ID],
  };
}

function timeline(overrides: Partial<PatentTimelineResponse> = {}): PatentTimelineResponse {
  return {
    metadata: metadata(),
    source_refs: [sourceRef()],
    limitations: [],
    license_id: 'license-001',
    events: [
      event('event-granted', '2024-01-10T00:00:00Z'),
      event('event-renewed', '2026-01-10T00:00:00Z', 'renewed'),
    ],
    ...overrides,
  };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    action_id: 'action-open-review',
    action_type: 'OpenLicenseReview',
    permitted: true,
    authorized_roles: ['reviewer'],
    reason: 'The reviewer may open a read-only review.',
    legal_effect: 'none',
    prerequisites: [],
    blocking_gap_ids: [],
    blocking_conflict_ids: [],
    legal_authority_refs: [],
    evaluated_at: GENERATED_AT,
    ...overrides,
  };
}

function input(overrides: Partial<BuildEvidencePacketInput> = {}): BuildEvidencePacketInput {
  return {
    caseId: 'case-001',
    municipalityCut: '13101',
    classification: ['PUBLIC', 'ACTIVE_REVIEW'],
    builderVersion: '0.1.0-test',
    generatedAt: GENERATED_AT,
    requestedReleaseId: RELEASE_ID,
    patent: patent(),
    timeline: timeline(),
    permittedNextActions: [action()],
    recommendedNextActionId: 'action-open-review',
    ...overrides,
  };
}

describe('EvidencePacket builder', () => {
  test('builds a validated packet with pinned snapshot, timeline, sources and hashes', async () => {
    const packet = await buildEvidencePacket(input());

    expect(packet.schema_version).toBe('0.1.0');
    expect(packet.pinned_releases.map((release) => release.capability)).toEqual([
      'patents.get',
      'patents.timeline',
    ]);
    expect(packet.pinned_releases.every((release) => release.release_id === RELEASE_ID)).toBe(true);
    expect(packet.source_refs).toHaveLength(1);
    expect(packet.parcel_resolutions[0]).toMatchObject({
      establishment_id: 'establishment-001',
      status: 'resolved',
      selected_candidate_id: 'candidate-001',
    });
    expect(packet.reproducibility.input_queries).toHaveLength(2);
    const getQuery = packet.reproducibility.input_queries.find((query) =>
      query.capability === 'patents.get'
    );
    expect(getQuery?.request_sha256).toBe(await sha256CanonicalJson({
      municipalityCut: '13101',
      sourceLicenseId: 'municipal-license-001',
      releaseId: RELEASE_ID,
    }));
    expect(getQuery?.response_sha256).toBe(
      packet.pinned_releases.find((release) => release.capability === 'patents.get')
        ?.response_sha256,
    );
    expect(packet.reproducibility.packet_content_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  test('uses validity intervals and event dates for a historical packet', async () => {
    const packet = await buildEvidencePacket(input({ effectiveOn: '2024-06-01' }));

    expect(packet.holders.map((holder) => holder.legal_entity_id)).toEqual(['entity-old']);
    expect(packet.timeline.map((item) => item.event_id)).toEqual(['event-granted']);
  });

  test('rejects an invalid historical effective date before filtering', async () => {
    await expect(buildEvidencePacket(input({ effectiveOn: '2026-02-30' }))).rejects.toMatchObject({
      name: 'EvidencePacketBuilderError',
      kind: 'invalid_input',
    });
  });

  test.each(['ambiguous', 'unresolved'] as const)(
    'keeps a %s parcel match unselected and visible as a gap',
    async (matchStatus) => {
      const source = patent();
      const degraded = patent({
        parcel_matches: source.parcel_matches.map((match) => ({
          ...match,
          match_status: matchStatus,
        })),
      });

      const packet = await buildEvidencePacket(input({ patent: degraded }));

      expect(packet.parcel_resolutions[0]).toMatchObject({
        status: matchStatus,
        selected_candidate_id: null,
      });
      expect(packet.gaps.some((gap) => gap.code === 'unresolved_match')).toBe(true);
    },
  );

  test('is invariant to incidental upstream collection order', async () => {
    const firstPatent = patent();
    const reorderedPatent = patent({
      license: {
        ...firstPatent.license,
        holders: [...firstPatent.license.holders].reverse(),
      },
      timeline: [...firstPatent.timeline].reverse(),
    });
    const firstTimeline = timeline();
    const [first, reordered] = await Promise.all([
      buildEvidencePacket(input({ patent: firstPatent, timeline: firstTimeline })),
      buildEvidencePacket(input({
        patent: reorderedPatent,
        timeline: { ...firstTimeline, events: [...firstTimeline.events].reverse() },
      })),
    ]);

    expect(reordered.reproducibility.packet_content_sha256).toBe(
      first.reproducibility.packet_content_sha256,
    );
  });

  test('changes the content hash when a material fact changes', async () => {
    const baseline = await buildEvidencePacket(input());
    const source = patent();
    const changed = await buildEvidencePacket(input({
      patent: patent({
        license: { ...source.license, reported_status: 'suspendida' },
      }),
    }));

    expect(changed.reproducibility.packet_content_sha256).not.toBe(
      baseline.reproducibility.packet_content_sha256,
    );
  });

  test('preserves order-significant numeric geometry when hashing the response', async () => {
    const source = patent();
    const withGeometry = (coordinates: number[]) => patent({
      parcel_matches: source.parcel_matches.map((match) => ({
        ...match,
        geometry: { type: 'LineString', coordinates },
      })),
    });
    const [forward, reversed] = await Promise.all([
      buildEvidencePacket(input({ patent: withGeometry([-70.6, -33.4]) })),
      buildEvidencePacket(input({ patent: withGeometry([-33.4, -70.6]) })),
    ]);

    expect(reversed.reproducibility.packet_content_sha256).not.toBe(
      forward.reproducibility.packet_content_sha256,
    );
  });

  test('preserves incompatible snapshot and timeline assertions as an open conflict', async () => {
    const secondSource = {
      ...sourceRef(),
      source_ref: 'source-timeline-2026-08',
      source_record_id: 'timeline-001',
      uri: 'sources/timeline-001.csv',
      sha256: 'b'.repeat(64),
    };
    const conflictingTimeline = timeline({
      source_refs: [secondSource],
      events: [
        {
          ...event('event-granted', '2024-01-10T00:00:00Z'),
          source_refs: [secondSource.source_ref],
        },
        {
          ...event('event-renewed', '2026-01-10T00:00:00Z', 'renewed'),
          next_status: 'suspendida',
          source_refs: [secondSource.source_ref],
        },
      ],
    });

    const packet = await buildEvidencePacket(input({ timeline: conflictingTimeline }));

    expect(packet.conflicts).toHaveLength(1);
    expect(packet.conflicts[0]).toMatchObject({
      status: 'open',
      assertions: [{ object_ref: 'event-renewed' }, { object_ref: 'event-renewed' }],
    });
    expect(packet.conflicts[0]?.assertions.map((assertion) => assertion.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ next_status: 'vigente' }),
        expect.objectContaining({ next_status: 'suspendida' }),
      ]),
    );
    expect(packet.conflicts[0]?.assertions.map((assertion) => assertion.source_refs)).toEqual(
      expect.arrayContaining([[SOURCE_ID], [secondSource.source_ref]]),
    );
  });

  test('converts an upstream limitation into a traceable gap without a finding', async () => {
    const limited = patent({
      limitations: [{
        code: 'data_gap',
        message: 'The municipality omitted one historical period.',
        affected_fields: ['timeline'],
        source_refs: [SOURCE_ID],
      }],
    });

    const packet = await buildEvidencePacket(input({ patent: limited }));
    const gap = packet.gaps.find((item) => item.code === 'coverage_gap');

    expect(gap).toMatchObject({
      status: 'open',
      affected_objects: ['license-001'],
      source_refs: [SOURCE_ID],
    });
    expect(gap?.consequence).toContain('cannot support a conclusive administrative finding');
    expect(
      packet.pinned_releases.find((release) => release.capability === 'patents.get')
        ?.limitation_ids,
    ).toEqual([gap?.gap_id]);
  });

  test('rejects a snapshot or timeline outside the pinned release', async () => {
    const mismatchedTimeline = timeline({
      metadata: metadata({ release_id: 'commercial-licenses-other-release' }),
    });

    await expect(buildEvidencePacket(input({ timeline: mismatchedTimeline }))).rejects.toMatchObject({
      name: 'EvidencePacketBuilderError',
      kind: 'release_mismatch',
    });
  });

  test('makes stale data and an unavailable timeline visible as gaps', async () => {
    const stalePatent = patent({
      metadata: metadata({ availability: 'stale_last_good' }),
    });
    const packet = await buildEvidencePacket(input({
      patent: stalePatent,
      timeline: undefined,
      timelineUnavailable: true,
    }));

    expect(packet.gaps.map((gap) => gap.code)).toEqual(
      expect.arrayContaining(['stale_release', 'unavailable_capability']),
    );
    expect(packet.pinned_releases.map((release) => release.capability)).toEqual(['patents.get']);
  });

  test('does not duplicate a stale gap already declared by the upstream release', async () => {
    const stalePatent = patent({
      metadata: metadata({ availability: 'stale_last_good' }),
      limitations: [{
        code: 'stale_release',
        message: 'The last promoted release is being served.',
        source_refs: [SOURCE_ID],
      }],
    });

    const packet = await buildEvidencePacket(input({ patent: stalePatent }));
    const staleGaps = packet.gaps.filter((gap) => gap.code === 'stale_release');
    const patentRelease = packet.pinned_releases.find((release) =>
      release.capability === 'patents.get'
    );

    expect(staleGaps).toHaveLength(1);
    expect(patentRelease?.limitation_ids).toEqual([staleGaps[0]?.gap_id]);
  });

  test('rejects incompatible duplicate source definitions', async () => {
    await expect(buildEvidencePacket(input({
      sourceRefs: [{
        source_ref: SOURCE_ID,
        producer: 'another-producer',
        product: null,
        release_id: null,
        source_kind: 'other',
        municipality_cut: null,
        source_record_id: null,
        uri: null,
        sha256: null,
        observed_at: GENERATED_AT,
        effective_at: null,
      }],
    }))).rejects.toBeInstanceOf(EvidencePacketBuilderError);
  });

  test('rejects a recommendation that is absent or not permitted', async () => {
    await expect(buildEvidencePacket(input({
      permittedNextActions: [action({ permitted: false })],
      recommendedNextActionId: 'action-open-review',
    }))).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  test('rejects a permitted action that still has an active blocker', async () => {
    const gap = {
      gap_id: 'gap-explicit',
      code: 'coverage_gap',
      description: 'Synthetic coverage gap.',
      affected_objects: ['license-001'],
      consequence: 'The action must remain blocked.',
      status: 'open',
      detected_at: GENERATED_AT,
      source_refs: [SOURCE_ID],
    };

    await expect(buildEvidencePacket(input({
      gaps: [gap],
      permittedNextActions: [action({ blocking_gap_ids: ['gap-explicit'] })],
    }))).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  test('orchestrates snapshot and timeline with the exact same release', async () => {
    const getPatent = vi.fn(async () => patent());
    const getPatentTimeline = vi.fn(async () => timeline());
    const client = {
      getPatent,
      getPatentTimeline,
      searchPatents: vi.fn(),
      getPatentCoverage: vi.fn(),
      resolveEstablishment: vi.fn(),
    } as unknown as CommercialLicensesClient;
    const builder = createEvidencePacketBuilder({
      client,
      builderVersion: '0.1.0-test',
      now: () => new Date(GENERATED_AT),
    });

    const packet = await builder.build({
      caseId: 'case-001',
      municipalityCut: '13101',
      classification: ['ACTIVE_REVIEW'],
      licenseId: 'license-001',
      releaseId: RELEASE_ID,
      permittedNextActions: [action()],
    });

    expect(getPatent).toHaveBeenCalledWith(expect.objectContaining({ releaseId: RELEASE_ID }));
    expect(getPatentTimeline).toHaveBeenCalledWith(expect.objectContaining({ releaseId: RELEASE_ID }));
    expect(packet.reproducibility.input_queries.map((query) => query.release_id)).toEqual([
      RELEASE_ID,
      RELEASE_ID,
    ]);
  });

  test('turns an orchestrated timeline failure into a gap without a fictitious release', async () => {
    const client = {
      getPatent: vi.fn(async () => patent()),
      getPatentTimeline: vi.fn(async () => {
        throw new CommercialLicensesClientError('timeout', 'Commercial licenses request timed out');
      }),
      searchPatents: vi.fn(),
      getPatentCoverage: vi.fn(),
      resolveEstablishment: vi.fn(),
    } as unknown as CommercialLicensesClient;
    const builder = createEvidencePacketBuilder({
      client,
      builderVersion: '0.1.0-test',
      now: () => new Date(GENERATED_AT),
    });

    const packet = await builder.build({
      caseId: 'case-001',
      municipalityCut: '13101',
      classification: ['ACTIVE_REVIEW'],
      licenseId: 'license-001',
      releaseId: RELEASE_ID,
      permittedNextActions: [action()],
    });

    expect(packet.gaps.some((gap) => gap.code === 'unavailable_capability')).toBe(true);
    expect(packet.pinned_releases.map((release) => release.capability)).toEqual(['patents.get']);
  });

  test('does not downgrade a release mismatch to a data gap', async () => {
    const mismatch = new CommercialLicensesClientError(
      'release_mismatch',
      'Commercial licenses response did not use the requested release',
    );
    const client = {
      getPatent: vi.fn(async () => patent()),
      getPatentTimeline: vi.fn(async () => { throw mismatch; }),
      searchPatents: vi.fn(),
      getPatentCoverage: vi.fn(),
      resolveEstablishment: vi.fn(),
    } as unknown as CommercialLicensesClient;
    const builder = createEvidencePacketBuilder({
      client,
      builderVersion: '0.1.0-test',
      now: () => new Date(GENERATED_AT),
    });

    await expect(builder.build({
      caseId: 'case-001',
      municipalityCut: '13101',
      classification: ['ACTIVE_REVIEW'],
      licenseId: 'license-001',
      releaseId: RELEASE_ID,
      permittedNextActions: [action()],
    })).rejects.toBe(mismatch);
  });

  test('records a requested establishment resolution outage as a gap', async () => {
    const client = {
      getPatent: vi.fn(async () => patent()),
      getPatentTimeline: vi.fn(async () => timeline()),
      searchPatents: vi.fn(),
      getPatentCoverage: vi.fn(),
      resolveEstablishment: vi.fn(async () => {
        throw new CommercialLicensesClientError('network', 'Commercial licenses request failed');
      }),
    } as unknown as CommercialLicensesClient;
    const builder = createEvidencePacketBuilder({
      client,
      builderVersion: '0.1.0-test',
      now: () => new Date(GENERATED_AT),
    });

    const packet = await builder.build({
      caseId: 'case-001',
      municipalityCut: '13101',
      classification: ['ACTIVE_REVIEW'],
      licenseId: 'license-001',
      releaseId: RELEASE_ID,
      establishmentRequest: {
        municipality_cut: '13101',
        address: 'AVENIDA SINTETICA 100',
      },
      permittedNextActions: [action()],
    });

    expect(packet.gaps.some((gap) =>
      gap.code === 'unavailable_capability' &&
      gap.description.includes('establishment resolution')
    )).toBe(true);
    expect(packet.pinned_releases.some((release) =>
      release.capability === 'establishments.resolve'
    )).toBe(false);
  });

  test('pins and hashes a successful establishment resolution query', async () => {
    const resolution = {
      metadata: metadata(),
      source_refs: [sourceRef()],
      limitations: [],
      resolution_status: 'resolved' as const,
      selected_candidate_id: 'candidate-001',
      candidates: [{
        candidate_id: 'candidate-001',
        establishment: patent().establishments[0]!,
        parcel_match: patent().parcel_matches[0]!,
      }],
    };
    const client = {
      getPatent: vi.fn(async () => patent()),
      getPatentTimeline: vi.fn(async () => timeline()),
      searchPatents: vi.fn(),
      getPatentCoverage: vi.fn(),
      resolveEstablishment: vi.fn(async () => resolution),
    } as unknown as CommercialLicensesClient;
    const builder = createEvidencePacketBuilder({
      client,
      builderVersion: '0.1.0-test',
      now: () => new Date(GENERATED_AT),
    });

    const packet = await builder.build({
      caseId: 'case-001',
      municipalityCut: '13101',
      classification: ['ACTIVE_REVIEW'],
      licenseId: 'license-001',
      releaseId: RELEASE_ID,
      establishmentRequest: {
        municipality_cut: '13101',
        address: 'AVENIDA SINTETICA 100',
      },
      permittedNextActions: [action()],
    });

    expect(packet.pinned_releases.map((release) => release.capability)).toContain(
      'establishments.resolve',
    );
    expect(packet.reproducibility.input_queries.map((query) => query.capability)).toContain(
      'establishments.resolve',
    );
  });

  test('requires an explicit query record for an injected establishment resolution', async () => {
    const resolution = {
      metadata: metadata(),
      source_refs: [sourceRef()],
      limitations: [],
      resolution_status: 'resolved' as const,
      selected_candidate_id: 'candidate-001',
      candidates: [{
        candidate_id: 'candidate-001',
        establishment: patent().establishments[0]!,
        parcel_match: patent().parcel_matches[0]!,
      }],
    };

    await expect(buildEvidencePacket(input({
      establishmentResolution: resolution,
    }))).rejects.toMatchObject({
      name: 'EvidencePacketBuilderError',
      kind: 'invalid_input',
    });
  });
});
