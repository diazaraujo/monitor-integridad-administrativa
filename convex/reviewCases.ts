import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

const ACTION = "OpenLicenseReview";
const ASSIGN_ACTION = "AssignReviewer";
const PACKET_NATURE = "historical_non_executable";
const PACKET_SCHEMA_VERSION = "0.1.0";
const BASE_CLASSIFICATION = ["ACTIVE_REVIEW", "MUNICIPAL_INTERNAL"] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const CUT = /^\d{5}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const REVIEW_PACKET_MAX_BYTES = 2 * 1024 * 1024;
export const REVIEW_PACKET_CHUNK_MAX_BYTES = 192 * 1024;

const lookupValidator = v.object({
  operationKeySha256: v.string(),
  commandSha256: v.string(),
  actorId: v.string(),
  municipalityCut: v.string(),
});

const authorityFenceValidator = v.object({
  authorityId: v.string(),
  authorityVersion: v.number(),
  actorId: v.string(),
  municipalityCut: v.string(),
  action: v.literal("OpenLicenseReview"),
  requiredMarkings: v.array(v.string()),
  representation: v.union(v.literal("public"), v.literal("municipal_restricted")),
  evaluatedAt: v.string(),
});

const packetChunkValidator = v.object({
  ordinal: v.number(),
  encodedBase64: v.string(),
  byteLength: v.number(),
});

const commitValidator = v.object({
  operationKeySha256: v.string(),
  commandSha256: v.string(),
  activeCaseKey: v.string(),
  expectedCaseVersion: v.number(),
  caseSnapshot: v.any(),
  evidencePacketSnapshot: v.object({
    nature: v.string(),
    bytes: v.number(),
    chunks: v.array(packetChunkValidator),
  }),
  action: v.any(),
  authorityFence: authorityFenceValidator,
});

const authorityGrantValidator = v.object({
  authorityId: v.string(),
  authorityVersion: v.number(),
  actorId: v.string(),
  municipalityCut: v.string(),
  roles: v.array(v.union(v.literal("rentas"), v.literal("control"))),
  permittedActions: v.array(v.literal("OpenLicenseReview")),
  allowedMarkings: v.array(v.union(
    v.literal("PUBLIC"), v.literal("PII"), v.literal("LICENSED"),
    v.literal("MUNICIPAL_INTERNAL"), v.literal("ACTIVE_REVIEW"), v.literal("AUTHORITY_ONLY"),
  )),
  allowedRepresentations: v.array(v.union(
    v.literal("public"), v.literal("municipal_restricted"),
  )),
  validFrom: v.string(),
  validTo: v.union(v.string(), v.null()),
  revokedAt: v.union(v.string(), v.null()),
});

const assignmentAuthorityGrantValidator = v.object({
  authorityId: v.string(),
  authorityVersion: v.number(),
  actorId: v.string(),
  municipalityCut: v.string(),
  roles: v.array(v.literal("coordinator")),
  permittedActions: v.array(v.literal("AssignReviewer")),
  validFrom: v.string(),
  validTo: v.union(v.string(), v.null()),
  revokedAt: v.union(v.string(), v.null()),
});

const reviewerEligibilityGrantValidator = v.object({
  reviewerId: v.string(),
  reviewerVersion: v.number(),
  municipalityCut: v.string(),
  eligible: v.boolean(),
  validFrom: v.string(),
  validTo: v.union(v.string(), v.null()),
  revokedAt: v.union(v.string(), v.null()),
});

const assignmentLookupValidator = v.object({
  operationKeySha256: v.string(),
  commandSha256: v.string(),
  actorId: v.string(),
  municipalityCut: v.string(),
});

const assignmentSnapshotLookupValidator = v.object({
  caseId: v.string(),
  caseVersion: v.number(),
  municipalityCut: v.string(),
});

const assignmentCommitValidator = v.object({
  operationKeySha256: v.string(),
  commandSha256: v.string(),
  expectedCaseVersion: v.number(),
  previousCaseSnapshot: v.any(),
  resultingCaseSnapshot: v.any(),
  action: v.any(),
  authorityFence: v.object({
    authorityId: v.string(), authorityVersion: v.number(), actorId: v.string(),
    municipalityCut: v.string(), action: v.literal("AssignReviewer"), evaluatedAt: v.string(),
  }),
  reviewerFence: v.object({
    reviewerId: v.string(), municipalityCut: v.string(), evaluatedAt: v.string(),
  }),
});

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  const values = value as string[];
  return new Set(values).size === values.length ? values : null;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function failIntegrity(): never {
  throw new ConvexError("REVIEW_STORAGE_INTEGRITY");
}

function validateLookup(lookup: {
  operationKeySha256: string;
  commandSha256: string;
  actorId: string;
  municipalityCut: string;
}): void {
  if (
    !SHA256.test(lookup.operationKeySha256)
    || !SHA256.test(lookup.commandSha256)
    || !IDENTIFIER.test(lookup.actorId)
    || !CUT.test(lookup.municipalityCut)
  ) failIntegrity();
}

async function uniqueByIndex<T>(rows: T[]): Promise<T | null> {
  if (rows.length > 1) failIntegrity();
  return rows[0] ?? null;
}

async function loadReceipt(
  ctx: QueryCtx | MutationCtx,
  binding: { caseId: string; actionId: string },
): Promise<JsonRecord> {
  const caseRows = await ctx.db
    .query("reviewCases")
    .withIndex("by_case_version", (q) => q.eq("caseId", binding.caseId).eq("caseVersion", 1))
    .collect();
  const actionRows = await ctx.db
    .query("reviewActions")
    .withIndex("by_actionId", (q) => q.eq("actionId", binding.actionId))
    .collect();
  const caseRow = await uniqueByIndex(caseRows);
  const actionRow = await uniqueByIndex(actionRows);
  if (!caseRow || !actionRow || actionRow.caseId !== caseRow.caseId) failIntegrity();
  try {
    return {
      schema_version: PACKET_SCHEMA_VERSION,
      case: JSON.parse(caseRow.snapshotJson),
      action: JSON.parse(actionRow.actionJson),
      replayed: false,
    };
  } catch {
    return failIntegrity();
  }
}

async function findOperation(
  ctx: QueryCtx | MutationCtx,
  actorId: string,
  operationKeySha256: string,
) {
  const rows = await ctx.db
    .query("reviewOperations")
    .withIndex("by_actor_action_key", (q) => (
      q.eq("actorId", actorId).eq("actionType", ACTION)
        .eq("operationKeySha256", operationKeySha256)
    ))
    .collect();
  return await uniqueByIndex(rows);
}

export const readOpenLicenseReviewOperation = internalQuery({
  args: { lookup: lookupValidator },
  handler: async (ctx, args) => {
    validateLookup(args.lookup);
    const binding = await findOperation(ctx, args.lookup.actorId, args.lookup.operationKeySha256);
    if (!binding) return { kind: "miss" as const };
    if (
      binding.commandSha256 !== args.lookup.commandSha256
      || binding.municipalityCut !== args.lookup.municipalityCut
    ) return { kind: "operation_conflict" as const };
    return {
      kind: "replayed" as const,
      receipt: await loadReceipt(ctx, binding),
    };
  },
});

