// @vitest-environment node

import { readFile } from 'node:fs/promises';

import { describe, expect, test, vi } from 'vitest';

import type { CommercialLicensesClient } from '../_shared/commercial-licenses-client';
import type {
  PatentGetResponse,
  PatentTimelineResponse,
  ReleaseMetadata,
  SourceRef,
} from '../_shared/commercial-licenses-contract';
import {
  evaluateHistoricalPatentCohort,
  parseHistoricalPatentCohort,
  type HistoricalPatentCohort,
} from '../_shared/historical-patent-cohort';

const FIXTURE_URL = new URL(
  '../../data/integrity/historical-provisional-license-cohort-v1.json',
  import.meta.url,
);

async function fixture(): Promise<HistoricalPatentCohort> {
  return parseHistoricalPatentCohort(JSON.parse(await readFile(FIXTURE_URL, 'utf8')));
}

function metadata(releaseId: string): ReleaseMetadata {
  return {
    producer: 'inteligencia-inmobiliaria',
    product: 'commercial-licenses',
    release_id: releaseId,
    schema_version: '0.1.0',
    data_as_of: '2026-06-30T23:59:59Z',
    promoted_at: '2026-08-31T20:00:00Z',
    quality_status: 'promoted',
    availability: 'current',
    data_marking: 'PUBLIC',
    last_good_release_id: releaseId,
    quality_report_uri: `quality/${releaseId}.json`,
  };
}

function sourceRef(municipalityCut: string, licenseId: string): SourceRef {
  return {
    source_ref: `source-${municipalityCut}-${licenseId}`,
    source_kind: 'municipal_export',
    municipality_cut: municipalityCut,
    source_record_id: licenseId,
    uri: null,
    sha256: 'a'.repeat(64),
    observed_at: '2026-08-31T20:00:00Z',
    effective_at: '2026-06-30T00:00:00Z',
  };
}

function patentResponse(params: {
  municipalityCut: string;
  licenseId: string;
  releaseId: string;
  effectiveOn?: string;
}): PatentGetResponse {
  const source = sourceRef(params.municipalityCut, params.licenseId);
  const canonicalLicenseId = `canonical-${params.municipalityCut}-${params.licenseId}`;
  const establishmentId = `establishment-${params.municipalityCut}-${params.licenseId}`;
  const event = {
    event_id: `event-${params.municipalityCut}-${params.licenseId}`,
    event_type: 'granted' as const,
    effective_at: '2025-01-01T00:00:00Z',
    observed_at: '2026-08-31T20:00:00Z',
    previous_status: null,
    next_status: 'vigente',
    administrative_act_ref: null,
    source_refs: [source.source_ref],
  };
  const address = {
    original: 'DIRECCION OMITIDA EN FIXTURE DE PRUEBA',
    normalized: null,
    unit: null,
    municipality_cut: params.municipalityCut,
    source_refs: [source.source_ref],
  };

  return {
    metadata: metadata(params.releaseId),
    source_refs: [source],
    limitations: [],
    effective_on: params.effectiveOn ?? null,
    license: {
      license_id: canonicalLicenseId,
      source_license_id: params.licenseId,
      license_number: params.licenseId,
      municipality_cut: params.municipalityCut,
      license_type: 'commercial',
      reported_status: 'vigente',
      provisional_status: 'provisional',
      applied_at: null,
      granted_at: '2025-01-01T00:00:00Z',
      renewed_at: null,
      expires_at: null,
      address,
      holders: [],
      activities: [],
      source_refs: [source.source_ref],
    },
    timeline: [event],
    establishments: [{
      establishment_id: establishmentId,
      name: null,
      address,
      valid_from: '2025-01-01T00:00:00Z',
      valid_to: null,
      source_refs: [source.source_ref],
    }],
    parcel_matches: [{
      candidate_id: `candidate-${params.municipalityCut}-${params.licenseId}`,
      parcel_id: null,
      role: null,
      match_status: 'unresolved',
      method: 'none',
      confidence: 0,
      parcel_release_id: 'parcel-test-release',
      geometry: null,
      explanation: 'No deterministic parcel match is available.',
      source_refs: [source.source_ref],
    }],
    requirements: [],
    measures: [],
  };
}

