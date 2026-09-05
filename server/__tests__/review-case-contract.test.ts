// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { parseEvidencePacket } from '../_shared/evidence-packet-contract';
import {
  parseReviewCaseDossier,
  parseReviewCaseSnapshot,
  ReviewCaseContractError,
} from '../_shared/review-case-contract';

const HASH = 'a'.repeat(64);
const SOURCE_REF = 'source-001';
const EVALUATED_AT = '2026-08-28T16:00:00Z';

function evidencePacket(): Record<string, any> {
  return {
    packet_id: 'packet-001', schema_version: '0.1.0', generated_at: EVALUATED_AT,
    case_id: 'case-001', municipality_cut: '13101', classification: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
    pinned_releases: [{
      producer: 'inteligencia-inmobiliaria', product: 'commercial-licenses', capability: 'patents.get',
      capability_version: '0.1', release_id: 'release-001', schema_version: '0.1.0',
      data_as_of: '2026-08-28T12:00:00Z', promoted_at: '2026-08-28T13:00:00Z',
      quality_status: 'promoted', availability: 'current', data_marking: 'MUNICIPAL_INTERNAL',
      last_good_release_id: null, quality_report_uri: 'quality/report.json', queried_at: EVALUATED_AT,
    }],
    license: {
      license_id: 'license-001', source_license_id: 'license-001', municipality_cut: '13101',
      license_type: 'commercial', reported_status: 'vigente', provisional_status: 'definitive',
      address: { original: 'Synthetic address', municipality_cut: '13101' }, observed_at: EVALUATED_AT,
      source_refs: [SOURCE_REF],
    },
    timeline: [], establishments: [], parcel_resolutions: [], holders: [], requirements: [], evidence: [],
    source_refs: [{
      source_ref: SOURCE_REF, producer: 'inteligencia-inmobiliaria', product: 'commercial-licenses',
      release_id: 'release-001', source_kind: 'capability_response', municipality_cut: '13101',
      observed_at: EVALUATED_AT,
    }],
    gaps: [{
      gap_id: 'gap-001', code: 'coverage_gap', description: 'Synthetic gap', affected_objects: ['license-001'],
      consequence: 'Review remains limited', status: 'open', detected_at: EVALUATED_AT, source_refs: [SOURCE_REF],
    }],
    conflicts: [], alternative_explanations: [], legal_authorities: [],
    permitted_next_actions: [{
      action_id: 'action-001', action_type: 'AssignReviewer', permitted: true,
      authorized_roles: ['coordinator'], reason: 'Synthetic reason', legal_effect: 'none', evaluated_at: EVALUATED_AT,
    }],
    recommended_next_action_id: 'action-001',
    reproducibility: {
      builder: 'chile-monitor', builder_version: '0.1.0',
      input_queries: [{ producer: 'inteligencia-inmobiliaria', capability: 'patents.get', release_id: 'release-001', request_sha256: HASH, response_sha256: HASH }],
      packet_content_sha256: HASH,
    },
  };
}

function snapshot(): Record<string, any> {
  return {
    schema_version: '0.1.0', case_id: 'case-001', case_version: 1, municipality_cut: '13101',
    license_id: 'license-001', status: 'in_review',
    classification: ['MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW'],
    created_at: '2026-08-28T15:00:00Z', updated_at: EVALUATED_AT,
    packet_ref: {
      packet_id: 'packet-001', packet_content_sha256: HASH, packet_schema_version: '0.1.0',
      packet_generated_at: EVALUATED_AT, primary_release_id: 'release-001',
      required_markings: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
    },
  };
}

function dossier(): Record<string, any> {
  return {
    schema_version: '0.1.0', case: snapshot(),
    evidence_packet_snapshot: { nature: 'historical_non_executable', packet: evidencePacket() },
    assessment: {
      gap_ids: ['gap-001'], conflict_ids: [], has_stale_release: false,
      action_snapshot_stale: false,
      historical_action_evaluations: [{
        action_id: 'action-001', action_type: 'AssignReviewer', evaluated_at: EVALUATED_AT,
        packet_reported_permitted: true, executable: false,
      }],
      historical_recommended_action_id: 'action-001',
    },
  };
}

