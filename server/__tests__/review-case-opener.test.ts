// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';

import type { EvidencePacketBuilder } from '../_shared/evidence-packet-builder';
import { EvidencePacketBuilderError } from '../_shared/evidence-packet-builder';
import { CommercialLicensesClientError } from '../_shared/commercial-licenses-client';
import { hashEvidencePacketContent } from '../_shared/evidence-packet-canonical';
import { parseEvidencePacket, type EvidencePacket } from '../_shared/evidence-packet-contract';
import {
  createReviewCaseOpener,
  type CommitOpenLicenseReviewRequest,
  type CommitOpenLicenseReviewResult,
  type OpenLicenseReviewAuthority,
  type OpenLicenseReviewCommand,
  type OpenLicenseReviewReceipt,
  type OpenLicenseReviewWritePort,
  ReviewCaseOpenerError,
} from '../_shared/review-case-opener';

const NOW = '2026-08-29T12:00:00.000Z';
const RELEASE_ID = 'commercial-licenses-2026-08-29-001';
const HASH = 'a'.repeat(64);

const command: OpenLicenseReviewCommand = {
  operationKey: 'open-review-request-001',
  municipalityCut: '13101',
  licenseId: 'license-001',
  releaseId: RELEASE_ID,
  effectiveOn: '2026-08-29',
  representation: 'municipal_restricted',
};

function authority(overrides: Partial<OpenLicenseReviewAuthority> = {}): OpenLicenseReviewAuthority {
  return {
    authority_id: 'authority-001',
    authority_version: 3,
    actor_id: 'actor-001',
    municipality_cut: '13101',
    roles: ['rentas'],
    permitted_actions: ['OpenLicenseReview'],
    allowed_markings: ['ACTIVE_REVIEW', 'LICENSED', 'MUNICIPAL_INTERNAL'],
    allowed_representations: ['public', 'municipal_restricted'],
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    revoked_at: null,
    ...overrides,
  };
}

