import { describe, expect, test } from 'vitest';

import {
  IntegrityActorScopeError,
  resolveIntegrityActorScope,
} from '../_shared/integrity-actor-scope';

const configuredScope = JSON.stringify([{
  actor_id: 'municipal-user-1',
  municipality_cut: '13115',
  roles: ['rentas'],
  representation: 'municipal_restricted',
}]);

function request(actorId?: string): Request {
  return new Request('https://monitor.test/api/integrity/v1/search-patents', {
    headers: actorId ? { 'x-user-id': actorId } : {},
  });
}

describe('resolveIntegrityActorScope', () => {
  test('resolves one exact server-authenticated actor scope', async () => {
    await expect(resolveIntegrityActorScope(request('municipal-user-1'), {
      INTEGRITY_ACTOR_SCOPES_JSON: configuredScope,
    })).resolves.toEqual({
      actor_id: 'municipal-user-1',
      municipality_cut: '13115',
      roles: ['rentas'],
      representation: 'municipal_restricted',
    });
  });

  test('rejects actors absent from the server-owned scope map', async () => {
    await expect(resolveIntegrityActorScope(request('another-user'), {
      INTEGRITY_ACTOR_SCOPES_JSON: configuredScope,
    })).rejects.toMatchObject<Partial<IntegrityActorScopeError>>({ kind: 'forbidden' });
  });

  test('fails closed on duplicate or malformed configuration', async () => {
    const duplicate = JSON.stringify([
      JSON.parse(configuredScope)[0],
      JSON.parse(configuredScope)[0],
    ]);
    await expect(resolveIntegrityActorScope(request('municipal-user-1'), {
      INTEGRITY_ACTOR_SCOPES_JSON: duplicate,
    })).rejects.toMatchObject<Partial<IntegrityActorScopeError>>({ kind: 'forbidden' });
    await expect(resolveIntegrityActorScope(request('municipal-user-1'), {
      INTEGRITY_ACTOR_SCOPES_JSON: '{',
    })).rejects.toMatchObject<Partial<IntegrityActorScopeError>>({ kind: 'configuration' });
  });
});