function validateGrantInput(args: {
  authorityId: string;
  authorityVersion: number;
  actorId: string;
  municipalityCut: string;
  roles: string[];
  permittedActions: string[];
  allowedMarkings: string[];
  allowedRepresentations: string[];
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
}): void {
  const roles = new Set(["rentas", "control"]);
  const markings = new Set([
    "PUBLIC", "PII", "LICENSED", "MUNICIPAL_INTERNAL", "ACTIVE_REVIEW", "AUTHORITY_ONLY",
  ]);
  const representations = new Set(["public", "municipal_restricted"]);
  if (
    !IDENTIFIER.test(args.authorityId)
    || !Number.isSafeInteger(args.authorityVersion)
    || args.authorityVersion < 1
    || !IDENTIFIER.test(args.actorId)
    || !CUT.test(args.municipalityCut)
    || args.roles.length === 0
    || new Set(args.roles).size !== args.roles.length
    || args.roles.some((role) => !roles.has(role))
    || !sameSet(args.permittedActions, [ACTION])
    || args.allowedMarkings.length === 0
    || new Set(args.allowedMarkings).size !== args.allowedMarkings.length
    || args.allowedMarkings.some((marking) => !markings.has(marking))
    || args.allowedRepresentations.length === 0
    || new Set(args.allowedRepresentations).size !== args.allowedRepresentations.length
    || args.allowedRepresentations.some((item) => !representations.has(item))
    || !validInstant(args.validFrom)
    || (args.validTo !== null && !validInstant(args.validTo))
    || (args.validTo !== null && Date.parse(args.validTo) <= Date.parse(args.validFrom))
    || (args.revokedAt !== null && !validInstant(args.revokedAt))
  ) throw new ConvexError("INVALID_REVIEW_AUTHORITY_GRANT");
}

/** Operator-only provisioning primitive; no public function or browser route exposes it. */
export const _seedReviewWriteLock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("reviewWriteLocks")
      .withIndex("by_lockKey", (q) => q.eq("lockKey", "review-write"))
      .collect();
    if (rows.length > 1) failIntegrity();
    if (rows.length === 0) {
      await ctx.db.insert("reviewWriteLocks", {
        lockKey: "review-write",
        lastTouchedAt: Date.now(),
      });
      return { seeded: true };
    }
    return { seeded: false };
  },
});

/** Operator-only provisioning primitive; no public function or browser route exposes it. */
export const upsertAuthorityGrant = internalMutation({
  args: authorityGrantValidator,
  handler: async (ctx, args) => {
    validateGrantInput(args);
    const now = Date.now();
    const existingRows = await ctx.db
      .query("reviewAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", args.authorityId))
      .collect();
    const existing = await uniqueByIndex(existingRows);
    if (existing) {
      if (
        existing.actorId !== args.actorId
        || existing.municipalityCut !== args.municipalityCut
        || args.authorityVersion <= existing.authorityVersion
      ) throw new ConvexError("INVALID_REVIEW_AUTHORITY_ADVANCE");
      await ctx.db.replace(existing._id, {
        ...args,
        validTo: args.validTo ?? undefined,
        revokedAt: args.revokedAt ?? undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("reviewAuthorityGrants", {
        ...args,
        validTo: args.validTo ?? undefined,
        revokedAt: args.revokedAt ?? undefined,
        updatedAt: now,
      });
    }

    const writeLocks = await ctx.db
      .query("reviewWriteLocks")
      .withIndex("by_lockKey", (q) => q.eq("lockKey", "review-write"))
      .collect();
    if (writeLocks.length > 1) failIntegrity();
    if (writeLocks.length === 0) throw new ConvexError("REVIEW_WRITE_LOCK_NOT_SEEDED");
    await ctx.db.patch(writeLocks[0]!._id, { lastTouchedAt: now });
    return { authorityId: args.authorityId, authorityVersion: args.authorityVersion };
  },
});

function decodePacketSnapshot(snapshot: {
  nature: string;
  bytes: number;
  chunks: { ordinal: number; encodedBase64: string; byteLength: number }[];
}): { json: string; chunks: { ordinal: number; encodedBase64: string; byteLength: number }[] } {
  if (
    snapshot.nature !== PACKET_NATURE
    || !Number.isSafeInteger(snapshot.bytes)
    || snapshot.bytes <= 0
    || snapshot.bytes > REVIEW_PACKET_MAX_BYTES
    || snapshot.chunks.length === 0
  ) failIntegrity();
  const byteChunks: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < snapshot.chunks.length; index++) {
    const chunk = snapshot.chunks[index]!;
    if (
      chunk.ordinal !== index
      || !Number.isSafeInteger(chunk.byteLength)
      || chunk.byteLength <= 0
      || chunk.byteLength > REVIEW_PACKET_CHUNK_MAX_BYTES
    ) failIntegrity();
    let binary: string;
    try {
      binary = atob(chunk.encodedBase64);
    } catch {
      return failIntegrity();
    }
    if (binary.length !== chunk.byteLength || btoa(binary) !== chunk.encodedBase64) failIntegrity();
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    byteChunks.push(bytes);
    total += bytes.byteLength;
  }
  if (total !== snapshot.bytes) failIntegrity();
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const bytes of byteChunks) {
    joined.set(bytes, offset);
    offset += bytes.byteLength;
  }
  try {
    return {
      json: new TextDecoder("utf-8", { fatal: true }).decode(joined),
      chunks: snapshot.chunks,
    };
  } catch {
    return failIntegrity();
  }
}

function validateCommitPayload(args: {
  operationKeySha256: string;
  commandSha256: string;
  activeCaseKey: string;
  expectedCaseVersion: number;
  caseSnapshot: unknown;
  action: unknown;
  authorityFence: {
    authorityId: string;
    authorityVersion: number;
    actorId: string;
    municipalityCut: string;
    action: string;
    requiredMarkings: string[];
    representation: string;
    evaluatedAt: string;
  };
}, packetJson: string): {
  snapshot: JsonRecord;
  action: JsonRecord;
  packet: JsonRecord;
  packetRef: JsonRecord;
  packetId: string;
  caseId: string;
  actionId: string;
  licenseId: string;
  occurredAt: number;
} {
  validateLookup({
    operationKeySha256: args.operationKeySha256,
    commandSha256: args.commandSha256,
    actorId: args.authorityFence.actorId,
    municipalityCut: args.authorityFence.municipalityCut,
  });
  const snapshot = record(args.caseSnapshot);
  const action = record(args.action);
  let packetValue: unknown;
  try {
    packetValue = JSON.parse(packetJson);
  } catch {
    return failIntegrity();
  }
  const packet = record(packetValue);
  const packetRef = record(snapshot?.packet_ref);
  const actionPacketRef = record(action?.packet_ref);
  const reproduction = record(packet?.reproducibility);
  const license = record(packet?.license);
  const classification = stringArray(snapshot?.classification);
  const packetClassification = stringArray(packet?.classification);
  const requiredMarkings = stringArray(packetRef?.required_markings);
  const actorRoles = stringArray(action?.actor_roles);
  if (
    !snapshot || !action || !packet || !packetRef || !actionPacketRef || !reproduction || !license
    || !classification || !packetClassification || !requiredMarkings || !actorRoles
    || snapshot.schema_version !== PACKET_SCHEMA_VERSION
    || snapshot.case_version !== 1
    || snapshot.status !== "open"
    || !sameSet(classification, BASE_CLASSIFICATION)
    || packet.schema_version !== PACKET_SCHEMA_VERSION
    || !sameSet(packetClassification, BASE_CLASSIFICATION)
    || action.schema_version !== PACKET_SCHEMA_VERSION
    || action.action_type !== ACTION
    || action.previous_case_version !== 0
    || action.resulting_case_version !== 1
    || action.legal_effect !== "none"
    || action.command_sha256 !== args.commandSha256
    || action.actor_id !== args.authorityFence.actorId
    || action.authority_id !== args.authorityFence.authorityId
    || action.authority_version !== args.authorityFence.authorityVersion
    || args.expectedCaseVersion !== 0
    || snapshot.municipality_cut !== args.authorityFence.municipalityCut
    || action.municipality_cut !== snapshot.municipality_cut
    || packet.municipality_cut !== snapshot.municipality_cut
    || action.case_id !== snapshot.case_id
    || packet.case_id !== snapshot.case_id
    || action.license_id !== snapshot.license_id
    || license.source_license_id !== snapshot.license_id
    || packetRef.packet_id !== packet.packet_id
    || actionPacketRef.packet_id !== packetRef.packet_id
    || packetRef.packet_content_sha256 !== reproduction.packet_content_sha256
    || actionPacketRef.packet_content_sha256 !== packetRef.packet_content_sha256
    || packetRef.primary_release_id !== actionPacketRef.primary_release_id
    || packetRef.packet_generated_at !== packet.generated_at
    || snapshot.created_at !== snapshot.updated_at
    || action.occurred_at !== snapshot.created_at
    || !validInstant(snapshot.created_at)
    || args.activeCaseKey !== `${snapshot.municipality_cut}:${snapshot.license_id}`
    || !sameSet(requiredMarkings, args.authorityFence.requiredMarkings)
  ) failIntegrity();
  const caseId = String(snapshot.case_id);
  const actionId = String(action.action_id);
  const packetId = String(packet.packet_id);
  const licenseId = String(snapshot.license_id);
  if (
    !IDENTIFIER.test(caseId)
    || !IDENTIFIER.test(actionId)
    || packetId.length === 0
    || !IDENTIFIER.test(licenseId)
    || !SHA256.test(String(packetRef.packet_content_sha256))
  ) failIntegrity();
  const primaryReleases = Array.isArray(packet.pinned_releases)
    ? packet.pinned_releases.filter((item) => record(item)?.capability === "patents.get")
    : [];
  const inputQueries = Array.isArray(reproduction.input_queries)
    ? reproduction.input_queries.filter((item) => record(item)?.capability === "patents.get")
    : [];
  const release = record(primaryReleases[0]);
  const query = record(inputQueries[0]);
  if (
    primaryReleases.length !== 1
    || inputQueries.length !== 1
    || release?.producer !== "inteligencia-inmobiliaria"
    || release.product !== "commercial-licenses"
    || release.release_id !== packetRef.primary_release_id
    || query?.producer !== "inteligencia-inmobiliaria"
    || query.release_id !== packetRef.primary_release_id
  ) failIntegrity();
  return {
    snapshot,
    action,
    packet,
    packetRef,
    packetId,
    caseId,
    actionId,
    licenseId,
    occurredAt: Date.parse(String(action.occurred_at)),
  };
}

