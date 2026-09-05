import { describe, expect, test, vi } from 'vitest';

import { createConvexReviewWorkflowPort } from '../_shared/convex-review-workflow-port';

const authority = {
  authority_id: 'integrity:13101:actor-1', authority_version: 2,
  actor_id: 'actor-1', municipality_cut: '13101', roles: ['control'],
  permitted_actions: ['OpenLicenseReview', 'RecordOfficialDecision'],
  valid_from: '2026-01-01T00:00:00.000Z', valid_to: null, revoked_at: null,
};

describe('Convex review workflow port', () => {
  test('authenticates authority and exact-version dossier reads without caching', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(authority), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        caseJson: '{"case_id":"case-1"}',
        evidencePacketJson: '{"packet_id":"packet-1"}',
        actionJson: ['{"action_id":"action-1"}'],
      }), { status: 200 }));
    const port = createConvexReviewWorkflowPort({
      convexSiteUrl: 'https://example.convex.site', storageSecret: 'storage-secret', fetchImpl,
    });

    await expect(port.readAuthority('actor-1', '13101')).resolves.toEqual(authority);
    await expect(port.readDossier({
      actorId: 'actor-1', municipalityCut: '13101', caseId: 'case-1', caseVersion: 4,
    })).resolves.toMatchObject({ actionJson: ['{"action_id":"action-1"}'] });

    const [, dossierInit] = fetchImpl.mock.calls[1]!;
    expect(dossierInit).toMatchObject({ cache: 'no-store', credentials: 'omit' });
    expect(dossierInit.headers).toMatchObject({
      'x-review-case-storage-secret': 'storage-secret',
      'User-Agent': 'monitor-integridad-review-workflow/1.0',
    });
    expect(JSON.parse(String(dossierInit.body))).toMatchObject({ lookup: {
      actorId: 'actor-1', municipalityCut: '13101', caseId: 'case-1', caseVersion: 4,
    } });
  });

  test('hashes operation keys and never sends them to storage in clear text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ kind: 'miss' }), { status: 200 }));
    const port = createConvexReviewWorkflowPort({
      convexSiteUrl: 'https://example.convex.site', storageSecret: 'storage-secret', fetchImpl,
    });
    await port.readActionOperation({
      actorId: 'actor-1', municipalityCut: '13101', actionType: 'NoObservations',
      operationKey: 'private-operation-key', commandSha256: 'a'.repeat(64),
    });
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).not.toContain('private-operation-key');
    expect(JSON.parse(body).lookup.operationKeySha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  test('does not expose response bodies when storage fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('sensitive storage detail', { status: 500 }));
    const port = createConvexReviewWorkflowPort({
      convexSiteUrl: 'https://example.convex.site', storageSecret: 'storage-secret', fetchImpl,
    });
    await expect(port.readAuthority('actor-1', '13101')).rejects.toMatchObject({
      message: 'Review storage returned HTTP 500',
    });
  });
});