function packet(caseId = 'case-001', releaseId = RELEASE_ID): Record<string, any> {
  return {
    packet_id: 'packet-001',
    schema_version: '0.1.0',
    generated_at: NOW,
    case_id: caseId,
    municipality_cut: '13101',
    classification: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
    pinned_releases: [{
      producer: 'inteligencia-inmobiliaria',
      product: 'commercial-licenses',
      capability: 'patents.get',
      capability_version: '0.1.0',
      release_id: releaseId,
      schema_version: '0.1.0',
      data_as_of: '2026-08-29T10:00:00Z',
      promoted_at: '2026-08-29T11:00:00Z',
      quality_status: 'promoted',
      availability: 'current',
      data_marking: 'LICENSED',
      last_good_release_id: null,
      quality_report_uri: 'quality/report.json',
      queried_at: NOW,
      response_sha256: HASH,
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
      observed_at: '2026-08-29T10:00:00Z',
      source_refs: ['source-001'],
    },
    timeline: [],
    establishments: [],
    parcel_resolutions: [],
    holders: [],
    requirements: [],
    evidence: [],
    source_refs: [{
      source_ref: 'source-001',
      producer: 'inteligencia-inmobiliaria',
      product: 'commercial-licenses',
      release_id: releaseId,
      source_kind: 'capability_response',
      municipality_cut: '13101',
      observed_at: '2026-08-29T10:00:00Z',
    }],
    gaps: [],
    conflicts: [],
    alternative_explanations: [],
    legal_authorities: [],
    permitted_next_actions: [{
      action_id: 'assign-reviewer-policy',
      action_type: 'AssignReviewer',
      permitted: true,
      authorized_roles: ['coordinator'],
      reason: 'The newly opened case requires an owner',
      legal_effect: 'none',
      evaluated_at: NOW,
    }],
    recommended_next_action_id: 'assign-reviewer-policy',
    reproducibility: {
      builder: 'chile-monitor',
      builder_version: '0.1.0',
      input_queries: [{
        producer: 'inteligencia-inmobiliaria',
        capability: 'patents.get',
        release_id: releaseId,
        request_sha256: HASH,
        response_sha256: HASH,
      }],
      packet_content_sha256: HASH,
    },
  };
}

async function validPacket(caseId = 'case-001', releaseId = RELEASE_ID): Promise<EvidencePacket> {
  const value = packet(caseId, releaseId);
  value.reproducibility.packet_content_sha256 = await hashEvidencePacketContent(value);
  return parseEvidencePacket(value);
}

async function harness(options: {
  authority?: OpenLicenseReviewAuthority | null;
  packet?: EvidencePacket;
  builderError?: Error;
  policy?: unknown;
  commitResult?: unknown;
  commitError?: Error;
  operationResult?: unknown;
  operationError?: Error;
  maxEvidencePacketBytes?: number;
  now?: () => Date;
} = {}) {
  const evidencePacket = options.packet ?? await validPacket();
  const build = vi.fn(async () => {
    if (options.builderError) throw options.builderError;
    return evidencePacket;
  });
  const evidencePacketBuilder: EvidencePacketBuilder = { build };
  const resolveAuthority = vi.fn(async () => (
    options.authority === undefined ? authority() : options.authority
  ));
  const evaluatePolicy = vi.fn(async () => options.policy ?? ({
    permittedNextActions: evidencePacket.permitted_next_actions,
    recommendedNextActionId: evidencePacket.recommended_next_action_id,
  }));
  const readOpenLicenseReviewOperation = vi.fn(async (): Promise<any> => {
    if (options.operationError) throw options.operationError;
    return Object.hasOwn(options, 'operationResult')
      ? options.operationResult
      : { kind: 'miss' as const };
  });
  const commitOpenLicenseReview = vi.fn(async (
    _request: CommitOpenLicenseReviewRequest,
  ): Promise<any> => {
    if (options.commitError) throw options.commitError;
    return Object.hasOwn(options, 'commitResult')
      ? options.commitResult
      : { kind: 'committed' as const };
  });
  const writePort: OpenLicenseReviewWritePort = {
    readOpenLicenseReviewOperation,
    commitOpenLicenseReview,
  };
  const opener = createReviewCaseOpener({
    evidencePacketBuilder,
    resolveAuthority,
    evaluatePolicy,
    writePort,
    newCaseId: () => 'case-001',
    newActionId: () => 'action-open-001',
    now: options.now ?? (() => new Date(NOW)),
    maxEvidencePacketBytes: options.maxEvidencePacketBytes,
  });
  return {
    opener,
    build,
    resolveAuthority,
    evaluatePolicy,
    readOpenLicenseReviewOperation,
    commitOpenLicenseReview,
    evidencePacket,
  };
}

async function expectKind(promise: Promise<unknown>, kind: string): Promise<ReviewCaseOpenerError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewCaseOpenerError);
    expect((error as ReviewCaseOpenerError).kind).toBe(kind);
    return error as ReviewCaseOpenerError;
  }
  throw new Error('Expected ReviewCaseOpenerError');
}