export const commitOpenLicenseReview = internalMutation({
  args: { request: commitValidator },
  handler: async (ctx, args) => {
    const request = args.request;
    const decoded = decodePacketSnapshot(request.evidencePacketSnapshot);
    const validated = validateCommitPayload(request, decoded.json);
    const grantRows = await ctx.db
      .query("reviewAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", request.authorityFence.authorityId))
      .collect();
    const grant = await uniqueByIndex(grantRows);
    const evaluatedAt = Date.parse(request.authorityFence.evaluatedAt);
    const commitAt = Date.now();
    if (
      !grant
      || !Number.isFinite(evaluatedAt)
      || grant.authorityVersion !== request.authorityFence.authorityVersion
      || grant.actorId !== request.authorityFence.actorId
      || grant.municipalityCut !== request.authorityFence.municipalityCut
      || request.authorityFence.action !== ACTION
      || !grant.permittedActions.includes(ACTION)
      || !sameSet(validated.action.actor_roles as string[], grant.roles)
      || !request.authorityFence.requiredMarkings.every((item) => (
        grant.allowedMarkings.some((allowed) => allowed === item)
      ))
      || !grant.allowedRepresentations.includes(request.authorityFence.representation)
      || Date.parse(grant.validFrom) > commitAt
      || (grant.validTo !== undefined && Date.parse(grant.validTo) < commitAt)
      || grant.revokedAt !== undefined
    ) return { kind: "cas_conflict" as const };

    const writeLockRows = await ctx.db
      .query("reviewWriteLocks")
      .withIndex("by_lockKey", (q) => q.eq("lockKey", "review-write"))
      .collect();
    const writeLock = await uniqueByIndex(writeLockRows);
    if (!writeLock) return { kind: "cas_conflict" as const };

    const existingOperation = await findOperation(ctx, grant.actorId, request.operationKeySha256);
    if (existingOperation) {
      if (
        existingOperation.commandSha256 !== request.commandSha256
        || existingOperation.municipalityCut !== grant.municipalityCut
      ) return { kind: "operation_conflict" as const };
      return {
        kind: "replayed" as const,
        receipt: await loadReceipt(ctx, existingOperation),
      };
    }
    if (request.expectedCaseVersion !== 0) return { kind: "cas_conflict" as const };
    const activeCases = await ctx.db
      .query("reviewActiveCases")
      .withIndex("by_municipality_license", (q) => (
        q.eq("municipalityCut", grant.municipalityCut)
          .eq("licenseId", validated.licenseId)
      ))
      .collect();
    if (activeCases.length > 0) return { kind: "active_case_conflict" as const };

    const duplicateCases = await ctx.db
      .query("reviewCases")
      .withIndex("by_case_version", (q) => q.eq("caseId", validated.caseId).eq("caseVersion", 1))
      .collect();
    const duplicateActions = await ctx.db
      .query("reviewActions")
      .withIndex("by_actionId", (q) => q.eq("actionId", validated.actionId))
      .collect();
    const duplicatePackets = await ctx.db
      .query("reviewEvidencePackets")
      .withIndex("by_packetId", (q) => q.eq("packetId", validated.packetId))
      .collect();
    if (duplicateCases.length || duplicateActions.length || duplicatePackets.length) {
      return { kind: "cas_conflict" as const };
    }

    const touchedAt = Date.now();
    await ctx.db.patch(writeLock._id, { lastTouchedAt: touchedAt });
    await ctx.db.insert("reviewEvidencePackets", {
      packetId: validated.packetId,
      caseId: validated.caseId,
      caseVersion: 1,
      packetContentSha256: String(validated.packetRef.packet_content_sha256),
      primaryReleaseId: String(validated.packetRef.primary_release_id),
      nature: PACKET_NATURE,
      packetBytes: request.evidencePacketSnapshot.bytes,
      chunkCount: decoded.chunks.length,
      createdAt: validated.occurredAt,
    });
    for (const chunk of decoded.chunks) {
      await ctx.db.insert("reviewEvidencePacketChunks", {
        packetId: validated.packetId,
        ordinal: chunk.ordinal,
        encodedBase64: chunk.encodedBase64,
        byteLength: chunk.byteLength,
      });
    }
    await ctx.db.insert("reviewCases", {
      caseId: validated.caseId,
      caseVersion: 1,
      municipalityCut: grant.municipalityCut,
      licenseId: validated.licenseId,
      status: "open",
      snapshotJson: JSON.stringify(validated.snapshot),
      packetId: validated.packetId,
      createdAt: validated.occurredAt,
      updatedAt: validated.occurredAt,
    });
    await ctx.db.insert("reviewActiveCases", {
      municipalityCut: grant.municipalityCut,
      licenseId: validated.licenseId,
      caseId: validated.caseId,
      caseVersion: 1,
      openedAt: validated.occurredAt,
    });
    await ctx.db.insert("reviewActions", {
      actionId: validated.actionId,
      caseId: validated.caseId,
      actionType: ACTION,
      resultingCaseVersion: 1,
      actorId: grant.actorId,
      legalEffect: "none",
      actionJson: JSON.stringify(validated.action),
      occurredAt: validated.occurredAt,
    });
    await ctx.db.insert("reviewOperations", {
      actorId: grant.actorId,
      actionType: ACTION,
      operationKeySha256: request.operationKeySha256,
      commandSha256: request.commandSha256,
      municipalityCut: grant.municipalityCut,
      caseId: validated.caseId,
      actionId: validated.actionId,
      createdAt: validated.occurredAt,
    });
    return { kind: "committed" as const };
  },
});

