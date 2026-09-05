// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  createReviewCaseAssigner,
  ReviewCaseAssignerError,
  type AssignReviewerAuthority,
  type AssignReviewerEligibility,
  type AssignReviewerReceipt,
  type AssignReviewerWritePort,
  type CommitAssignReviewerRequest,
} from '../_shared/review-case-assigner';
import type { ReviewCaseSnapshot } from '../_shared/review-case-contract';

const NOW = '2026-08-30T17:00:00.000Z';
const CUT = '10303';

function snapshot(overrides: Partial<ReviewCaseSnapshot> = {}): ReviewCaseSnapshot {
  return {
    schema_version: '0.1.0',
    case_id: 'case-001',
    case_version: 1,
    municipality_cut: CUT,
    license_id: 'license-001',
    status: 'open',
    classification: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
    created_at: '2026-08-30T16:00:00.000Z',
    updated_at: '2026-08-30T16:00:00.000Z',
    packet_ref: {
      packet_id: 'packet-001',
      packet_content_sha256: 'a'.repeat(64),
      packet_schema_version: '0.1.0',
      packet_generated_at: '2026-08-30T15:59:00.000Z',
      primary_release_id: 'purranque-2026-s1',
      required_markings: ['ACTIVE_REVIEW', 'MUNICIPAL_INTERNAL'],
    },
    ...overrides,
  };
}

function authority(overrides: Partial<AssignReviewerAuthority> = {}): AssignReviewerAuthority {
  return {
    authority_id: 'authority-001',
    authority_version: 2,
    actor_id: 'coordinator-001',
    municipality_cut: CUT,
    roles: ['coordinator'],
    permitted_actions: ['AssignReviewer'],
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_to: null,
    revoked_at: null,
    ...overrides,
  };
}

function reviewer(overrides: Partial<AssignReviewerEligibility> = {}): AssignReviewerEligibility {
  return {
    reviewer_id: 'reviewer-001',
    municipality_cut: CUT,
    eligible: true,
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_to: null,
    revoked_at: null,
    ...overrides,
  };
}

function command() {
  return {
    operationKey: 'assign-key-001',
    caseId: 'case-001',
    expectedCaseVersion: 1,
    reviewerId: 'reviewer-001',
  };
}

interface HarnessOptions {
  authority?: unknown | null;
  authorityError?: boolean;
  reviewer?: unknown | null;
  reviewerError?: boolean;
  snapshot?: unknown | null;
  operation?: Awaited<ReturnType<AssignReviewerWritePort['readAssignReviewerOperation']>>;
  operationError?: boolean;
  commit?: Awaited<ReturnType<AssignReviewerWritePort['commitAssignReviewer']>>;
  commitError?: boolean;
  times?: string[];
}

function harness(options: HarnessOptions = {}) {
  let committed: CommitAssignReviewerRequest | undefined;
  const readAssignReviewerOperation = vi.fn(async () => {
    if (options.operationError) throw new Error('sensitive storage detail');
    return options.operation ?? { kind: 'miss' as const };
  });
  const readReviewCaseSnapshot = vi.fn(async () => options.snapshot === undefined
    ? snapshot()
    : options.snapshot);
  const commitAssignReviewer = vi.fn(async (request: CommitAssignReviewerRequest) => {
    committed = request;
    if (options.commitError) throw new Error('sensitive storage detail');
    return options.commit ?? { kind: 'committed' as const };
  });
  const writePort: AssignReviewerWritePort = {
    readAssignReviewerOperation,
    readReviewCaseSnapshot,
    commitAssignReviewer,
  };
  const times = [...(options.times ?? [NOW, NOW])];
  const assigner = createReviewCaseAssigner({
    resolveAuthority: vi.fn(async () => {
      if (options.authorityError) throw new Error('sensitive identity detail');
      return options.authority === undefined ? authority() : options.authority;
    }),
    resolveReviewerEligibility: vi.fn(async () => {
      if (options.reviewerError) throw new Error('sensitive reviewer detail');
      return options.reviewer === undefined ? reviewer() : options.reviewer;
    }),
    writePort,
    newActionId: () => 'action-assign-001',
    now: () => new Date(times.shift() ?? NOW),
  });
  return {
    assigner,
    readAssignReviewerOperation,
    readReviewCaseSnapshot,
    commitAssignReviewer,
    committed: () => committed,
  };
}

async function expectKind(promise: Promise<unknown>, kind: ReviewCaseAssignerError['kind']) {
  await expect(promise).rejects.toMatchObject({ kind });
}

