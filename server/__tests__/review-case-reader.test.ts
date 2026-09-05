// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';

import { hashEvidencePacketContent } from '../_shared/evidence-packet-canonical';
import {
  createReviewCaseReader,
  type EvidencePacketLookup,
  type ReviewCaseAuthorizationRequest,
  type ReviewCaseLookup,
  type ReviewCaseReadPort,
  ReviewCaseReaderError,
} from '../_shared/review-case-reader';

const HASH = 'a'.repeat(64);
const RELEASE_ID = 'commercial-licenses-2026-08-28-001';
const PACKET_ID = 'packet-001';
const GENERATED_AT = '2026-08-28T16:00:00Z';

function packet(): Record<string, any> {
  return {
    packet_id: PACKET_ID,
    schema_version: '0.1.0',
    generated_at: GENERATED_AT,
    case_id: 'case-001',
    municipality_cut: '13101',
    classification: ['MUNICIPAL_INTERNAL', 'ACTIVE_REVIEW'],
    pinned_releases: [{
      producer: 'inteligencia-inmobiliaria',
      product: 'commercial-licenses',
      capability: 'patents.get',
      capability_version: '0.1.0',
      release_id: RELEASE_ID,
      schema_version: '0.1.0',
      data_as_of: '2026-08-28T12:00:00Z',
      promoted_at: '2026-08-28T13:00:00Z',
      quality_status: 'promoted',
      availability: 'current',
      data_marking: 'LICENSED',
      last_good_release_id: null,
      quality_report_uri: 'quality/report.json',
      queried_at: '2026-08-28T15:59:00Z',
      response_sha256: HASH,
      limitation_ids: ['gap-001'],
    }],
    license: {
      license_id: 'license-001',
      source_license_id: 'license-001',
      municipality_cut: '13101',
      license_type: 'commercial',
      reported_status: 'vigente',
      provisional_status: 'definitive',
      address: { original: 'Synthetic address', municipality_cut: '13101' },
      activities: ['retail'],
      observed_at: '2026-08-28T12:00:00Z',
      source_refs: ['source-001'],
    },
    timeline: [],
    establishments: [],
    parcel_resolutions: [],
    holders: [],
    requirements: [],
    evidence: [{
      evidence_id: 'evidence-001',
      artifact_type: 'api_response',
      title: 'Synthetic response',
      captured_at: '2026-08-28T15:59:00Z',
      integrity: { sha256: HASH },
      source_refs: ['source-001'],
      supports: [],
      classification: ['AUTHORITY_ONLY'],
    }],
    source_refs: [{
      source_ref: 'source-001',
      producer: 'inteligencia-inmobiliaria',
      product: 'commercial-licenses',
      release_id: RELEASE_ID,
      source_kind: 'capability_response',
      municipality_cut: '13101',
      observed_at: '2026-08-28T12:00:00Z',
    }],
    gaps: [{
      gap_id: 'gap-001',
      code: 'incomplete_timeline',
      description: 'Synthetic gap',
      affected_objects: ['license-001'],
      consequence: 'Timeline cannot be established',
      status: 'open',
      detected_at: GENERATED_AT,
      source_refs: ['source-001'],
    }],
    conflicts: [],
    alternative_explanations: [],
    legal_authorities: [],
    permitted_next_actions: [{
      action_id: 'action-review',
      action_type: 'AssignReviewer',
      permitted: true,
      authorized_roles: ['coordinator'],
      reason: 'Case is open',
      legal_effect: 'none',
      evaluated_at: GENERATED_AT,
    }],
    recommended_next_action_id: 'action-review',
    reproducibility: {
      builder: 'chile-monitor',
      builder_version: '0.1.0',
      input_queries: [{
        producer: 'inteligencia-inmobiliaria',
        capability: 'patents.get',
        release_id: RELEASE_ID,
        request_sha256: HASH,
        response_sha256: HASH,
      }],
      packet_content_sha256: HASH,
    },
  };
}

async function rehash(value: Record<string, any>): Promise<void> {
  value.reproducibility.packet_content_sha256 = await hashEvidencePacketContent(value);
}

async function storedFixture(options: { updatedAt?: string; staleRelease?: boolean } = {}) {
  const evidencePacket = packet();
  if (options.staleRelease) {
    evidencePacket.pinned_releases[0].availability = 'stale_last_good';
    evidencePacket.pinned_releases[0].last_good_release_id = RELEASE_ID;
  }
  await rehash(evidencePacket);
  const snapshot = {
    schema_version: '0.1.0',
    case_id: 'case-001',
    case_version: 7,
    municipality_cut: '13101',
    license_id: 'license-001',
    status: 'in_review',
    classification: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
    created_at: '2026-08-28T15:00:00Z',
    updated_at: options.updatedAt ?? GENERATED_AT,
    packet_ref: {
      packet_id: PACKET_ID,
      packet_content_sha256: evidencePacket.reproducibility.packet_content_sha256,
      packet_schema_version: '0.1.0',
      packet_generated_at: GENERATED_AT,
      primary_release_id: RELEASE_ID,
      required_markings: [
        'ACTIVE_REVIEW',
        'AUTHORITY_ONLY',
        'LICENSED',
        'MUNICIPAL_INTERNAL',
      ],
    },
  };
  return { evidencePacket, snapshot, packetJson: JSON.stringify(evidencePacket) };
}