function validateAssignmentGrant(args: {
  authorityId: string; authorityVersion: number; actorId: string; municipalityCut: string;
  roles: string[]; permittedActions: string[]; validFrom: string;
  validTo: string | null; revokedAt: string | null;
}): void {
  if (
    !IDENTIFIER.test(args.authorityId)
    || !Number.isSafeInteger(args.authorityVersion) || args.authorityVersion < 1
    || !IDENTIFIER.test(args.actorId) || !CUT.test(args.municipalityCut)
    || !sameSet(args.roles, ["coordinator"])
    || !sameSet(args.permittedActions, [ASSIGN_ACTION])
    || !validInstant(args.validFrom)
    || (args.validTo !== null && (!validInstant(args.validTo)
      || Date.parse(args.validTo) <= Date.parse(args.validFrom)))
    || (args.revokedAt !== null && !validInstant(args.revokedAt))
  ) throw new ConvexError("INVALID_ASSIGNMENT_AUTHORITY_GRANT");
}

function validateReviewerGrant(args: {
  reviewerId: string; reviewerVersion: number; municipalityCut: string; eligible: boolean;
  validFrom: string; validTo: string | null; revokedAt: string | null;
}): void {
  if (
    !IDENTIFIER.test(args.reviewerId)
    || !Number.isSafeInteger(args.reviewerVersion) || args.reviewerVersion < 1
    || !CUT.test(args.municipalityCut) || typeof args.eligible !== "boolean"
    || !validInstant(args.validFrom)
    || (args.validTo !== null && (!validInstant(args.validTo)
      || Date.parse(args.validTo) <= Date.parse(args.validFrom)))
    || (args.revokedAt !== null && !validInstant(args.revokedAt))
  ) throw new ConvexError("INVALID_REVIEWER_ELIGIBILITY_GRANT");
}

async function touchWriteLock(ctx: MutationCtx, now: number): Promise<void> {
  const rows = await ctx.db.query("reviewWriteLocks")
    .withIndex("by_lockKey", (q) => q.eq("lockKey", "review-write")).collect();
  const lock = await uniqueByIndex(rows);
  if (!lock) throw new ConvexError("REVIEW_WRITE_LOCK_NOT_SEEDED");
  await ctx.db.patch(lock._id, { lastTouchedAt: now });
}

export const upsertAssignmentAuthorityGrant = internalMutation({
  args: assignmentAuthorityGrantValidator,
  handler: async (ctx, args) => {
    validateAssignmentGrant(args);
    const rows = await ctx.db.query("reviewAssignmentAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", args.authorityId)).collect();
    const existing = await uniqueByIndex(rows);
    if (existing && (
      existing.actorId !== args.actorId || existing.municipalityCut !== args.municipalityCut
      || args.authorityVersion <= existing.authorityVersion
    )) throw new ConvexError("INVALID_ASSIGNMENT_AUTHORITY_ADVANCE");
    const now = Date.now();
    const value = {
      ...args,
      validTo: args.validTo ?? undefined,
      revokedAt: args.revokedAt ?? undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("reviewAssignmentAuthorityGrants", value);
    await touchWriteLock(ctx, now);
    return { authorityId: args.authorityId, authorityVersion: args.authorityVersion };
  },
});

