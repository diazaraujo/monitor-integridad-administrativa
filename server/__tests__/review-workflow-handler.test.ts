import { afterEach, describe, expect, test, vi } from 'vitest';

import { ConvexReviewWorkflowPortError } from '../_shared/convex-review-workflow-port';
import { IntegrityActorScopeError } from '../_shared/integrity-actor-scope';
import {
  __setReviewWorkflowDependenciesForTests,
  assignReviewer,
  recordReviewAction,
} from '../worldmonitor/integrity/v1/review-workflow';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const actor = {
  actor_id: 'reviewer-1',
  municipality_cut: '13115',
  roles: ['control'] as const,
  representation: 'public' as const,
};

function context(idempotencyKey?: string) {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  return {
    request: new Request('https://monitor.test/api/integrity/v1/record-review-action', { headers }),
    pathParams: {},
    headers: headers ?? {},
  };
}

function port(overrides: Record<string, unknown> = {}) {
  return {
    readAuthority: vi.fn(async () => ({
      authority_id: 'authority-1', authority_version: 1,
      actor_id: actor.actor_id, municipality_cut: actor.municipality_cut,
      roles: [...actor.roles], permitted_actions: ['NoObservations'],
      valid_from: '2026-01-01T00:00:00.000Z', valid_to: null, revoked_at: null,
    })),
    readDossier: vi.fn(),
    readActionOperation: vi.fn(),
    commitAction: vi.fn(),
    ...overrides,
  };
}

afterEach(() => __setReviewWorkflowDependenciesForTests(null));

describe('IntegrityService review workflow handlers', () => {
  test('fails closed before storage when authentication is absent', async () => {
    const createWorkflowPort = vi.fn();
    __setReviewWorkflowDependenciesForTests({
      resolveActorScope: async () => { throw new IntegrityActorScopeError('unauthenticated'); },
      createWorkflowPort,
    });

    await expect(recordReviewAction(context('operation-1'), {
      caseId: 'case-1', expectedCaseVersion: 1, actionType: 'NoObservations',
      note: '', outcomeCode: '', externalReference: '',
    })).rejects.toMatchObject({ statusCode: 401 });
    expect(createWorkflowPort).not.toHaveBeenCalled();
  });

  test('rejects unsupported actions before opening the storage port', async () => {
    const createWorkflowPort = vi.fn();
    __setReviewWorkflowDependenciesForTests({
      resolveActorScope: async () => actor,
      createWorkflowPort,
    });

    await expect(recordReviewAction(context('operation-1'), {
      caseId: 'case-1', expectedCaseVersion: 1, actionType: 'DeleteReview',
      note: '', outcomeCode: '', externalReference: '',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(createWorkflowPort).not.toHaveBeenCalled();
  });

  test('maps storage configuration failures to a safe retryable response', async () => {
    __setReviewWorkflowDependenciesForTests({
      resolveActorScope: async () => actor,
      createWorkflowPort: () => { throw new ConvexReviewWorkflowPortError('secret detail'); },
    });

    await expect(recordReviewAction(context('operation-1'), {
      caseId: 'case-1', expectedCaseVersion: 1, actionType: 'NoObservations',
      note: '', outcomeCode: '', externalReference: '',
    })).rejects.toMatchObject({ statusCode: 503, message: 'Review storage unavailable' });
  });

  test('requires idempotency before reading the dossier', async () => {
    const storage = port();
    __setReviewWorkflowDependenciesForTests({
      resolveActorScope: async () => actor,
      createWorkflowPort: () => storage,
      now: () => NOW,
    });

    await expect(recordReviewAction(context(), {
      caseId: 'case-1', expectedCaseVersion: 1, actionType: 'NoObservations',
      note: '', outcomeCode: '', externalReference: '',
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.readAuthority).not.toHaveBeenCalled();
    expect(storage.readDossier).not.toHaveBeenCalled();
  });

  test('requires an exclusively coordinator-scoped actor for assignment', async () => {
    const storage = port({
      readAuthority: vi.fn(async () => ({
        authority_id: 'authority-1', authority_version: 1,
        actor_id: actor.actor_id, municipality_cut: actor.municipality_cut,
        roles: ['control'], permitted_actions: ['AssignReviewer'],
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: null, revoked_at: null,
      })),
    });
    __setReviewWorkflowDependenciesForTests({
      resolveActorScope: async () => actor,
      createWorkflowPort: () => storage,
      now: () => NOW,
    });

    await expect(assignReviewer(context('operation-1'), {
      caseId: 'case-1', expectedCaseVersion: 1, reviewerId: 'reviewer-2',
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(storage.readAuthority).toHaveBeenCalledTimes(1);
  });
});