async function harness(options: {
  authorize?: (request: ReviewCaseAuthorizationRequest) => boolean | Promise<boolean>;
  updatedAt?: string;
  staleRelease?: boolean;
  maxEvidencePacketBytes?: number;
} = {}) {
  const fixture = await storedFixture(options);
  const readCaseSnapshot = vi.fn(async () => fixture.snapshot as unknown);
  const readEvidencePacket = vi.fn(async () => fixture.packetJson as string | null);
  const authorize = vi.fn(options.authorize ?? (() => true));
  const readPort: ReviewCaseReadPort = { readCaseSnapshot, readEvidencePacket };
  const reader = createReviewCaseReader({
    readPort,
    authorize,
    maxEvidencePacketBytes: options.maxEvidencePacketBytes,
  });
  return { ...fixture, reader, readCaseSnapshot, readEvidencePacket, authorize };
}

function pathsForKey(value: unknown, wanted: string, path: string[] = []): string[][] {
  if (typeof value !== 'object' || value === null) return [];
  const paths: string[][] = [];
  for (const [key, nested] of Object.entries(value)) {
    const next = [...path, key];
    if (key === wanted) paths.push(next);
    paths.push(...pathsForKey(nested, wanted, next));
  }
  return paths;
}

describe('ReviewCase reader', () => {
  test('loads the exact version and packet tuple, then projects a deterministic dossier', async () => {
    const subject = await harness();

    const dossier = await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });

    expect(subject.readCaseSnapshot).toHaveBeenCalledWith({ caseId: 'case-001', caseVersion: 7 });
    expect(subject.readEvidencePacket).toHaveBeenCalledWith({
      municipalityCut: '13101',
      caseId: 'case-001',
      caseVersion: 7,
      packetId: PACKET_ID,
      expectedSha256: subject.snapshot.packet_ref.packet_content_sha256,
      primaryReleaseId: RELEASE_ID,
      maxBytes: 2 * 1024 * 1024,
    } satisfies EvidencePacketLookup);
    expect(subject.authorize).toHaveBeenNthCalledWith(1, {
      caseId: 'case-001',
      caseVersion: 7,
      municipalityCut: '13101',
      requiredMarkings: ['ACTIVE_REVIEW', 'AUTHORITY_ONLY', 'LICENSED', 'MUNICIPAL_INTERNAL'],
      phase: 'snapshot',
    });
    expect(subject.authorize).toHaveBeenNthCalledWith(2, {
      caseId: 'case-001',
      caseVersion: 7,
      municipalityCut: '13101',
      requiredMarkings: ['ACTIVE_REVIEW', 'AUTHORITY_ONLY', 'LICENSED', 'MUNICIPAL_INTERNAL'],
      phase: 'packet',
    });
    expect(dossier.assessment).toMatchObject({
      gap_ids: ['gap-001'],
      conflict_ids: [],
      has_stale_release: false,
      action_snapshot_stale: false,
      historical_recommended_action_id: 'action-review',
      historical_action_evaluations: [{
        action_id: 'action-review',
        packet_reported_permitted: true,
        executable: false,
      }],
    });

    const second = await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });
    expect(second).toEqual(dossier);
  });

  test('namespaces raw action fields only inside a historical non-executable packet snapshot', async () => {
    const subject = await harness();

    const dossier = await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });
    const record = dossier as unknown as Record<string, unknown>;

    expect(record).not.toHaveProperty('evidence_packet');
    expect(dossier.evidence_packet_snapshot.nature).toBe('historical_non_executable');
    for (const key of ['permitted_next_actions', 'permitted', 'authorized_roles', 'legal_effect']) {
      const paths = pathsForKey(dossier, key);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((path) => (
        path[0] === 'evidence_packet_snapshot' && path[1] === 'packet'
      ))).toBe(true);
    }
  });

  test('a matching actor changes neither the projection nor executes an action callback', async () => {
    const executeAction = vi.fn();
    const authorizedMarkings = new Set([
      'ACTIVE_REVIEW',
      'AUTHORITY_ONLY',
      'LICENSED',
      'MUNICIPAL_INTERNAL',
    ]);
    const authorizeForActor = (_actorId: string) => (request: ReviewCaseAuthorizationRequest) =>
      request.municipalityCut === '13101'
      && request.requiredMarkings.every((marking) => authorizedMarkings.has(marking));
    const first = await harness({ authorize: authorizeForActor('actor-coordinator') });
    const second = await harness({ authorize: authorizeForActor('actor-reviewer') });

    const firstDossier = await first.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });
    const secondDossier = await second.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });

    expect(firstDossier).toEqual(secondDossier);
    expect(Object.keys(first.reader)).toEqual(['getReviewCaseDossier']);
    expect(executeAction).not.toHaveBeenCalled();
  });

  test('makes absent and snapshot-denied cases indistinguishable and never loads their packet', async () => {
    const absent = await harness();
    absent.readCaseSnapshot.mockResolvedValueOnce(null);
    const denied = await harness({ authorize: () => false });

    const errors: unknown[] = [];
    for (const reader of [absent.reader, denied.reader]) {
      try {
        await reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });
      } catch (error) {
        errors.push(error);
      }
    }

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ kind: 'not_found_or_denied' });
    expect(errors[1]).toMatchObject({ kind: 'not_found_or_denied' });
    expect(String(errors[0])).toBe(String(errors[1]));
    expect(absent.readEvidencePacket).not.toHaveBeenCalled();
    expect(denied.readEvidencePacket).not.toHaveBeenCalled();
  });

  test('enforces municipality and required-marking fences before the packet read', async () => {
    const insufficientMarkings = await harness({
      authorize: (request) => !request.requiredMarkings.includes('AUTHORITY_ONLY'),
    });
    const wrongMunicipality = await harness({
      authorize: (request) => request.municipalityCut === '13102',
    });

    for (const subject of [insufficientMarkings, wrongMunicipality]) {
      await expect(
        subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
      ).rejects.toMatchObject({ kind: 'not_found_or_denied' });
      expect(subject.readEvidencePacket).not.toHaveBeenCalled();
    }
  });

  test('fails closed when effective packet markings exceed the snapshot authorization', async () => {
    const subject = await harness({ authorize: (request) => request.phase === 'snapshot' });

    await expect(
      subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'not_found_or_denied' });
    expect(subject.readEvidencePacket).toHaveBeenCalledTimes(1);
  });

  test('checks the byte cap before JSON parsing or packet authorization', async () => {
    const subject = await harness({ maxEvidencePacketBytes: 32 });
    subject.readEvidencePacket.mockResolvedValueOnce('{'.padEnd(33, 'x'));

    await expect(
      subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'packet_too_large' });
    expect(subject.authorize).toHaveBeenCalledTimes(1);
  });

  test('rejects tampering, malformed JSON and mismatched atomic snapshots', async () => {
    const tampered = await harness();
    const changed = JSON.parse(tampered.packetJson) as Record<string, any>;
    changed.license.reported_status = 'tampered';
    tampered.readEvidencePacket.mockResolvedValueOnce(JSON.stringify(changed));

    await expect(
      tampered.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'integrity_failure' });

    const malformed = await harness();
    malformed.readEvidencePacket.mockResolvedValueOnce('{invalid');
    await expect(
      malformed.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'integrity_failure' });

    const wrongVersion = await harness();
    wrongVersion.snapshot.case_version = 8;
    await expect(
      wrongVersion.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'not_found_or_denied' });
  });

  test('checks case, municipality, license, classification and packet reference exactly', async () => {
    const mutations = [
      (value: Record<string, any>) => { value.case_id = 'other-case'; },
      (value: Record<string, any>) => { value.municipality_cut = '13102'; },
      (value: Record<string, any>) => { value.license.license_id = 'other-license'; },
      (value: Record<string, any>) => { value.classification = ['MUNICIPAL_INTERNAL']; },
      (value: Record<string, any>) => { value.generated_at = '2026-08-28T16:01:00Z'; },
      (value: Record<string, any>) => {
        value.pinned_releases[0].release_id = 'other-release';
        value.reproducibility.input_queries[0].release_id = 'other-release';
      },
      (value: Record<string, any>) => {
        value.pinned_releases[0].product = 'other-product';
      },
    ];

    for (const mutate of mutations) {
      const subject = await harness();
      mutate(subject.evidencePacket);
      await rehash(subject.evidencePacket);
      subject.snapshot.packet_ref.packet_content_sha256 =
        subject.evidencePacket.reproducibility.packet_content_sha256;
      subject.readEvidencePacket.mockResolvedValueOnce(JSON.stringify(subject.evidencePacket));

      await expect(
        subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
      ).rejects.toMatchObject({ kind: 'integrity_failure' });
    }
  });

  test('keeps stale releases and historical action freshness visible without executable permission', async () => {
    const subject = await harness({
      staleRelease: true,
      updatedAt: '2026-08-28T17:00:00Z',
    });

    const dossier = await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });

    expect(dossier.assessment.has_stale_release).toBe(true);
    expect(dossier.assessment.action_snapshot_stale).toBe(true);
    expect(dossier.assessment.historical_action_evaluations[0]).toMatchObject({
      packet_reported_permitted: true,
      executable: false,
    });
    expect(dossier.evidence_packet_snapshot.packet.pinned_releases[0]?.availability).toBe(
      'stale_last_good',
    );
  });

  test('sanitizes storage failures without retaining sensitive causes', async () => {
    const secret = 'RUT-ADDRESS-AND-STORAGE-DETAIL';
    const subject = await harness();
    subject.readCaseSnapshot.mockRejectedValueOnce(new Error(secret));

    let caught: unknown;
    try {
      await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ReviewCaseReaderError);
    expect(caught).toMatchObject({ kind: 'storage_unavailable' });
    expect(String(caught)).not.toContain(secret);
    expect(JSON.stringify(caught)).not.toContain(secret);

    const packetFailure = await harness();
    packetFailure.readEvidencePacket.mockRejectedValueOnce(new Error(secret));
    await expect(
      packetFailure.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'storage_unavailable' });

    const authorizationFailure = await harness({
      authorize: () => {
        throw new Error(secret);
      },
    });
    let authorizationError: unknown;
    try {
      await authorizationFailure.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });
    } catch (error) {
      authorizationError = error;
    }
    expect(authorizationError).toMatchObject({ kind: 'not_found_or_denied' });
    expect(String(authorizationError)).not.toContain(secret);
    expect(authorizationFailure.readEvidencePacket).not.toHaveBeenCalled();
  });

  test('cannot drift to a changed current pointer because every lookup is versioned', async () => {
    const subject = await harness();
    let currentVersion = 8;
    subject.readCaseSnapshot.mockImplementation(async (lookup: ReviewCaseLookup) => {
      expect(currentVersion).toBe(9);
      return lookup.caseVersion === 7 ? subject.snapshot : null;
    });
    subject.readEvidencePacket.mockImplementation(async (lookup: EvidencePacketLookup) => {
      expect(currentVersion).toBe(9);
      expect(lookup).toMatchObject({
        caseId: 'case-001',
        caseVersion: 7,
        packetId: PACKET_ID,
        expectedSha256: subject.snapshot.packet_ref.packet_content_sha256,
      });
      return subject.packetJson;
    });

    currentVersion = 9;
    const dossier = await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });

    expect(dossier.case.case_version).toBe(7);
    expect(subject.readEvidencePacket.mock.calls[0]?.[0]).toMatchObject({ caseVersion: 7 });
  });

  test('sorts projected identifiers by deterministic code-point order', async () => {
    const subject = await harness();
    subject.evidencePacket.permitted_next_actions = [
      ...subject.evidencePacket.permitted_next_actions,
      ...['Zulu', 'ábaco', 'Alpha', 'alpha'].map((actionId) => ({
        action_id: actionId,
        action_type: 'AssignReviewer',
        permitted: false,
        authorized_roles: ['coordinator'],
        reason: 'Historical synthetic evaluation',
        legal_effect: 'none',
        evaluated_at: GENERATED_AT,
      })),
    ];
    await rehash(subject.evidencePacket);
    subject.snapshot.packet_ref.packet_content_sha256 =
      subject.evidencePacket.reproducibility.packet_content_sha256;
    subject.readEvidencePacket.mockResolvedValueOnce(JSON.stringify(subject.evidencePacket));

    const dossier = await subject.reader.getReviewCaseDossier({ caseId: 'case-001', caseVersion: 7 });

    expect(dossier.assessment.historical_action_evaluations.map((action) => action.action_id)).toEqual([
      'Alpha',
      'Zulu',
      'action-review',
      'alpha',
      'ábaco',
    ]);
  });

  test('rejects invalid lookups and size configuration before reading storage', async () => {
    const subject = await harness();
    await expect(
      subject.reader.getReviewCaseDossier({ caseId: '', caseVersion: 0 }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(
      subject.reader.getReviewCaseDossier({ caseId: 'case id\nsecret', caseVersion: 7 }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(subject.readCaseSnapshot).not.toHaveBeenCalled();

    expect(() => createReviewCaseReader({
      readPort: {
        readCaseSnapshot: async () => null,
        readEvidencePacket: async () => null,
      },
      authorize: () => false,
      maxEvidencePacketBytes: 0,
    })).toThrowError(expect.objectContaining({ kind: 'invalid_request' }));
  });
});