export const upsertReviewerEligibilityGrant = internalMutation({
  args: reviewerEligibilityGrantValidator,
  handler: async (ctx, args) => {
    validateReviewerGrant(args);
    const rows = await ctx.db.query("reviewReviewerEligibilityGrants")
      .withIndex("by_reviewer_municipality", (q) => q
        .eq("reviewerId", args.reviewerId).eq("municipalityCut", args.municipalityCut))
      .collect();
    const existing = await uniqueByIndex(rows);
    if (existing && args.reviewerVersion <= existing.reviewerVersion) {
      throw new ConvexError("INVALID_REVIEWER_ELIGIBILITY_ADVANCE");
    }
    const now = Date.now();
    const value = {
      ...args,
      validTo: args.validTo ?? undefined,
      revokedAt: args.revokedAt ?? undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("reviewReviewerEligibilityGrants", value);
    await touchWriteLock(ctx, now);
    return { reviewerId: args.reviewerId, reviewerVersion: args.reviewerVersion };
  },
});

async function findAssignmentOperation(
  ctx: QueryCtx | MutationCtx,
  actorId: string,
  operationKeySha256: string,
) {
  const rows = await ctx.db.query("reviewOperations")
    .withIndex("by_actor_action_key", (q) => q.eq("actorId", actorId)
      .eq("actionType", ASSIGN_ACTION).eq("operationKeySha256", operationKeySha256))
    .collect();
  return await uniqueByIndex(rows);
}

async function loadAssignmentReceipt(
  ctx: QueryCtx | MutationCtx,
  binding: { caseId: string; actionId: string },
): Promise<JsonRecord> {
  const actionRows = await ctx.db.query("reviewActions")
    .withIndex("by_actionId", (q) => q.eq("actionId", binding.actionId)).collect();
  const actionRow = await uniqueByIndex(actionRows);
  if (!actionRow || actionRow.caseId !== binding.caseId || actionRow.actionType !== ASSIGN_ACTION) {
    return failIntegrity();
  }
  const caseRows = await ctx.db.query("reviewCases")
    .withIndex("by_case_version", (q) => q.eq("caseId", binding.caseId)
      .eq("caseVersion", actionRow.resultingCaseVersion)).collect();
  const caseRow = await uniqueByIndex(caseRows);
  if (!caseRow) return failIntegrity();
  try {
    return {
      schema_version: PACKET_SCHEMA_VERSION,
      case: JSON.parse(caseRow.snapshotJson),
      action: JSON.parse(actionRow.actionJson),
      replayed: false,
    };
  } catch {
    return failIntegrity();
  }
}

export const readAssignReviewerOperation = internalQuery({
  args: { lookup: assignmentLookupValidator },
  handler: async (ctx, args) => {
    validateLookup(args.lookup);
    const binding = await findAssignmentOperation(
      ctx, args.lookup.actorId, args.lookup.operationKeySha256,
    );
    if (!binding) return { kind: "miss" as const };
    if (binding.commandSha256 !== args.lookup.commandSha256
      || binding.municipalityCut !== args.lookup.municipalityCut) {
      return { kind: "operation_conflict" as const };
    }
    return { kind: "replayed" as const, receipt: await loadAssignmentReceipt(ctx, binding) };
  },
});

export const readReviewCaseSnapshotForAssignment = internalQuery({
  args: { lookup: assignmentSnapshotLookupValidator },
  handler: async (ctx, args) => {
    if (!IDENTIFIER.test(args.lookup.caseId) || !Number.isSafeInteger(args.lookup.caseVersion)
      || args.lookup.caseVersion < 1 || !CUT.test(args.lookup.municipalityCut)) failIntegrity();
    const rows = await ctx.db.query("reviewCases")
      .withIndex("by_case_version", (q) => q.eq("caseId", args.lookup.caseId)
        .eq("caseVersion", args.lookup.caseVersion)).collect();
    const row = await uniqueByIndex(rows);
    if (!row || row.municipalityCut !== args.lookup.municipalityCut) return null;
    try {
      return JSON.parse(row.snapshotJson);
    } catch {
      return failIntegrity();
    }
  },
});

function sameJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function validateAssignmentCommit(request: {
  operationKeySha256: string; commandSha256: string; expectedCaseVersion: number;
  previousCaseSnapshot: unknown; resultingCaseSnapshot: unknown; action: unknown;
  authorityFence: { authorityId: string; authorityVersion: number; actorId: string;
    municipalityCut: string; action: string; evaluatedAt: string };
  reviewerFence: { reviewerId: string; municipalityCut: string; evaluatedAt: string };
}) {
  validateLookup({
    operationKeySha256: request.operationKeySha256,
    commandSha256: request.commandSha256,
    actorId: request.authorityFence.actorId,
    municipalityCut: request.authorityFence.municipalityCut,
  });
  const previous = record(request.previousCaseSnapshot);
  const resulting = record(request.resultingCaseSnapshot);
  const action = record(request.action);
  const previousRef = record(previous?.packet_ref);
  const resultingRef = record(resulting?.packet_ref);
  const actionRef = record(action?.packet_ref);
  const assignment = record(resulting?.assignment);
  const actorRoles = stringArray(action?.actor_roles);
  if (!previous || !resulting || !action || !previousRef || !resultingRef || !actionRef
    || !assignment || !actorRoles
    || request.authorityFence.action !== ASSIGN_ACTION
    || request.expectedCaseVersion !== previous.case_version
    || !Number.isSafeInteger(previous.case_version)
    || resulting.case_version !== Number(previous.case_version) + 1
    || previous.status !== "open" || resulting.status !== "in_review"
    || previous.case_id !== resulting.case_id || previous.case_id !== action.case_id
    || previous.municipality_cut !== resulting.municipality_cut
    || previous.municipality_cut !== action.municipality_cut
    || previous.municipality_cut !== request.authorityFence.municipalityCut
    || previous.municipality_cut !== request.reviewerFence.municipalityCut
    || previous.license_id !== resulting.license_id || previous.license_id !== action.license_id
    || resulting.created_at !== previous.created_at || resulting.updated_at !== action.occurred_at
    || request.authorityFence.evaluatedAt !== action.occurred_at
    || request.reviewerFence.evaluatedAt !== action.occurred_at
    || action.action_type !== ASSIGN_ACTION || action.previous_case_version !== previous.case_version
    || action.resulting_case_version !== resulting.case_version || action.legal_effect !== "none"
    || action.command_sha256 !== request.commandSha256
    || action.actor_id !== request.authorityFence.actorId
    || action.authority_id !== request.authorityFence.authorityId
    || action.authority_version !== request.authorityFence.authorityVersion
    || assignment.reviewer_id !== request.reviewerFence.reviewerId
    || assignment.reviewer_id !== action.reviewer_id
    || assignment.assigned_by !== request.authorityFence.actorId
    || assignment.assigned_at !== action.occurred_at
    || !sameSet(actorRoles, ["coordinator"])
    || !sameJson(previousRef, resultingRef) || !sameJson(previousRef, actionRef)
    || !validInstant(action.occurred_at) || !SHA256.test(request.commandSha256)
  ) failIntegrity();
  const caseId = String(previous.case_id);
  const licenseId = String(previous.license_id);
  const actionId = String(action.action_id);
  if (!IDENTIFIER.test(caseId) || !IDENTIFIER.test(licenseId) || !IDENTIFIER.test(actionId)) {
    failIntegrity();
  }
  return { previous, resulting, action, caseId, licenseId, actionId,
    occurredAt: Date.parse(String(action.occurred_at)) };
}

export const commitAssignReviewer = internalMutation({
  args: { request: assignmentCommitValidator },
  handler: async (ctx, args) => {
    const request = args.request;
    const validated = validateAssignmentCommit(request);
    const authorityRows = await ctx.db.query("reviewAssignmentAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", request.authorityFence.authorityId))
      .collect();
    const authority = await uniqueByIndex(authorityRows);
    const reviewerRows = await ctx.db.query("reviewReviewerEligibilityGrants")
      .withIndex("by_reviewer_municipality", (q) => q
        .eq("reviewerId", request.reviewerFence.reviewerId)
        .eq("municipalityCut", request.reviewerFence.municipalityCut)).collect();
    const reviewer = await uniqueByIndex(reviewerRows);
    const now = Date.now();
    if (!authority || !reviewer
      || authority.authorityVersion !== request.authorityFence.authorityVersion
      || authority.actorId !== request.authorityFence.actorId
      || authority.municipalityCut !== request.authorityFence.municipalityCut
      || !sameSet(authority.roles, ["coordinator"])
      || !sameSet(authority.permittedActions, [ASSIGN_ACTION])
      || Date.parse(authority.validFrom) > now
      || (authority.validTo !== undefined && Date.parse(authority.validTo) < now)
      || authority.revokedAt !== undefined
      || !reviewer.eligible || Date.parse(reviewer.validFrom) > now
      || (reviewer.validTo !== undefined && Date.parse(reviewer.validTo) < now)
      || reviewer.revokedAt !== undefined) return { kind: "cas_conflict" as const };

    const lockRows = await ctx.db.query("reviewWriteLocks")
      .withIndex("by_lockKey", (q) => q.eq("lockKey", "review-write")).collect();
    const lock = await uniqueByIndex(lockRows);
    if (!lock) return { kind: "cas_conflict" as const };
    const existingOperation = await findAssignmentOperation(
      ctx, authority.actorId, request.operationKeySha256,
    );
    if (existingOperation) {
      if (existingOperation.commandSha256 !== request.commandSha256
        || existingOperation.municipalityCut !== authority.municipalityCut) {
        return { kind: "operation_conflict" as const };
      }
      return { kind: "replayed" as const,
        receipt: await loadAssignmentReceipt(ctx, existingOperation) };
    }
    const priorRows = await ctx.db.query("reviewCases")
      .withIndex("by_case_version", (q) => q.eq("caseId", validated.caseId)
        .eq("caseVersion", request.expectedCaseVersion)).collect();
    const prior = await uniqueByIndex(priorRows);
    const activeRows = await ctx.db.query("reviewActiveCases")
      .withIndex("by_case_version", (q) => q.eq("caseId", validated.caseId)
        .eq("caseVersion", request.expectedCaseVersion)).collect();
    const active = await uniqueByIndex(activeRows);
    if (!prior || !active || prior.municipalityCut !== authority.municipalityCut
      || active.municipalityCut !== authority.municipalityCut
      || prior.snapshotJson !== JSON.stringify(validated.previous)
      || active.licenseId !== validated.licenseId) return { kind: "cas_conflict" as const };
    const nextVersion = request.expectedCaseVersion + 1;
    const duplicateCases = await ctx.db.query("reviewCases")
      .withIndex("by_case_version", (q) => q.eq("caseId", validated.caseId)
        .eq("caseVersion", nextVersion)).collect();
    const duplicateActions = await ctx.db.query("reviewActions")
      .withIndex("by_actionId", (q) => q.eq("actionId", validated.actionId)).collect();
    if (duplicateCases.length || duplicateActions.length) return { kind: "cas_conflict" as const };

    await ctx.db.patch(lock._id, { lastTouchedAt: now });
    await ctx.db.insert("reviewCases", {
      caseId: validated.caseId, caseVersion: nextVersion,
      municipalityCut: authority.municipalityCut, licenseId: validated.licenseId,
      status: "in_review", snapshotJson: JSON.stringify(validated.resulting),
      packetId: prior.packetId, createdAt: prior.createdAt, updatedAt: validated.occurredAt,
    });
    await ctx.db.patch(active._id, { caseVersion: nextVersion });
    await ctx.db.insert("reviewActions", {
      actionId: validated.actionId, caseId: validated.caseId, actionType: ASSIGN_ACTION,
      resultingCaseVersion: nextVersion, actorId: authority.actorId, legalEffect: "none",
      actionJson: JSON.stringify(validated.action), occurredAt: validated.occurredAt,
    });
    await ctx.db.insert("reviewOperations", {
      actorId: authority.actorId, actionType: ASSIGN_ACTION,
      operationKeySha256: request.operationKeySha256, commandSha256: request.commandSha256,
      municipalityCut: authority.municipalityCut, caseId: validated.caseId,
      actionId: validated.actionId, createdAt: validated.occurredAt,
    });
    return { kind: "committed" as const };
  },
});