function expectFailure(value: unknown, path?: string): void {
  try {
    parseReviewCaseDossier(value);
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewCaseContractError);
    if (path) expect((error as ReviewCaseContractError).path).toContain(path);
  }
}

describe('ReviewCase runtime contract', () => {
  test('parses a closed snapshot and complete dossier', () => {
    expect(parseReviewCaseSnapshot(snapshot()).case_version).toBe(1);
    const parsed = parseReviewCaseDossier(dossier());
    expect(parsed.assessment.historical_action_evaluations[0]).toMatchObject({
      packet_reported_permitted: true, executable: false,
    });
    expect(parseEvidencePacket(parsed.evidence_packet_snapshot.packet).packet_id).toBe('packet-001');
  });

  test('accepts an assignment within the snapshot lifetime and rejects impossible dates', () => {
    const assigned = snapshot();
    assigned.case_version = 2;
    assigned.assignment = {
      reviewer_id: 'reviewer-001',
      assigned_by: 'coordinator-001',
      assigned_at: '2026-08-28T15:30:00Z',
    };
    expect(parseReviewCaseSnapshot(assigned).assignment?.reviewer_id).toBe('reviewer-001');

    assigned.assignment.assigned_at = '2026-08-28T16:30:00Z';
    expect(() => parseReviewCaseSnapshot(assigned)).toThrow(ReviewCaseContractError);
  });

  test('rejects a direct top-level packet or an unlabeled snapshot', () => {
    const direct = dossier();
    direct.evidence_packet = direct.evidence_packet_snapshot.packet;
    delete direct.evidence_packet_snapshot;
    expectFailure(direct);

    const missingNature = dossier();
    delete missingNature.evidence_packet_snapshot.nature;
    expectFailure(missingNature, 'nature');

    const executable = dossier();
    executable.evidence_packet_snapshot.nature = 'current_executable';
    expectFailure(executable, 'nature');
  });

  test('rejects additional properties and missing required fields', () => {
    const additional = dossier();
    additional.case.actor_role = 'admin';
    expectFailure(additional, 'case');
    const missing = dossier();
    delete missing.case.packet_ref;
    expectFailure(missing, 'packet_ref');
  });

  test('validates version, CUT, timestamps, hash, markings, and status', () => {
    const mutations = [
      (value: Record<string, any>) => { value.case.case_version = 0; },
      (value: Record<string, any>) => { value.case.municipality_cut = '1310'; },
      (value: Record<string, any>) => { value.case.updated_at = '2026-02-30T12:00:00Z'; },
      (value: Record<string, any>) => { value.case.packet_ref.packet_content_sha256 = 'abc'; },
      (value: Record<string, any>) => { value.case.classification = ['UNKNOWN']; },
      (value: Record<string, any>) => { value.case.status = 'assigned'; },
    ];
    for (const mutate of mutations) {
      const value = dossier();
      mutate(value);
      expectFailure(value);
    }
  });

  test('requires case and packet identity to match exactly', () => {
    const mutations: Array<[string, (value: Record<string, any>) => void]> = [
      ['case_id', (value) => { value.case.case_id = 'case-other'; }],
      ['municipality_cut', (value) => { value.case.municipality_cut = '13102'; }],
      ['license_id', (value) => { value.case.license_id = 'license-other'; }],
      ['packet_id', (value) => { value.case.packet_ref.packet_id = 'packet-other'; }],
      ['packet_schema_version', (value) => { value.case.packet_ref.packet_schema_version = '0.2.0'; }],
      ['packet_generated_at', (value) => { value.case.packet_ref.packet_generated_at = '2026-08-28T15:00:00Z'; }],
      ['packet_content_sha256', (value) => { value.case.packet_ref.packet_content_sha256 = 'b'.repeat(64); }],
      ['primary_release_id', (value) => { value.case.packet_ref.primary_release_id = 'release-other'; }],
      ['primary_release_id', (value) => { value.evidence_packet_snapshot.packet.pinned_releases[0].product = 'other-product'; }],
    ];
    for (const [path, mutate] of mutations) {
      const value = dossier();
      mutate(value);
      expectFailure(value, path);
    }
  });

  test('compares classification as a set rather than by order', () => {
    const value = dossier();
    value.case.classification.reverse();
    expect(parseReviewCaseDossier(value).case.classification).toEqual(['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL']);

    value.case.classification = ['ACTIVE_REVIEW'];
    expectFailure(value, 'classification');
  });

  test('requires an exact receipt of nested and pinned markings', () => {
    const nested = dossier();
    nested.evidence_packet_snapshot.packet.evidence.push({
      evidence_id: 'evidence-001', artifact_type: 'document', title: 'Restricted synthetic artifact',
      captured_at: EVALUATED_AT, integrity: { sha256: HASH }, source_refs: [SOURCE_REF],
      classification: ['AUTHORITY_ONLY'],
    });
    nested.case.packet_ref.required_markings.push('AUTHORITY_ONLY');
    expect(parseReviewCaseDossier(nested).case.packet_ref.required_markings).toContain('AUTHORITY_ONLY');

    const missingNestedMarking = dossier();
    missingNestedMarking.evidence_packet_snapshot.packet.evidence.push({
      evidence_id: 'evidence-001', artifact_type: 'document', title: 'Restricted synthetic artifact',
      captured_at: EVALUATED_AT, integrity: { sha256: HASH }, source_refs: [SOURCE_REF],
      classification: ['AUTHORITY_ONLY'],
    });
    expectFailure(missingNestedMarking, 'required_markings');

    const extraMarking = dossier();
    extraMarking.case.packet_ref.required_markings.push('LICENSED');
    expectFailure(extraMarking, 'required_markings');
  });

  test('requires assessment to be an exact non-legal projection', () => {
    const mutations: Array<[string, (value: Record<string, any>) => void]> = [
      ['gap_ids', (value) => { value.assessment.gap_ids = []; }],
      ['conflict_ids', (value) => { value.assessment.conflict_ids = ['conflict-other']; }],
      ['has_stale_release', (value) => { value.assessment.has_stale_release = true; }],
      ['action_snapshot_stale', (value) => { value.assessment.action_snapshot_stale = true; }],
      ['historical_action_evaluations', (value) => { value.assessment.historical_action_evaluations = []; }],
      ['historical_action_evaluations', (value) => { value.assessment.historical_action_evaluations[0].packet_reported_permitted = false; }],
      ['executable', (value) => { value.assessment.historical_action_evaluations[0].executable = true; }],
      ['historical_recommended_action_id', (value) => { value.assessment.historical_recommended_action_id = null; }],
    ];
    for (const [path, mutate] of mutations) {
      const value = dossier();
      mutate(value);
      expectFailure(value, path);
    }
  });

  test('preserves stale and conflicted states without drawing conclusions', () => {
    const value = dossier();
    value.evidence_packet_snapshot.packet.pinned_releases[0].availability = 'stale_last_good';
    value.evidence_packet_snapshot.packet.pinned_releases[0].last_good_release_id = 'release-previous';
    value.evidence_packet_snapshot.packet.conflicts = [{
      conflict_id: 'conflict-001', description: 'Synthetic conflict',
      assertions: [
        { value: 'one', source_refs: [SOURCE_REF] },
        { value: 'two', source_refs: [SOURCE_REF] },
      ],
      status: 'open', detected_at: EVALUATED_AT,
    }];
    value.assessment.has_stale_release = true;
    value.assessment.conflict_ids = ['conflict-001'];
    expect(parseReviewCaseDossier(value).assessment).toMatchObject({
      has_stale_release: true, conflict_ids: ['conflict-001'],
    });
  });

  test('errors never echo rejected identifiers or evidence', () => {
    const value = dossier();
    const sensitive = '76543210-K-Synthetic-address';
    value.case.case_id = sensitive;
    try {
      parseReviewCaseDossier(value);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewCaseContractError);
      expect((error as Error).message).not.toContain(sensitive);
      expect((error as Error).message).not.toContain('Synthetic address');
    }
  });
});
