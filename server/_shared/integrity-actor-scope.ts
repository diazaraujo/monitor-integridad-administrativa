import { z } from 'zod';

import { resolveClerkSession } from './auth-session';
import { TRUSTED_USER_ID_HEADER } from './mcp-internal-hmac';

const actorScopeSchema = z.object({
  actor_id: z.string().min(1).max(200),
  municipality_cut: z.string().regex(/^\d{5}$/u),
  roles: z.array(z.enum(['rentas', 'control', 'coordinator', 'fiscalizacion'])).min(1)
    .refine((roles) => new Set(roles).size === roles.length),
  representation: z.enum(['public', 'municipal_restricted']),
}).strict();

const actorScopesSchema = z.array(actorScopeSchema).max(10_000);

export type IntegrityActorScope = z.infer<typeof actorScopeSchema>;

export class IntegrityActorScopeError extends Error {
  readonly kind: 'unauthenticated' | 'forbidden' | 'configuration';

  constructor(kind: IntegrityActorScopeError['kind']) {
    super(kind);
    this.name = 'IntegrityActorScopeError';
    this.kind = kind;
  }
}

export interface IntegrityActorScopeEnvironment {
  INTEGRITY_ACTOR_SCOPES_JSON?: string;
}

export async function resolveIntegrityActorScope(
  request: Request,
  env: IntegrityActorScopeEnvironment = process.env,
): Promise<IntegrityActorScope> {
  // The gateway strips inbound x-user-id and rebuilds it only after verifying a
  // user-owned API key or session. The direct JWT fallback keeps the resolver
  // safe when invoked outside createDomainGateway in focused tests/tools.
  const trustedActorId = request.headers.get(TRUSTED_USER_ID_HEADER)?.trim();
  const session = trustedActorId ? null : await resolveClerkSession(request);
  const actorId = trustedActorId || session?.userId;
  if (!actorId) throw new IntegrityActorScopeError('unauthenticated');

  const raw = env.INTEGRITY_ACTOR_SCOPES_JSON;
  if (!raw || raw.length > 1_000_000) throw new IntegrityActorScopeError('configuration');

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new IntegrityActorScopeError('configuration');
  }
  const parsed = actorScopesSchema.safeParse(value);
  if (!parsed.success) throw new IntegrityActorScopeError('configuration');

  const matches = parsed.data.filter((scope) => scope.actor_id === actorId);
  if (matches.length !== 1) throw new IntegrityActorScopeError('forbidden');
  return matches[0]!;
}