const WORKFLOW_ACTIONS = new Set([
  "OpenLicenseReview", "AssignReviewer", "NoObservations", "RequestMissingRequirement",
  "RecordAlternativeExplanation",
  "RecommendInspection", "RecommendReferral", "RecordInspectionOutcome",
  "RecommendAdministrativeMeasure", "RecordOfficialDecision", "RequestCorrection",
  "CloseReview",
]);
const WORKFLOW_ROLES = new Set(["rentas", "control", "coordinator", "fiscalizacion"]);
const WORKFLOW_LEGAL_EFFECTS = new Set([
  "none", "external_communication_only", "reflects_external_act",
]);
const WORKFLOW_REVIEWER_ACTIONS = new Set([
  "NoObservations", "RequestMissingRequirement", "RecordAlternativeExplanation",
  "RecommendInspection", "RecommendReferral", "RecordInspectionOutcome",
  "RecommendAdministrativeMeasure", "RequestCorrection",
]);
const WORKFLOW_ACTION_ROLES: Record<string, readonly string[]> = {
  NoObservations: ["rentas", "control"],
  RequestMissingRequirement: ["rentas", "control"],
  RecordAlternativeExplanation: ["rentas", "control"],
  RecommendInspection: ["control", "fiscalizacion"],
  RecommendReferral: ["control", "fiscalizacion"],
  RecordInspectionOutcome: ["control", "fiscalizacion"],
  RecommendAdministrativeMeasure: ["control", "fiscalizacion"],
  RecordOfficialDecision: ["control", "coordinator"],
  RequestCorrection: ["rentas", "control"],
  CloseReview: ["control", "coordinator"],
};

// One operator-facing transaction provisions the compatible authority rows
// required by the opening, assignment and post-assignment write fences.
export const provisionWorkflowActor = internalMutation({
  args: {
    actorId: v.string(), municipalityCut: v.string(), authorityVersion: v.number(),
    roles: v.array(v.string()), validFrom: v.string(),
  },
  handler: async (ctx, args) => {
    if (!IDENTIFIER.test(args.actorId) || !CUT.test(args.municipalityCut)
      || !Number.isSafeInteger(args.authorityVersion) || args.authorityVersion < 1
      || args.roles.length === 0 || new Set(args.roles).size !== args.roles.length
      || args.roles.some((role) => !WORKFLOW_ROLES.has(role)) || !validInstant(args.validFrom)
      || (args.roles.includes("coordinator") && args.roles.length !== 1)) {
      throw new ConvexError("INVALID_WORKFLOW_ACTOR");
    }
    const authorityId = `integrity:${args.municipalityCut}:${args.actorId}`;
    const permittedActions = [...new Set([
      ...(args.roles.some((role) => role === "rentas" || role === "control")
        ? ["OpenLicenseReview"] : []),
      ...(args.roles.includes("coordinator") ? ["AssignReviewer"] : []),
      ...Object.entries(WORKFLOW_ACTION_ROLES)
        .filter(([, roles]) => args.roles.some((role) => roles.includes(role)))
        .map(([action]) => action),
    ])];
    const existingWorkflowRows = await ctx.db.query("reviewWorkflowAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", authorityId)).collect();
    const existingWorkflow = await uniqueByIndex(existingWorkflowRows);
    if (existingWorkflow && args.authorityVersion <= existingWorkflow.authorityVersion) {
      throw new ConvexError("INVALID_WORKFLOW_AUTHORITY_ADVANCE");
    }
    const now = Date.now();
    const workflowValue = {
      authorityId, authorityVersion: args.authorityVersion, actorId: args.actorId,
      municipalityCut: args.municipalityCut, roles: args.roles,
      permittedActions, validFrom: args.validFrom, updatedAt: now,
    } as any;
    if (existingWorkflow) await ctx.db.replace(existingWorkflow._id, workflowValue);
    else await ctx.db.insert("reviewWorkflowAuthorityGrants", workflowValue);

    const reviewerRoles = args.roles.filter((role) => role === "rentas" || role === "control");
    if (reviewerRoles.length > 0) {
      const openingRows = await ctx.db.query("reviewAuthorityGrants")
        .withIndex("by_authorityId", (q) => q.eq("authorityId", authorityId)).collect();
      const opening = await uniqueByIndex(openingRows);
      const openingValue = {
        authorityId, authorityVersion: args.authorityVersion, actorId: args.actorId,
        municipalityCut: args.municipalityCut, roles: reviewerRoles,
        permittedActions: [ACTION],
        allowedMarkings: ["PUBLIC", "MUNICIPAL_INTERNAL", "ACTIVE_REVIEW"],
        allowedRepresentations: ["public"], validFrom: args.validFrom, updatedAt: now,
      } as any;
      if (opening) await ctx.db.replace(opening._id, openingValue);
      else await ctx.db.insert("reviewAuthorityGrants", openingValue);
    }
    if (args.roles.includes("coordinator")) {
      const assignmentRows = await ctx.db.query("reviewAssignmentAuthorityGrants")
        .withIndex("by_authorityId", (q) => q.eq("authorityId", authorityId)).collect();
      const assignment = await uniqueByIndex(assignmentRows);
      const assignmentValue = {
        authorityId, authorityVersion: args.authorityVersion, actorId: args.actorId,
        municipalityCut: args.municipalityCut, roles: ["coordinator"],
        permittedActions: [ASSIGN_ACTION], validFrom: args.validFrom, updatedAt: now,
      } as any;
      if (assignment) await ctx.db.replace(assignment._id, assignmentValue);
      else await ctx.db.insert("reviewAssignmentAuthorityGrants", assignmentValue);
    }
    if (args.roles.some((role) => ["rentas", "control", "fiscalizacion"].includes(role))) {
      const reviewerRows = await ctx.db.query("reviewReviewerEligibilityGrants")
        .withIndex("by_reviewer_municipality", (q) => q.eq("reviewerId", args.actorId)
          .eq("municipalityCut", args.municipalityCut)).collect();
      const reviewer = await uniqueByIndex(reviewerRows);
      const reviewerValue = {
        reviewerId: args.actorId, reviewerVersion: args.authorityVersion,
        municipalityCut: args.municipalityCut, eligible: true,
        validFrom: args.validFrom, updatedAt: now,
      };
      if (reviewer) await ctx.db.replace(reviewer._id, reviewerValue);
      else await ctx.db.insert("reviewReviewerEligibilityGrants", reviewerValue);
    }
    await touchWriteLock(ctx, now);
    return { authorityId, authorityVersion: args.authorityVersion, permittedActions };
  },
});

function expectedWorkflowStatus(action: string): string {
  if (action === "CloseReview") return "closed";
  if (action === "RequestMissingRequirement" || action === "RequestCorrection") {
    return "waiting_external";
  }
  return "in_review";
}

