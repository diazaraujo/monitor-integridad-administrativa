import { z } from 'zod';

import { sha256CanonicalJson } from './evidence-packet-canonical';

const REQUEST_TIMEOUT_MS = 5_000;
const SECRET_HEADER = 'x-review-case-storage-secret';
const authoritySchema = z.object({
  authority_id: z.string().min(1),
  authority_version: z.number().int().min(1),
  actor_id: z.string().min(1),
  municipality_cut: z.string().regex(/^\d{5}$/u),
  roles: z.array(z.enum(['rentas', 'control', 'coordinator', 'fiscalizacion'])).min(1),
  permitted_actions: z.array(z.string().min(1)).min(1),
  valid_from: z.string().datetime({ offset: true }),
  valid_to: z.string().datetime({ offset: true }).nullable(),
  revoked_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
const dossierSchema = z.object({
  caseJson: z.string().min(1),
  evidencePacketJson: z.string().min(1),
  actionJson: z.array(z.string().min(1)),
}).strict();
const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('miss') }).strict(),
  z.object({ kind: z.literal('operation_conflict') }).strict(),
  z.object({ kind: z.literal('replayed'), caseJson: z.string(), actionId: z.string() }).strict(),
]);
const commitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('committed'), caseJson: z.string(), actionId: z.string() }).strict(),
  z.object({ kind: z.literal('replayed'), caseJson: z.string(), actionId: z.string() }).strict(),
  z.object({ kind: z.literal('operation_conflict') }).strict(),
  z.object({ kind: z.literal('cas_conflict') }).strict(),
]);

export type ReviewWorkflowAuthority = z.infer<typeof authoritySchema>;
export type StoredReviewDossier = z.infer<typeof dossierSchema>;
export type ReviewActionOperation = z.infer<typeof operationSchema>;
export type ReviewActionCommit = z.infer<typeof commitSchema>;

export class ConvexReviewWorkflowPortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConvexReviewWorkflowPortError';
  }
}

export interface ConvexReviewWorkflowPort {
  readAuthority(actorId: string, municipalityCut: string): Promise<ReviewWorkflowAuthority | null>;
  readDossier(input: {
    actorId: string;
    municipalityCut: string;
    caseId: string;
    caseVersion: number;
  }): Promise<StoredReviewDossier | null>;
  readActionOperation(input: {
    actorId: string;
    municipalityCut: string;
    actionType: string;
    operationKey: string;
    commandSha256: string;
  }): Promise<ReviewActionOperation>;
  commitAction(input: Record<string, unknown> & {
    operationKey: string;
    actorId: string;
    actionType: string;
  }): Promise<ReviewActionCommit>;
}

function normalizedSiteUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new ConvexReviewWorkflowPortError('Review storage configuration is invalid');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new ConvexReviewWorkflowPortError('Review storage configuration is invalid');
  }
  return url.toString().replace(/\/$/u, '');
}

export function createConvexReviewWorkflowPort(config: {
  convexSiteUrl: string;
  storageSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ConvexReviewWorkflowPort {
  const siteUrl = normalizedSiteUrl(config.convexSiteUrl);
  if (!config.storageSecret || config.storageSecret.length > 2_048) {
    throw new ConvexReviewWorkflowPortError('Review storage configuration is invalid');
  }
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${siteUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'monitor-integridad-review-workflow/1.0',
          [SECRET_HEADER]: config.storageSecret,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ConvexReviewWorkflowPortError('Review storage is unavailable');
    }
    if (!response.ok) {
      throw new ConvexReviewWorkflowPortError(`Review storage returned HTTP ${response.status}`);
    }
    try { return await response.json(); } catch {
      throw new ConvexReviewWorkflowPortError('Review storage returned invalid JSON');
    }
  }

  async function operationKeySha256(operationKey: string, actorId: string, actionType: string) {
    return sha256CanonicalJson({ actor_id: actorId, action: actionType, operation_key: operationKey });
  }

  return {
    async readAuthority(actorId, municipalityCut) {
      const value = await post('/api/internal-review-workflow-authority', {
        actorId, municipalityCut,
      });
      if (value === null) return null;
      const parsed = authoritySchema.safeParse(value);
      if (!parsed.success) throw new ConvexReviewWorkflowPortError('Review storage returned invalid data');
      return parsed.data;
    },

    async readDossier(input) {
      const value = await post('/api/internal-review-case-dossier', {
        lookup: { ...input, maxPacketBytes: 2 * 1024 * 1024 },
      });
      if (value === null) return null;
      const parsed = dossierSchema.safeParse(value);
      if (!parsed.success) throw new ConvexReviewWorkflowPortError('Review storage returned invalid data');
      return parsed.data;
    },

    async readActionOperation(input) {
      const value = await post('/api/internal-review-action-operation', {
        lookup: {
          actorId: input.actorId,
          municipalityCut: input.municipalityCut,
          actionType: input.actionType,
          operationKeySha256: await operationKeySha256(
            input.operationKey, input.actorId, input.actionType,
          ),
          commandSha256: input.commandSha256,
        },
      });
      const parsed = operationSchema.safeParse(value);
      if (!parsed.success) throw new ConvexReviewWorkflowPortError('Review storage returned invalid data');
      return parsed.data;
    },

    async commitAction(input) {
      const { operationKey, actorId, actionType, ...request } = input;
      const value = await post('/api/internal-record-review-action', {
        request: {
          ...request,
          operationKeySha256: await operationKeySha256(operationKey, actorId, actionType),
        },
      });
      const parsed = commitSchema.safeParse(value);
      if (!parsed.success) throw new ConvexReviewWorkflowPortError('Review storage returned invalid data');
      return parsed.data;
    },
  };
}

export function createConvexReviewWorkflowPortFromEnv(): ConvexReviewWorkflowPort {
  const convexSiteUrl = process.env.CONVEX_SITE_URL ?? '';
  const storageSecret = process.env.REVIEW_CASE_STORAGE_SECRET ?? '';
  if (!convexSiteUrl || !storageSecret) {
    throw new ConvexReviewWorkflowPortError('Review storage configuration is missing');
  }
  return createConvexReviewWorkflowPort({ convexSiteUrl, storageSecret });
}