function timelineResponse(params: {
  municipalityCut: string;
  licenseId: string;
  releaseId: string;
}): PatentTimelineResponse {
  const patent = patentResponse(params);
  return {
    metadata: patent.metadata,
    source_refs: patent.source_refs,
    limitations: [],
    license_id: patent.license.license_id,
    events: patent.timeline,
  };
}

function fakeClient() {
  const getPatent = vi.fn(async (params: {
    municipalityCut: string;
    sourceLicenseId: string;
    releaseId?: string;
    effectiveOn?: string;
  }) => patentResponse({
    municipalityCut: params.municipalityCut,
    licenseId: params.sourceLicenseId,
    releaseId: params.releaseId ?? 'missing-release',
  }));
  const getPatentTimeline = vi.fn(async (params: {
    municipalityCut: string;
    sourceLicenseId: string;
    releaseId?: string;
  }) => timelineResponse({
    municipalityCut: params.municipalityCut,
    licenseId: params.sourceLicenseId,
    releaseId: params.releaseId ?? 'missing-release',
  }));
  const client = {
    getPatent,
    getPatentTimeline,
    searchPatents: vi.fn(),
    getPatentCoverage: vi.fn(),
    resolveEstablishment: vi.fn(),
  } as unknown as CommercialLicensesClient;
  return { client, getPatent, getPatentTimeline };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      keys.add(key.toLowerCase());
      collectKeys(item, keys);
    });
  }
  return keys;
}

describe('historical provisional-license cohort', () => {
  test('pins exactly 20 source cases without personal holder fields', async () => {
    const cohort = await fixture();
    const municipalityCounts = Object.groupBy(
      cohort.cases,
      (item) => item.municipality_cut,
    );

    expect(cohort.cases).toHaveLength(20);
    expect(municipalityCounts['10303']).toHaveLength(10);
    expect(municipalityCounts['13115']).toHaveLength(5);
    expect(municipalityCounts['13128']).toHaveLength(5);
    expect(collectKeys(cohort)).not.toContain('holder');
    expect(collectKeys(cohort)).not.toContain('holders');
    expect(collectKeys(cohort)).not.toContain('rut');
    expect(collectKeys(cohort)).not.toContain('address');
  });

  test('classifies unresolved parcel matches as insufficient evidence without persisting cases', async () => {
    const cohort = await fixture();
    const { client, getPatent, getPatentTimeline } = fakeClient();
    const report = await evaluateHistoricalPatentCohort({
      cohort,
      client,
      builderVersion: 'historical-cohort-test',
    });

    expect(report.persisted_review_cases).toBe(0);
    expect(report.counts).toEqual({
      total: 20,
      reproduced: 0,
      insufficient_evidence: 20,
      failed: 0,
    });
    expect(report.gate).toEqual({ minimum_reproduced: 16, passed: false });
    expect(report.results.every((item) => item.gap_codes.includes('unresolved_match'))).toBe(true);
    expect(report.results.every((item) => item.packet_content_sha256?.length === 64)).toBe(true);
    expect(getPatent).toHaveBeenCalledTimes(20);
    expect(getPatentTimeline).toHaveBeenCalledTimes(20);
  });

  test('keeps expectation drift separate from insufficient evidence', async () => {
    const cohort = await fixture();
    const changed = parseHistoricalPatentCohort({
      ...cohort,
      cases: cohort.cases.map((item, index) => index === 0
        ? { ...item, expected_parcel_match_status: 'resolved' }
        : item),
    });
    const { client } = fakeClient();
    const report = await evaluateHistoricalPatentCohort({
      cohort: changed,
      client,
      builderVersion: 'historical-cohort-test',
    });

    expect(report.counts).toEqual({
      total: 20,
      reproduced: 0,
      insufficient_evidence: 19,
      failed: 1,
    });
    expect(report.results[0]).toMatchObject({
      outcome: 'failed',
      error_kind: 'expectation_mismatch',
      expectation_mismatches: ['parcel_match_status'],
      packet_id: null,
    });
  });
});
