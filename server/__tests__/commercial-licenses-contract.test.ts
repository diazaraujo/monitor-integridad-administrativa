// @vitest-environment node

// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  CommercialLicensesContractError,
  parseEstablishmentResolveResponse,
  parsePatentCoverageResponse,
  parsePatentGetResponse,
  parsePatentSearchResponse,
  parsePatentTimelineResponse,
} from '../_shared/commercial-licenses-contract';

const SOURCE_ID = 'src-stock-2026-08';

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    producer: 'inteligencia-inmobiliaria',
    product: 'commercial-licenses',
    release_id: 'commercial-licenses-2026-08-28-001',
    schema_version: '0.1.0',
    data_as_of: '2026-08-28T12:00:00Z',
    promoted_at: '2026-08-28T13:00:00Z',
    quality_status: 'promoted',
    availability: 'current',
    data_marking: 'PUBLIC',
    last_good_release_id: 'commercial-licenses-2026-08-21-001',
    quality_report_uri: 'quality/commercial-licenses-2026-08-28-001.json',
    ...overrides,
  };
}

function sourceRef() {
  return {
    source_ref: SOURCE_ID,
    source_kind: 'municipal_export',
    municipality_cut: '13101',
    source_record_id: 'stock-2026-08',
    uri: 'sources/stock-2026-08.csv',
    sha256: 'a'.repeat(64),
    observed_at: '2026-08-28T10:00:00Z',
    effective_at: '2026-08-28T00:00:00Z',
  };
}

function address() {
  return {
    original: 'AV. PRUEBA 400',
    normalized: 'Avenida Prueba 400',
    municipality_cut: '13101',
    source_refs: [SOURCE_ID],
  };
}

function establishment(id = 'est-001') {
  return {
    establishment_id: id,
    name: 'Local sintético',
    address: address(),
    source_refs: [SOURCE_ID],
  };
}

function parcelMatch(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function license() {
  return {
    license_id: 'lic-001',
    source_license_id: 'source-lic-001',
    license_number: '1001',
    municipality_cut: '13101',
    license_type: 'commercial',
    reported_status: 'vigente',
    provisional_status: 'definitive',
    granted_at: '2024-01-10T12:00:00Z',
    address: address(),
    holders: [{
      holder_kind: 'legal_entity',
      legal_entity_id: 'entity-001',
      legal_entity_rut: '76543210-K',
      display_name: 'SOCIEDAD SINTETICA SPA',
      valid_from: '2024-01-10T12:00:00Z',
      source_refs: [SOURCE_ID],
    }],
    activities: [{
      activity: 'VENTA MINORISTA',
      valid_from: '2024-01-10T12:00:00Z',
      source_refs: [SOURCE_ID],
    }],
    source_refs: [SOURCE_ID],
  };
}

function event(id: string, effectiveAt: string) {
  return {
    event_id: id,
    event_type: 'granted',
    effective_at: effectiveAt,
    observed_at: '2026-08-28T10:00:00Z',
    previous_status: null,
    next_status: 'vigente',
    administrative_act_ref: null,
    source_refs: [SOURCE_ID],
  };
}

function envelope() {
  return { metadata: metadata(), source_refs: [sourceRef()], limitations: [] };
}

function refresh(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'refresh-001',
    trigger: 'scheduled',
    status: 'success',
    started_at: '2026-08-28T13:00:00Z',
    completed_at: '2026-08-28T13:01:00Z',
    discovery_status: 'success',
    discovered_resources: 123,
    candidate_resources: 104,
    pending_releases: 0,
    imported_releases: 0,
    failed_releases: 0,
    ...overrides,
  };
}