export const upsertWorkflowAuthorityGrant = internalMutation({
  args: {
    authorityId: v.string(), authorityVersion: v.number(), actorId: v.string(),
    municipalityCut: v.string(), roles: v.array(v.string()),
    permittedActions: v.array(v.string()), validFrom: v.string(),
    validTo: v.union(v.string(), v.null()), revokedAt: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    if (!IDENTIFIER.test(args.authorityId) || !IDENTIFIER.test(args.actorId)
      || !CUT.test(args.municipalityCut) || !Number.isSafeInteger(args.authorityVersion)
      || args.authorityVersion < 1 || args.roles.length === 0
      || new Set(args.roles).size !== args.roles.length
      || args.roles.some((role) => !WORKFLOW_ROLES.has(role))
      || args.permittedActions.length === 0
      || new Set(args.permittedActions).size !== args.permittedActions.length
      || args.permittedActions.some((action) => !WORKFLOW_ACTIONS.has(action))
      || !validInstant(args.validFrom)
      || (args.validTo !== null && (!validInstant(args.validTo)
        || Date.parse(args.validTo) <= Date.parse(args.validFrom)))
      || (args.revokedAt !== null && !validInstant(args.revokedAt))) {
      throw new ConvexError("INVALID_WORKFLOW_AUTHORITY_GRANT");
    }
    const rows = await ctx.db.query("reviewWorkflowAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", args.authorityId)).collect();
    const existing = await uniqueByIndex(rows);
    if (existing && (existing.actorId !== args.actorId
      || existing.municipalityCut !== args.municipalityCut
      || args.authorityVersion <= existing.authorityVersion)) {
      throw new ConvexError("INVALID_WORKFLOW_AUTHORITY_ADVANCE");
    }
    const value = {
      authorityId: args.authorityId, authorityVersion: args.authorityVersion,
      actorId: args.actorId, municipalityCut: args.municipalityCut,
      roles: args.roles, permittedActions: args.permittedActions,
      validFrom: args.validFrom, validTo: args.validTo ?? undefined,
      revokedAt: args.revokedAt ?? undefined, updatedAt: Date.now(),
    } as any;
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("reviewWorkflowAuthorityGrants", value);
    await touchWriteLock(ctx, Date.now());
    return { authorityId: args.authorityId, authorityVersion: args.authorityVersion };
  },
});

export const readWorkflowAuthorityGrant = internalQuery({
  args: { actorId: v.string(), municipalityCut: v.string() },
  handler: async (ctx, args) => {
    if (!IDENTIFIER.test(args.actorId) || !CUT.test(args.municipalityCut)) failIntegrity();
    const rows = await ctx.db.query("reviewWorkflowAuthorityGrants")
      .withIndex("by_actor_municipality", (q) => q.eq("actorId", args.actorId)
        .eq("municipalityCut", args.municipalityCut)).collect();
    const grant = await uniqueByIndex(rows);
    if (!grant) return null;
    return {
      authority_id: grant.authorityId, authority_version: grant.authorityVersion,
      actor_id: grant.actorId, municipality_cut: grant.municipalityCut,
      roles: grant.roles, permitted_actions: grant.permittedActions,
      valid_from: grant.validFrom, valid_to: grant.validTo ?? null,
      revoked_at: grant.revokedAt ?? null,
    };
  },
});

function decodeStoredPacket(chunks: { ordinal: number; encodedBase64: string; byteLength: number }[]): string {
  const ordered = [...chunks].sort((a, b) => a.ordinal - b.ordinal);
  if (ordered.some((chunk, index) => chunk.ordinal !== index)) failIntegrity();
  try {
    const binary = ordered.map((chunk) => {
      const value = atob(chunk.encodedBase64);
      if (value.length !== chunk.byteLength) failIntegrity();
      return value;
    }).join("");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return failIntegrity();
  }
}

export const readReviewCaseDossier = internalQuery({
  args: {
    caseId: v.string(), caseVersion: v.number(), municipalityCut: v.string(),
    actorId: v.string(), maxPacketBytes: v.number(),
  },
  handler: async (ctx, args) => {
    if (!IDENTIFIER.test(args.caseId) || !IDENTIFIER.test(args.actorId)
      || !CUT.test(args.municipalityCut) || !Number.isSafeInteger(args.caseVersion)
      || args.caseVersion < 1 || !Number.isSafeInteger(args.maxPacketBytes)
      || args.maxPacketBytes < 1 || args.maxPacketBytes > REVIEW_PACKET_MAX_BYTES) failIntegrity();
    const authorityRows = await ctx.db.query("reviewWorkflowAuthorityGrants")
      .withIndex("by_actor_municipality", (q) => q.eq("actorId", args.actorId)
        .eq("municipalityCut", args.municipalityCut)).collect();
    const authority = await uniqueByIndex(authorityRows);
    const now = Date.now();
    if (!authority || authority.revokedAt !== undefined || Date.parse(authority.validFrom) > now
      || (authority.validTo !== undefined && Date.parse(authority.validTo) < now)) return null;
    const rows = await ctx.db.query("reviewCases").withIndex("by_case_version", (q) => q
      .eq("caseId", args.caseId).eq("caseVersion", args.caseVersion)).collect();
    const row = await uniqueByIndex(rows);
    if (!row || row.municipalityCut !== args.municipalityCut) return null;
    const packetRows = await ctx.db.query("reviewEvidencePackets")
      .withIndex("by_packetId", (q) => q.eq("packetId", row.packetId)).collect();
    const packet = await uniqueByIndex(packetRows);
    if (!packet || packet.packetBytes > args.maxPacketBytes) failIntegrity();
    const chunks = await ctx.db.query("reviewEvidencePacketChunks")
      .withIndex("by_packet_ordinal", (q) => q.eq("packetId", row.packetId)).collect();
    if (chunks.length !== packet.chunkCount) failIntegrity();
    const actionRows = await ctx.db.query("reviewActions")
      .withIndex("by_case_version", (q) => q.eq("caseId", args.caseId)).collect();
    const actions = actionRows.filter((action) => action.resultingCaseVersion <= args.caseVersion)
      .sort((a, b) => a.resultingCaseVersion - b.resultingCaseVersion);
    return {
      caseJson: row.snapshotJson,
      evidencePacketJson: decodeStoredPacket(chunks),
      actionJson: actions.map((action) => action.actionJson),
    };
  },
});

async function findWorkflowOperation(
  ctx: QueryCtx | MutationCtx, actorId: string, actionType: string, operationKeySha256: string,
) {
  const rows = await ctx.db.query("reviewOperations").withIndex("by_actor_action_key", (q) => q
    .eq("actorId", actorId).eq("actionType", actionType as any)
    .eq("operationKeySha256", operationKeySha256)).collect();
  return await uniqueByIndex(rows);
}

export const readReviewActionOperation = internalQuery({
  args: { actorId: v.string(), municipalityCut: v.string(), actionType: v.string(),
    operationKeySha256: v.string(), commandSha256: v.string() },
  handler: async (ctx, args) => {
    validateLookup(args);
    if (!WORKFLOW_ACTIONS.has(args.actionType)) failIntegrity();
    const binding = await findWorkflowOperation(
      ctx, args.actorId, args.actionType, args.operationKeySha256,
    );
    if (!binding) return { kind: "miss" as const };
    if (binding.commandSha256 !== args.commandSha256
      || binding.municipalityCut !== args.municipalityCut) {
      return { kind: "operation_conflict" as const };
    }
    const actionRows = await ctx.db.query("reviewActions")
      .withIndex("by_actionId", (q) => q.eq("actionId", binding.actionId)).collect();
    const storedAction = await uniqueByIndex(actionRows);
    if (!storedAction || storedAction.caseId !== binding.caseId) failIntegrity();
    const cases = await ctx.db.query("reviewCases").withIndex("by_case_version", (q) => q
      .eq("caseId", binding.caseId)
      .eq("caseVersion", storedAction.resultingCaseVersion)).collect();
    const storedCase = await uniqueByIndex(cases);
    if (!storedCase) failIntegrity();
    return { kind: "replayed" as const, caseJson: storedCase.snapshotJson,
      actionId: binding.actionId };
  },
});