describe('review case assigner', () => {
  it('assigns an eligible reviewer and advances the case exactly one version', async () => {
    const test = harness();

    const receipt = await test.assigner.assignReviewer(command());

    expect(receipt).toMatchObject({
      replayed: false,
      case: {
        case_id: 'case-001',
        case_version: 2,
        status: 'in_review',
        assignment: {
          reviewer_id: 'reviewer-001',
          assigned_by: 'coordinator-001',
          assigned_at: NOW,
        },
      },
      action: {
        action_type: 'AssignReviewer',
        previous_case_version: 1,
        resulting_case_version: 2,
        legal_effect: 'none',
        packet_ref: snapshot().packet_ref,
      },
    });
    expect(receipt.case.packet_ref).toEqual(snapshot().packet_ref);
    expect(test.committed()).toMatchObject({
      expectedCaseVersion: 1,
      authorityFence: {
        authorityId: 'authority-001',
        authorityVersion: 2,
        action: 'AssignReviewer',
      },
      reviewerFence: { reviewerId: 'reviewer-001', municipalityCut: CUT },
    });
  });

  it('scopes storage reads to the authority municipality and exact version', async () => {
    const test = harness();

    await test.assigner.assignReviewer(command());

    expect(test.readReviewCaseSnapshot).toHaveBeenCalledWith({
      caseId: 'case-001',
      caseVersion: 1,
      municipalityCut: CUT,
    });
  });

  it('replays a prior valid receipt without reading or writing the case', async () => {
    const first = harness();
    const prior = await first.assigner.assignReviewer(command());
    const replay = harness({ operation: { kind: 'replayed', receipt: prior } });

    const result = await replay.assigner.assignReviewer(command());

    expect(result.replayed).toBe(true);
    expect(replay.readReviewCaseSnapshot).not.toHaveBeenCalled();
    expect(replay.commitAssignReviewer).not.toHaveBeenCalled();
  });

  it('accepts a transaction-race replay from commit', async () => {
    const first = harness();
    const prior = await first.assigner.assignReviewer(command());
    const raced = harness({ commit: { kind: 'replayed', receipt: prior } });

    await expect(raced.assigner.assignReviewer(command())).resolves.toMatchObject({ replayed: true });
  });

  it('rejects reuse of an operation key for another command', async () => {
    const test = harness({ operation: { kind: 'operation_conflict' } });

    await expectKind(test.assigner.assignReviewer(command()), 'idempotency_conflict');
  });

  it('fails closed when the exact case version is absent', async () => {
    const test = harness({ snapshot: null });

    await expectKind(test.assigner.assignReviewer(command()), 'not_found_or_denied');
  });

  it('fails closed for cross-municipality snapshots', async () => {
    const test = harness({ snapshot: snapshot({ municipality_cut: '10101' }) });

    await expectKind(test.assigner.assignReviewer(command()), 'not_found_or_denied');
  });

  it.each(['closed', 'waiting_external', 'in_review'] as const)(
    'does not assign a case in %s state',
    async (status) => {
      const test = harness({
        snapshot: snapshot({
          status,
          ...(status === 'closed' ? { closed_at: NOW } : {}),
        }),
      });
      await expectKind(test.assigner.assignReviewer(command()), 'not_found_or_denied');
    },
  );

  it('rejects revoked authority without reading the case', async () => {
    const test = harness({ authority: authority({ revoked_at: NOW }) });

    await expectKind(test.assigner.assignReviewer(command()), 'not_found_or_denied');
    expect(test.readReviewCaseSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a reviewer outside the case municipality', async () => {
    const test = harness({ reviewer: reviewer({ municipality_cut: '10101' }) });

    await expectKind(test.assigner.assignReviewer(command()), 'not_found_or_denied');
    expect(test.commitAssignReviewer).not.toHaveBeenCalled();
  });

  it('rejects revoked reviewer eligibility', async () => {
    const test = harness({ reviewer: reviewer({ revoked_at: NOW }) });

    await expectKind(test.assigner.assignReviewer(command()), 'not_found_or_denied');
  });

  it('maps authority, reviewer, and storage outages to safe errors', async () => {
    await expectKind(harness({ authorityError: true }).assigner.assignReviewer(command()), 'authority_unavailable');
    await expectKind(harness({ reviewerError: true }).assigner.assignReviewer(command()), 'reviewer_unavailable');
    await expectKind(harness({ operationError: true }).assigner.assignReviewer(command()), 'storage_unavailable');
    await expectKind(harness({ commitError: true }).assigner.assignReviewer(command()), 'storage_unavailable');
  });

  it('maps a transactional CAS failure to a case conflict', async () => {
    const test = harness({ commit: { kind: 'cas_conflict' } });

    await expectKind(test.assigner.assignReviewer(command()), 'case_conflict');
  });

  it('rejects malformed operation and commit responses from storage', async () => {
    await expectKind(
      harness({ operation: { kind: 'unexpected' } as never }).assigner.assignReviewer(command()),
      'integrity_failure',
    );
    await expectKind(
      harness({ commit: { kind: 'unexpected' } as never }).assigner.assignReviewer(command()),
      'integrity_failure',
    );
  });

  it('rejects invalid commands before resolving authority', async () => {
    const resolveAuthority = vi.fn(async () => authority());
    const writePort: AssignReviewerWritePort = {
      readAssignReviewerOperation: vi.fn(async () => ({ kind: 'miss' as const })),
      readReviewCaseSnapshot: vi.fn(async () => snapshot()),
      commitAssignReviewer: vi.fn(async () => ({ kind: 'committed' as const })),
    };
    const assigner = createReviewCaseAssigner({
      resolveAuthority,
      resolveReviewerEligibility: async () => reviewer(),
      writePort,
      newActionId: () => 'action-001',
    });

    await expectKind(assigner.assignReviewer({ ...command(), unexpected: true } as never), 'invalid_request');
    expect(resolveAuthority).not.toHaveBeenCalled();
  });

  it('fails closed when the server clock moves backwards', async () => {
    const test = harness({
      times: ['2026-08-30T17:00:01.000Z', '2026-08-30T17:00:00.000Z'],
    });

    await expectKind(test.assigner.assignReviewer(command()), 'integrity_failure');
    expect(test.commitAssignReviewer).not.toHaveBeenCalled();
  });

  it('rejects a replay whose assignment was altered', async () => {
    const first = harness();
    const prior = await first.assigner.assignReviewer(command());
    const altered: AssignReviewerReceipt = {
      ...prior,
      case: {
        ...prior.case,
        assignment: { ...prior.case.assignment!, reviewer_id: 'reviewer-002' },
      },
    };
    const replay = harness({ operation: { kind: 'replayed', receipt: altered } });

    await expectKind(replay.assigner.assignReviewer(command()), 'integrity_failure');
  });
});