function patentGet() {
  return {
    ...envelope(),
    effective_on: null,
    license: license(),
    timeline: [event('evt-001', '2024-01-10T12:00:00Z')],
    establishments: [establishment()],
    parcel_matches: [parcelMatch()],
    requirements: [{
      requirement_id: 'req-001',
      requirement_type: 'sanitary',
      reported_status: 'vigente',
      source_refs: [SOURCE_ID],
    }],
    measures: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('commercial-licenses response contract', () => {
  test('keeps ten processable Purranque acceptance fixtures on the pinned release', () => {
    const document = parseYaml(readFileSync(new URL(
      '../../docs/research/contracts/commercial-licenses.fixtures.yaml',
      import.meta.url,
    ), 'utf8')) as {
      municipality_cut: string;
      release: { release_id: string; last_good_release_id: string };
      fixtures: Array<{
        fixture_id: string;
        request: { municipality_cut: string };
        expected: Record<string, unknown>;
      }>;
    };

    expect(document.municipality_cut).toBe('10303');
    expect(document.release).toMatchObject({
      release_id: 'purranque-2026-s1',
      last_good_release_id: 'purranque-2025-s2',
    });
    expect(document.fixtures).toHaveLength(10);
    expect(new Set(document.fixtures.map((fixture) => fixture.fixture_id)).size).toBe(10);
    expect(document.fixtures.every((fixture) => fixture.request.municipality_cut === '10303'))
      .toBe(true);
    expect(document.fixtures.map((fixture) => fixture.fixture_id)).toEqual([
      'CL-VIG-001', 'CL-PROV-002', 'CL-HIST-003', 'CL-MATCH-004', 'CL-AMB-005',
      'CL-NOMATCH-006', 'CL-GAP-007', 'CL-NAT-008', 'CL-CLOSE-009', 'CL-ABSENT-010',
    ]);
    expect(JSON.stringify(document)).not.toMatch(/\b\d{7,8}-[0-9K]\b/iu);
  });

  test('publishes X-Service-Key as the only OpenAPI security scheme', () => {
    const document = parseYaml(readFileSync(new URL(
      '../../docs/research/contracts/commercial-licenses.openapi.yaml',
      import.meta.url,
    ), 'utf8')) as {
      security: Array<Record<string, unknown>>;
      components: { securitySchemes: Record<string, Record<string, unknown>> };
    };
    expect(document.security).toEqual([{ ServiceKeyAuth: [] }]);
    expect(document.components.securitySchemes).toEqual({
      ServiceKeyAuth: expect.objectContaining({
        type: 'apiKey', in: 'header', name: 'X-Service-Key',
      }),
    });
  });

  test('matches the operational producer surface and five canonical capabilities', () => {
    const document = parseYaml(readFileSync(new URL(
      '../../docs/research/contracts/commercial-licenses.openapi.yaml',
      import.meta.url,
    ), 'utf8')) as {
      info: { version: string };
      servers: Array<{ url: string }>;
      paths: Record<string, { get?: Record<string, any>; post?: Record<string, any> }>;
      components: { parameters: Record<string, any>; schemas: Record<string, any> };
    };
    expect(document.info.version).toBe('0.1.0');
    expect(document.servers).toEqual([{ url: 'http://10.0.0.3:8130/api/integrity', description: expect.any(String) }]);

    const operations = Object.values(document.paths).flatMap((path) => [path.get, path.post])
      .filter(Boolean);
    expect(operations.map((operation) => operation?.['x-capability']).sort()).toEqual([
      'establishments.resolve', 'patents.coverage', 'patents.get', 'patents.search',
      'patents.timeline',
    ]);
    expect(operations.map((operation) => operation?.operationId).sort()).toEqual([
      'establishmentsResolve', 'patentsCoverage', 'patentsGet', 'patentsSearch',
      'patentsTimeline',
    ]);

    const search = document.paths['/v1/patents/search']?.get;
    const searchParameters = search?.parameters as Array<Record<string, any>>;
    expect(searchParameters.some((parameter) => parameter.name === 'legal_entity_rut')).toBe(false);
    expect(searchParameters.find((parameter) => parameter.name === 'limit')?.schema.maximum).toBe(100);
    expect(document.components.parameters.SourceLicenseId.name).toBe('source_license_id');
    expect(document.components.parameters.Representation.schema.enum).toEqual(['public']);
    expect(document.components.schemas.ReleaseMetadata.properties.data_marking.const).toBe('PUBLIC');
    expect(document.components.schemas.ErrorResponse.required).toEqual(['error']);
    expect(document.components.schemas.ErrorResponse.properties.error.required).toEqual([
      'code', 'message', 'retryable',
    ]);
  });

  test('parses a complete patents.get response', () => {
    const parsed = parsePatentGetResponse(patentGet());
    expect(parsed.metadata.release_id).toBe('commercial-licenses-2026-08-28-001');
    expect(parsed.license.address.original).toBe('AV. PRUEBA 400');
  });

  test('parses all four remaining capability response shapes', () => {
    const timeline = parsePatentTimelineResponse({
      ...envelope(),
      license_id: 'lic-001',
      events: [event('evt-001', '2024-01-10T12:00:00Z')],
    });
    const search = parsePatentSearchResponse({
      ...envelope(),
      items: [{ license: license(), establishments: [establishment()], parcel_matches: [parcelMatch()], limitations: [] }],
      next_cursor: null,
    });
    const coverage = parsePatentCoverageResponse({
      ...envelope(),
      refresh: refresh(),
      coverage: [{
        municipality_cut: '13101',
        period_from: '2021-01-01',
        period_to: '2026-08-28',
        declared_universe: 10,
        received_records: 10,
        included_license_types: ['commercial'],
        available_fields: ['reported_status'],
        freshness_status: 'current',
        gaps: [],
      }],
    });
    const resolved = parseEstablishmentResolveResponse({
      ...envelope(),
      resolution_status: 'resolved',
      selected_candidate_id: 'candidate-001',
      candidates: [{ candidate_id: 'candidate-001', establishment: establishment(), parcel_match: parcelMatch() }],
    });

    expect(timeline.events).toHaveLength(1);
    expect(search.items).toHaveLength(1);
    expect(coverage.coverage[0].received_records).toBe(10);
    expect(coverage.refresh.candidate_resources).toBe(104);
    expect(resolved.selected_candidate_id).toBe('candidate-001');
  });

  test('accepts never_run and rejects contradictory refresh outcomes', () => {
    const payload = {
      ...envelope(),
      refresh: { status: 'never_run' },
      coverage: [],
    };
    expect(parsePatentCoverageResponse(payload).refresh.status).toBe('never_run');

    payload.refresh = refresh({ status: 'success', failed_releases: 1 });
    expect(() => parsePatentCoverageResponse(payload)).toThrowError(/failed_releases/);

    payload.refresh = refresh({ status: 'failed', failed_releases: 0 });
    expect(() => parsePatentCoverageResponse(payload)).toThrowError(/failed_releases/);
  });

  test('rejects unknown properties at every validated level', () => {
    const payload = patentGet();
    Object.assign(payload.license.holders[0], { email: 'not-allowed@example.test' });
    expect(() => parsePatentGetResponse(payload)).toThrowError(/holders\[0\]\.email: is not allowed/);
  });

  test('requires canonical producer, product, promoted status, and semantic schema version', () => {
    for (const [key, invalid] of [
      ['producer', 'another-producer'],
      ['product', 'another-product'],
      ['quality_status', 'candidate'],
      ['schema_version', 'v1'],
    ] as const) {
      const payload = patentGet();
      Object.assign(payload.metadata, { [key]: invalid });
      expect(() => parsePatentGetResponse(payload), key).toThrow(CommercialLicensesContractError);
    }
  });

  test('requires stale fallback metadata and an explicit stale limitation', () => {
    const missingId = patentGet();
    Object.assign(missingId.metadata, { availability: 'stale_last_good', last_good_release_id: null });
    expect(() => parsePatentGetResponse(missingId)).toThrowError(/last_good_release_id/);

    const missingLimitation = patentGet();
    Object.assign(missingLimitation.metadata, { availability: 'stale_last_good' });
    expect(() => parsePatentGetResponse(missingLimitation)).toThrowError(/must include stale_release/);
  });

  test('rejects invalid CUT, timestamps, digests, and confidence', () => {
    const mutations: Array<(payload: ReturnType<typeof patentGet>) => void> = [
      (payload) => { payload.license.municipality_cut = '1310'; },
      (payload) => { payload.metadata.data_as_of = '2026-08-28'; },
      (payload) => { payload.metadata.data_as_of = '2026-02-30T12:00:00Z'; },
      (payload) => { payload.source_refs[0].sha256 = 'abc'; },
      (payload) => { payload.parcel_matches[0].confidence = 1.01; },
    ];
    for (const mutate of mutations) {
      const payload = patentGet();
      mutate(payload);
      expect(() => parsePatentGetResponse(payload)).toThrow(CommercialLicensesContractError);
    }
  });

  test('rejects source links absent from the response source catalog', () => {
    const payload = patentGet();
    payload.requirements[0].source_refs = ['unknown-source'];
    expect(() => parsePatentGetResponse(payload)).toThrowError(/references unknown source_ref unknown-source/);
  });

  test('requires original source addresses and aligned municipality CUT', () => {
    const noOriginal = patentGet() as ReturnType<typeof patentGet> & { license: { address: Record<string, unknown> } };
    delete noOriginal.license.address.original;
    expect(() => parsePatentGetResponse(noOriginal)).toThrowError(/address\.original: is required/);

    const wrongCut = patentGet();
    wrongCut.license.address.municipality_cut = '13102';
    expect(() => parsePatentGetResponse(wrongCut)).toThrowError(/must match the license municipality_cut/);
  });

  test('enforces natural-person redaction without reopening policy decisions', () => {
    const payload = patentGet();
    Object.assign(payload.license.holders[0], {
      holder_kind: 'natural_person_redacted',
      legal_entity_id: null,
      legal_entity_rut: null,
      display_name: 'REDACTED',
    });
    expect(parsePatentGetResponse(payload).license.holders[0].display_name).toBe('REDACTED');

    const exposed = clone(payload);
    exposed.license.holders[0].display_name = 'A PERSON';
    expect(() => parsePatentGetResponse(exposed)).toThrowError(/must be REDACTED/);
  });

  test('rejects timelines that are not ordered by effective date', () => {
    const payload = patentGet();
    payload.timeline = [
      event('evt-later', '2025-01-01T00:00:00Z'),
      event('evt-earlier', '2024-01-01T00:00:00Z'),
    ];
    expect(() => parsePatentGetResponse(payload)).toThrowError(/events must be ordered/);
  });

  test('rejects an event effective after it was observed', () => {
    const payload = patentGet();
    payload.timeline[0].effective_at = '2026-08-29T00:00:00Z';
    expect(() => parsePatentGetResponse(payload)).toThrowError(/must not be after observed_at/);
  });

  test('requires resolved selection to identify a returned resolved candidate', () => {
    const payload = {
      ...envelope(),
      resolution_status: 'resolved',
      selected_candidate_id: 'missing',
      candidates: [{ candidate_id: 'candidate-001', establishment: establishment(), parcel_match: parcelMatch() }],
    };
    expect(() => parseEstablishmentResolveResponse(payload)).toThrowError(/must identify a returned candidate/);
  });

  test('requires ambiguous resolution to remain unselected and expose at least two candidates', () => {
    const ambiguousMatch = (id: string) => parcelMatch({ candidate_id: id, match_status: 'ambiguous', confidence: 0.5 });
    const payload = {
      ...envelope(),
      limitations: [{ code: 'ambiguous_match', message: 'Two candidates remain.' }],
      resolution_status: 'ambiguous',
      selected_candidate_id: null,
      candidates: [{ candidate_id: 'candidate-a', establishment: establishment('est-a'), parcel_match: ambiguousMatch('candidate-a') }],
    };
    expect(() => parseEstablishmentResolveResponse(payload)).toThrowError(/at least two candidates/);

    payload.selected_candidate_id = 'candidate-a';
    expect(() => parseEstablishmentResolveResponse(payload)).toThrowError(/must be null/);
  });

  test('requires unresolved resolution to expose no candidates and its limitation', () => {
    const valid = {
      ...envelope(),
      limitations: [{ code: 'unresolved_match', message: 'No candidate found.' }],
      resolution_status: 'unresolved',
      selected_candidate_id: null,
      candidates: [],
    };
    expect(parseEstablishmentResolveResponse(valid).candidates).toEqual([]);

    const missingLimitation = { ...valid, limitations: [] };
    expect(() => parseEstablishmentResolveResponse(missingLimitation)).toThrowError(/must include unresolved_match/);
  });

  test('rejects contradictory parcel-match states', () => {
    const noParcel = patentGet();
    noParcel.parcel_matches[0].parcel_id = null;
    expect(() => parsePatentGetResponse(noParcel)).toThrowError(/must identify the resolved parcel/);

    const unresolvedMethod = patentGet();
    Object.assign(unresolvedMethod.parcel_matches[0], { match_status: 'unresolved', method: 'spatial' });
    expect(() => parsePatentGetResponse(unresolvedMethod)).toThrowError(/must be none for an unresolved match/);
  });

  test('rejects inverted temporal validity and coverage periods', () => {
    const payload = patentGet();
    Object.assign(payload.license.address, {
      valid_from: '2026-08-29T00:00:00Z',
      valid_to: '2026-08-28T00:00:00Z',
    });
    expect(() => parsePatentGetResponse(payload)).toThrowError(/valid_from must not be after valid_to/);

    const coverage = {
      ...envelope(),
      refresh: refresh(),
      coverage: [{
        municipality_cut: '13101',
        period_from: '2026-08-28',
        period_to: '2021-01-01',
        received_records: 0,
        included_license_types: [],
        available_fields: [],
        freshness_status: 'unknown',
        gaps: [],
      }],
    };
    expect(() => parsePatentCoverageResponse(coverage)).toThrowError(/period_from must not be after period_to/);
  });
});