export const commitReviewAction = internalMutation({
  args: { request: v.any() },
  handler: async (ctx, args) => {
    const request = record(args.request);
    const previous = record(request?.previousCaseSnapshot);
    const resulting = record(request?.resultingCaseSnapshot);
    const action = record(request?.action);
    const fence = record(request?.authorityFence);
    const actorRoles = stringArray(action?.actor_roles);
    const actionType = String(action?.action_type ?? "");
    const assignment = record(previous?.assignment);
    const resultingAssignment = record(resulting?.assignment);
    const previousPacketRef = record(previous?.packet_ref);
    const resultingPacketRef = record(resulting?.packet_ref);
    const officialOutcome = record(resulting?.official_outcome);
    const allowedRoles = WORKFLOW_ACTION_ROLES[actionType] ?? [];
    if (!request || !previous || !resulting || !action || !fence || !actorRoles
      || !WORKFLOW_ACTIONS.has(actionType)
      || !SHA256.test(String(request.operationKeySha256))
      || !SHA256.test(String(request.commandSha256))
      || action.command_sha256 !== request.commandSha256
      || action.case_id !== previous.case_id || resulting.case_id !== previous.case_id
      || action.municipality_cut !== previous.municipality_cut
      || resulting.municipality_cut !== previous.municipality_cut
      || action.license_id !== previous.license_id || resulting.license_id !== previous.license_id
      || previous.status === "closed" || resulting.status !== expectedWorkflowStatus(actionType)
      || previous.created_at !== resulting.created_at
      || !previousPacketRef || !resultingPacketRef
      || !sameJson(previousPacketRef, resultingPacketRef)
      || !sameJson(assignment, resultingAssignment)
      || request.expectedCaseVersion !== previous.case_version
      || action.previous_case_version !== previous.case_version
      || action.resulting_case_version !== Number(previous.case_version) + 1
      || resulting.case_version !== action.resulting_case_version
      || resulting.updated_at !== action.occurred_at || !validInstant(action.occurred_at)
      || fence.actorId !== action.actor_id || fence.authorityId !== action.authority_id
      || fence.authorityVersion !== action.authority_version
      || fence.municipalityCut !== previous.municipality_cut || fence.action !== actionType
      || fence.evaluatedAt !== action.occurred_at
      || !WORKFLOW_LEGAL_EFFECTS.has(String(action.legal_effect))
      || !actorRoles.some((role) => allowedRoles.includes(role))
      || (WORKFLOW_REVIEWER_ACTIONS.has(actionType)
        && assignment?.reviewer_id !== action.actor_id)
      || (actionType === "RecordOfficialDecision" && (
        action.legal_effect !== "reflects_external_act"
        || typeof action.outcome_code !== "string" || action.outcome_code.length === 0
        || typeof action.external_reference !== "string" || action.external_reference.length === 0
        || officialOutcome?.outcome_code !== action.outcome_code
        || officialOutcome.external_reference !== action.external_reference
        || officialOutcome.recorded_by !== action.actor_id
        || officialOutcome.recorded_at !== action.occurred_at
      ))
      || (actionType === "CloseReview" && (
        resulting.closed_at !== action.occurred_at
        || (previous.last_action_type !== "NoObservations" && previous.official_outcome === undefined)
      ))
      || (actionType !== "CloseReview" && resulting.closed_at !== undefined)
      || resulting.last_action_type !== actionType) failIntegrity();
    const caseId = String(previous.case_id);
    const actionId = String(action.action_id);
    const actorId = String(action.actor_id);
    const municipalityCut = String(previous.municipality_cut);
    const occurredAt = Date.parse(String(action.occurred_at));
    if (!IDENTIFIER.test(caseId) || !IDENTIFIER.test(actionId) || !IDENTIFIER.test(actorId)
      || !CUT.test(municipalityCut)) failIntegrity();
    const grants = await ctx.db.query("reviewWorkflowAuthorityGrants")
      .withIndex("by_authorityId", (q) => q.eq("authorityId", String(fence.authorityId))).collect();
    const grant = await uniqueByIndex(grants);
    const now = Date.now();
    if (!grant || grant.authorityVersion !== fence.authorityVersion || grant.actorId !== actorId
      || grant.municipalityCut !== municipalityCut || !grant.permittedActions.includes(actionType as any)
      || !sameSet(grant.roles, actorRoles) || Date.parse(grant.validFrom) > now
      || (grant.validTo !== undefined && Date.parse(grant.validTo) < now)
      || grant.revokedAt !== undefined) return { kind: "cas_conflict" as const };
    const operation = await findWorkflowOperation(
      ctx, actorId, actionType, String(request.operationKeySha256),
    );
    if (operation) {
      if (operation.commandSha256 !== request.commandSha256
        || operation.municipalityCut !== municipalityCut) {
        return { kind: "operation_conflict" as const };
      }
      const operationActions = await ctx.db.query("reviewActions")
        .withIndex("by_actionId", (q) => q.eq("actionId", operation.actionId)).collect();
      const operationAction = await uniqueByIndex(operationActions);
      if (!operationAction) failIntegrity();
      const operationCases = await ctx.db.query("reviewCases").withIndex("by_case_version", (q) => q
        .eq("caseId", operation.caseId)
        .eq("caseVersion", operationAction.resultingCaseVersion)).collect();
      const operationCase = await uniqueByIndex(operationCases);
      if (!operationCase) failIntegrity();
      return { kind: "replayed" as const, caseJson: operationCase.snapshotJson,
        actionId: operation.actionId };
    }
    const priorRows = await ctx.db.query("reviewCases").withIndex("by_case_version", (q) => q
      .eq("caseId", caseId).eq("caseVersion", Number(previous.case_version))).collect();
    const prior = await uniqueByIndex(priorRows);
    const activeRows = await ctx.db.query("reviewActiveCases").withIndex("by_case_version", (q) => q
      .eq("caseId", caseId).eq("caseVersion", Number(previous.case_version))).collect();
    const active = await uniqueByIndex(activeRows);
    if (!prior || !active || prior.snapshotJson !== JSON.stringify(previous)
      || prior.municipalityCut !== municipalityCut) return { kind: "cas_conflict" as const };
    const duplicate = await ctx.db.query("reviewCases").withIndex("by_case_version", (q) => q
      .eq("caseId", caseId).eq("caseVersion", Number(resulting.case_version))).collect();
    const duplicateAction = await ctx.db.query("reviewActions")
      .withIndex("by_actionId", (q) => q.eq("actionId", actionId)).collect();
    if (duplicate.length || duplicateAction.length) return { kind: "cas_conflict" as const };
    await touchWriteLock(ctx, now);
    await ctx.db.insert("reviewCases", {
      caseId, caseVersion: Number(resulting.case_version), municipalityCut,
      licenseId: String(previous.license_id), status: String(resulting.status) as any,
      snapshotJson: JSON.stringify(resulting), packetId: prior.packetId,
      createdAt: prior.createdAt, updatedAt: occurredAt,
    });
    if (resulting.status === "closed") await ctx.db.delete(active._id);
    else await ctx.db.patch(active._id, { caseVersion: Number(resulting.case_version) });
    await ctx.db.insert("reviewActions", {
      actionId, caseId, actionType: actionType as any,
      resultingCaseVersion: Number(resulting.case_version), actorId,
      legalEffect: String(action.legal_effect) as any,
      actionJson: JSON.stringify(action), occurredAt,
    });
    await ctx.db.insert("reviewOperations", {
      actorId, actionType: actionType as any,
      operationKeySha256: String(request.operationKeySha256),
      commandSha256: String(request.commandSha256), municipalityCut, caseId,
      actionId, createdAt: occurredAt,
    });
    return { kind: "committed" as const, caseJson: JSON.stringify(resulting), actionId };
  },
});