describe('ReviewCase opener', () => {
  test('requests one atomic commit for case version 1 and a legally inert action', async () => {
    const subject = await harness();

    const receipt = await subject.opener.openLicenseReview(command);

    expect(subject.resolveAuthority).toHaveBeenCalledWith({
      action: 'OpenLicenseReview',
      municipalityCut: '13101',
    });
    expect(subject.evaluatePolicy).toHaveBeenCalledWith({
      action: 'OpenLicenseReview',
      municipalityCut: '13101',
      licenseId: 'license-001',
      actorId: 'actor-001',
      roles: ['rentas'],
      evaluatedAt: NOW,
    });
    expect(subject.readOpenLicenseReviewOperation).toHaveBeenCalledWith({
      operationKey: command.operationKey,
      commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      actorId: 'actor-001',
      municipalityCut: '13101',
    });
    expect(subject.build).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'case-001',
      municipalityCut: '13101',
      classification: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
      licenseId: 'license-001',
      releaseId: RELEASE_ID,
    }));
    expect(receipt).toMatchObject({
      schema_version: '0.1.0',
      replayed: false,
      case: {
        case_id: 'case-001',
        case_version: 1,
        status: 'open',
        packet_ref: {
          packet_id: 'packet-001',
          primary_release_id: RELEASE_ID,
          required_markings: ['ACTIVE_REVIEW', 'LICENSED', 'MUNICIPAL_INTERNAL'],
        },
      },
      action: {
        action_id: 'action-open-001',
        action_type: 'OpenLicenseReview',
        previous_case_version: 0,
        resulting_case_version: 1,
        actor_id: 'actor-001',
        authority_id: 'authority-001',
        authority_version: 3,
        legal_effect: 'none',
      },
    });
    expect(subject.commitOpenLicenseReview).toHaveBeenCalledTimes(1);
    const persisted = subject.commitOpenLicenseReview.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      operationKey: command.operationKey,
      activeCaseKey: '13101:license-001',
      expectedCaseVersion: 0,
      caseSnapshot: receipt.case,
      action: receipt.action,
      authorityFence: {
        authorityId: 'authority-001',
        authorityVersion: 3,
        actorId: 'actor-001',
        municipalityCut: '13101',
        action: 'OpenLicenseReview',
        requiredMarkings: ['ACTIVE_REVIEW', 'LICENSED', 'MUNICIPAL_INTERNAL'],
        representation: 'municipal_restricted',
        evaluatedAt: NOW,
      },
    });
    expect(persisted?.evidencePacketSnapshot).toMatchObject({
      nature: 'historical_non_executable',
      bytes: expect.any(Number),
    });
    expect(JSON.parse(persisted?.evidencePacketSnapshot.json ?? '{}'))
      .toEqual(subject.evidencePacket);
    expect(persisted?.commandSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects authority, roles and classification injected into the command', async () => {
    const subject = await harness();
    const injected = {
      ...command,
      actor_id: 'attacker',
      roles: ['control'],
      classification: ['PUBLIC'],
    } as unknown as OpenLicenseReviewCommand;

    await expectKind(subject.opener.openLicenseReview(injected), 'invalid_request');
    expect(subject.resolveAuthority).not.toHaveBeenCalled();
    expect(subject.build).not.toHaveBeenCalled();
  });

  test('authorizes before policy evaluation or upstream evidence access', async () => {
    const subject = await harness({ authority: null });

    const error = await expectKind(
      subject.opener.openLicenseReview(command),
      'not_found_or_denied',
    );

    expect(subject.evaluatePolicy).not.toHaveBeenCalled();
    expect(subject.build).not.toHaveBeenCalled();
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
    expect(error.message).not.toContain(command.licenseId);
  });

  test('authorizes the requested representation before upstream evidence access', async () => {
    const subject = await harness({
      authority: authority({ allowed_representations: ['public'] }),
    });

    await expectKind(subject.opener.openLicenseReview(command), 'not_found_or_denied');

    expect(subject.readOpenLicenseReviewOperation).not.toHaveBeenCalled();
    expect(subject.evaluatePolicy).not.toHaveBeenCalled();
    expect(subject.build).not.toHaveBeenCalled();
  });

  test.each([
    ['cross-municipality', authority({ municipality_cut: '10101' })],
    ['revoked', authority({ revoked_at: '2026-08-29T11:00:00Z' })],
    ['expired', authority({ valid_to: '2026-08-29T11:00:00Z' })],
  ])('fails closed for %s authority', async (_label, deniedAuthority) => {
    const subject = await harness({ authority: deniedAuthority });

    await expectKind(subject.opener.openLicenseReview(command), 'not_found_or_denied');
    expect(subject.build).not.toHaveBeenCalled();
  });

  test('requires authority for every effective packet marking', async () => {
    const subject = await harness({
      authority: authority({ allowed_markings: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'] }),
    });

    await expectKind(subject.opener.openLicenseReview(command), 'not_found_or_denied');
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test('rejects policy supplements that attempt to overwrite protected builder inputs', async () => {
    const subject = await harness({
      policy: {
        permittedNextActions: [{ action_id: 'safe' }],
        supplement: { caseId: 'attacker-case' },
      },
    });

    await expectKind(subject.opener.openLicenseReview(command), 'integrity_failure');
    expect(subject.build).not.toHaveBeenCalled();
  });

  test('recalculates packet hash and requires the exact primary release', async () => {
    const tampered = await validPacket();
    (tampered.license as { reported_status: string }).reported_status = 'altered-after-hash';
    const hashSubject = await harness({ packet: tampered });

    await expectKind(hashSubject.opener.openLicenseReview(command), 'integrity_failure');
    expect(hashSubject.commitOpenLicenseReview).not.toHaveBeenCalled();

    const otherRelease = await validPacket('case-001', 'other-release');
    const releaseSubject = await harness({ packet: otherRelease });
    await expectKind(releaseSubject.opener.openLicenseReview(command), 'integrity_failure');
    expect(releaseSubject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test('rejects more than one patents.get primary record even when the hash is valid', async () => {
    const duplicate = structuredClone(await validPacket()) as EvidencePacket;
    duplicate.pinned_releases.push({
      ...duplicate.pinned_releases[0],
      producer: 'other-producer',
      release_id: 'other-release',
    });
    duplicate.reproducibility.input_queries.push({
      ...duplicate.reproducibility.input_queries[0],
      producer: 'other-producer',
      release_id: 'other-release',
    });
    duplicate.reproducibility.packet_content_sha256 = await hashEvidencePacketContent(duplicate);
    const subject = await harness({ packet: duplicate });

    await expectKind(subject.opener.openLicenseReview(command), 'integrity_failure');
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test('enforces packet size before invoking persistence', async () => {
    const subject = await harness({ maxEvidencePacketBytes: 32 });

    await expectKind(subject.opener.openLicenseReview(command), 'packet_too_large');
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test('returns a validated replay without changing the legal effect', async () => {
    const first = await harness();
    const original = await first.opener.openLicenseReview(command);
    const replayedStored: OpenLicenseReviewReceipt = { ...original, replayed: false };
    const replay = await harness({
      operationResult: { kind: 'replayed', receipt: replayedStored },
    });

    const result = await replay.opener.openLicenseReview(command);

    expect(result).toEqual({ ...original, replayed: true });
    expect(result.action.legal_effect).toBe('none');
    expect(replay.evaluatePolicy).not.toHaveBeenCalled();
    expect(replay.build).not.toHaveBeenCalled();
    expect(replay.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test('rechecks current marking authority before returning a replay', async () => {
    const first = await harness();
    const original = await first.opener.openLicenseReview(command);
    const replay = await harness({
      authority: authority({ allowed_markings: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'] }),
      operationResult: { kind: 'replayed', receipt: original },
    });

    await expectKind(replay.opener.openLicenseReview(command), 'not_found_or_denied');
    expect(replay.evaluatePolicy).not.toHaveBeenCalled();
    expect(replay.build).not.toHaveBeenCalled();
  });

  test('rejects replay snapshots with downgraded base classification', async () => {
    const first = await harness();
    const original = await first.opener.openLicenseReview(command);
    const downgraded = {
      ...original,
      case: { ...original.case, classification: ['MUNICIPAL_INTERNAL'] },
    };
    const replay = await harness({
      operationResult: { kind: 'replayed', receipt: downgraded },
    });

    await expectKind(replay.opener.openLicenseReview(command), 'integrity_failure');
  });

  test('rejects replay receipts with extra or mismatched authoritative data', async () => {
    const first = await harness();
    const original = await first.opener.openLicenseReview(command);
    const extra = { ...original, serverSecret: 'must-not-pass' };
    const extraSubject = await harness({
      operationResult: { kind: 'replayed', receipt: extra },
    });
    await expectKind(extraSubject.opener.openLicenseReview(command), 'integrity_failure');

    const wrongActor = {
      ...original,
      action: { ...original.action, actor_id: 'actor-002' },
    };
    const actorSubject = await harness({
      operationResult: { kind: 'replayed', receipt: wrongActor },
    });
    await expectKind(actorSubject.opener.openLicenseReview(command), 'integrity_failure');

    const duplicateRole = {
      ...original,
      action: { ...original.action, actor_roles: ['rentas', 'rentas'] },
    };
    const roleSubject = await harness({
      operationResult: { kind: 'replayed', receipt: duplicateRole },
    });
    await expectKind(roleSubject.opener.openLicenseReview(command), 'integrity_failure');
  });

  test('normalizes omitted and explicit public representation to one idempotent command', async () => {
    const publicCommand = { ...command, representation: 'public' as const };
    const omittedCommand = { ...command };
    delete omittedCommand.representation;
    const first = await harness();
    const original = await first.opener.openLicenseReview(omittedCommand);
    const replay = await harness({
      operationResult: { kind: 'replayed', receipt: original },
    });

    const result = await replay.opener.openLicenseReview(publicCommand);

    expect(result.replayed).toBe(true);
    expect(first.readOpenLicenseReviewOperation.mock.calls[0]?.[0].commandSha256)
      .toBe(replay.readOpenLicenseReviewOperation.mock.calls[0]?.[0].commandSha256);
  });

  test('fails closed when the authoritative idempotency lookup is unavailable', async () => {
    const subject = await harness({ operationError: new Error('redis fail-open is forbidden') });

    await expectKind(subject.opener.openLicenseReview(command), 'storage_unavailable');

    expect(subject.evaluatePolicy).not.toHaveBeenCalled();
    expect(subject.build).not.toHaveBeenCalled();
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test('rejects a reused operation key before policy or upstream access', async () => {
    const subject = await harness({ operationResult: { kind: 'operation_conflict' } });

    await expectKind(subject.opener.openLicenseReview(command), 'idempotency_conflict');

    expect(subject.evaluatePolicy).not.toHaveBeenCalled();
    expect(subject.build).not.toHaveBeenCalled();
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test.each([
    ['operation_conflict', 'idempotency_conflict'],
    ['active_case_conflict', 'case_conflict'],
    ['cas_conflict', 'case_conflict'],
  ] as const)('maps %s without leaking command values', async (resultKind, errorKind) => {
    const subject = await harness({ commitResult: { kind: resultKind } });

    const error = await expectKind(subject.opener.openLicenseReview(command), errorKind);

    expect(error.message).not.toContain(command.licenseId);
    expect(error.message).not.toContain(command.releaseId);
  });

  test('maps transaction failure to a safe storage error', async () => {
    const subject = await harness({ commitError: new Error('Synthetic address and secret') });

    const error = await expectKind(subject.opener.openLicenseReview(command), 'storage_unavailable');

    expect(error.message).not.toContain('Synthetic address');
    expect(error.message).not.toContain('secret');
  });

  test.each([
    [new EvidencePacketBuilderError('invalid_packet', 'unsafe detail'), 'integrity_failure'],
    [new CommercialLicensesClientError('invalid_payload', 'unsafe detail'), 'integrity_failure'],
    [new CommercialLicensesClientError('timeout', 'unsafe detail'), 'upstream_unavailable'],
    [new CommercialLicensesClientError('http', 'unsafe detail', {
      status: 503, retryable: true,
    }), 'upstream_unavailable'],
    [new CommercialLicensesClientError('http', 'unsafe detail', {
      status: 404, retryable: false,
    }), 'integrity_failure'],
    [new TypeError('unsafe detail'), 'integrity_failure'],
  ] as const)('classifies typed builder failures safely', async (builderError, kind) => {
    const subject = await harness({ builderError });

    const error = await expectKind(subject.opener.openLicenseReview(command), kind);

    expect(error.message).not.toContain('unsafe detail');
    expect(subject.commitOpenLicenseReview).not.toHaveBeenCalled();
  });

  test.each([
    ['lookup', null],
    ['lookup', { kind: 'miss', extra: true }],
    ['commit', null],
    ['commit', { kind: 'committed', extra: true }],
  ] as const)('rejects malformed %s port results', async (port, result) => {
    const subject = await harness(port === 'lookup'
      ? { operationResult: result }
      : { commitResult: result });

    await expectKind(subject.opener.openLicenseReview(command), 'integrity_failure');
  });

  test('rejects a backwards server clock and authority that expires during evidence build', async () => {
    const backwardsTimes = [
      new Date('2026-08-29T12:00:01.000Z'),
      new Date('2026-08-29T12:00:00.000Z'),
    ];
    const backwards = await harness({ now: () => backwardsTimes.shift() ?? new Date(NOW) });
    await expectKind(backwards.opener.openLicenseReview(command), 'integrity_failure');
    expect(backwards.commitOpenLicenseReview).not.toHaveBeenCalled();

    const expiryTimes = [
      new Date('2026-08-29T12:00:00.000Z'),
      new Date('2026-08-29T12:00:02.000Z'),
    ];
    const expired = await harness({
      authority: authority({ valid_to: '2026-08-29T12:00:01.000Z' }),
      now: () => expiryTimes.shift() ?? new Date(NOW),
    });
    await expectKind(expired.opener.openLicenseReview(command), 'not_found_or_denied');
    expect(expired.commitOpenLicenseReview).not.toHaveBeenCalled();
  });
});
