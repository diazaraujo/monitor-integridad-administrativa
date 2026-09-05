import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const HASH = "a".repeat(64);
const OPERATION_HASH = "b".repeat(64);
const COMMAND_HASH = "c".repeat(64);
const reviewApi = anyApi.reviewCases!;
const originalReviewStorageSecret = process.env.REVIEW_CASE_STORAGE_SECRET;

function authority(overrides: Record<string, unknown> = {}) {
  return {
    authorityId: "authority-001",
    authorityVersion: 3,
    actorId: "actor-001",
    municipalityCut: "13101",
    roles: ["rentas"],
    permittedActions: ["OpenLicenseReview"],
    allowedMarkings: ["ACTIVE_REVIEW", "MUNICIPAL_INTERNAL"],
    allowedRepresentations: ["public", "municipal_restricted"],
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null,
    revokedAt: null,
    ...overrides,
  };
}

function commitRequest(overrides: Record<string, unknown> = {}) {
  const packet = {
    packet_id: "packet-001",
    schema_version: "0.1.0",
    generated_at: "2026-08-29T12:00:00.000Z",
    case_id: "case-001",
    municipality_cut: "13101",
    classification: ["ACTIVE_REVIEW", "MUNICIPAL_INTERNAL"],
    pinned_releases: [{
      producer: "inteligencia-inmobiliaria",
      product: "commercial-licenses",
      capability: "patents.get",
      release_id: "release-001",
    }],
    license: { license_id: "opaque-license-uuid", source_license_id: "license-001" },
    reproducibility: {
      packet_content_sha256: HASH,
      input_queries: [{
        producer: "inteligencia-inmobiliaria",
        capability: "patents.get",
        release_id: "release-001",
      }],
    },
  };
  const json = JSON.stringify(packet);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const packetRef = {
    packet_id: "packet-001",
    packet_content_sha256: HASH,
    packet_schema_version: "0.1.0",
    packet_generated_at: "2026-08-29T12:00:00.000Z",
    primary_release_id: "release-001",
    required_markings: ["ACTIVE_REVIEW", "MUNICIPAL_INTERNAL"],
  };
  return {
    operationKeySha256: OPERATION_HASH,
    commandSha256: COMMAND_HASH,
    activeCaseKey: "13101:license-001",
    expectedCaseVersion: 0,
    caseSnapshot: {
      schema_version: "0.1.0",
      case_id: "case-001",
      case_version: 1,
      municipality_cut: "13101",
      license_id: "license-001",
      status: "open",
      classification: ["ACTIVE_REVIEW", "MUNICIPAL_INTERNAL"],
      created_at: "2026-08-29T12:00:00.000Z",
      updated_at: "2026-08-29T12:00:00.000Z",
      packet_ref: packetRef,
    },
    evidencePacketSnapshot: {
      nature: "historical_non_executable",
      bytes: bytes.byteLength,
      chunks: [{ ordinal: 0, encodedBase64: btoa(binary), byteLength: bytes.byteLength }],
    },
    action: {
      schema_version: "0.1.0",
      action_id: "action-001",
      action_type: "OpenLicenseReview",
      case_id: "case-001",
      municipality_cut: "13101",
      license_id: "license-001",
      previous_case_version: 0,
      resulting_case_version: 1,
      actor_id: "actor-001",
      actor_roles: ["rentas"],
      authority_id: "authority-001",
      authority_version: 3,
      occurred_at: "2026-08-29T12:00:00.000Z",
      legal_effect: "none",
      packet_ref: packetRef,
      command_sha256: COMMAND_HASH,
    },
    authorityFence: {
      authorityId: "authority-001",
      authorityVersion: 3,
      actorId: "actor-001",
      municipalityCut: "13101",
      action: "OpenLicenseReview",
      requiredMarkings: ["ACTIVE_REVIEW", "MUNICIPAL_INTERNAL"],
      representation: "municipal_restricted",
      evaluatedAt: "2026-08-29T12:00:00.000Z",
    },
    ...overrides,
  };
}

function assignmentAuthority(overrides: Record<string, unknown> = {}) {
  return {
    authorityId: "assignment-authority-001", authorityVersion: 1,
    actorId: "coordinator-001", municipalityCut: "13101",
    roles: ["coordinator"], permittedActions: ["AssignReviewer"],
    validFrom: "2026-01-01T00:00:00.000Z", validTo: null, revokedAt: null,
    ...overrides,
  };
}

function reviewerGrant(overrides: Record<string, unknown> = {}) {
  return {
    reviewerId: "reviewer-001", reviewerVersion: 1, municipalityCut: "13101",
    eligible: true, validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null, revokedAt: null, ...overrides,
  };
}

function assignmentRequest() {
  const previous = commitRequest().caseSnapshot;
  const resulting = {
    ...previous,
    case_version: 2,
    status: "in_review",
    updated_at: "2026-08-29T12:00:00.000Z",
    packet_ref: {
      ...previous.packet_ref,
      required_markings: [...previous.packet_ref.required_markings],
    },
    assignment: {
      reviewer_id: "reviewer-001", assigned_by: "coordinator-001",
      assigned_at: "2026-08-29T12:00:00.000Z",
    },
  };
  return {
    operationKeySha256: "d".repeat(64), commandSha256: "e".repeat(64),
    expectedCaseVersion: 1, previousCaseSnapshot: previous,
    resultingCaseSnapshot: resulting,
    action: {
      schema_version: "0.1.0", action_id: "assignment-action-001",
      action_type: "AssignReviewer", case_id: "case-001", municipality_cut: "13101",
      license_id: "license-001", previous_case_version: 1, resulting_case_version: 2,
      reviewer_id: "reviewer-001", actor_id: "coordinator-001",
      actor_roles: ["coordinator"], authority_id: "assignment-authority-001",
      authority_version: 1, occurred_at: "2026-08-29T12:00:00.000Z",
      legal_effect: "none", packet_ref: previous.packet_ref, command_sha256: "e".repeat(64),
    },
    authorityFence: {
      authorityId: "assignment-authority-001", authorityVersion: 1,
      actorId: "coordinator-001", municipalityCut: "13101",
      action: "AssignReviewer", evaluatedAt: "2026-08-29T12:00:00.000Z",
    },
    reviewerFence: {
      reviewerId: "reviewer-001", municipalityCut: "13101",
      evaluatedAt: "2026-08-29T12:00:00.000Z",
    },
  };
}

function workflowRequest(
  previous: Record<string, any>,
  actionType = "NoObservations",
  overrides: Record<string, unknown> = {},
) {
  const occurredAt = "2026-08-29T12:00:00.000Z";
  const resulting = {
    ...previous,
    case_version: previous.case_version + 1,
    status: actionType === "CloseReview" ? "closed"
      : ["RequestMissingRequirement", "RequestCorrection"].includes(actionType)
        ? "waiting_external" : "in_review",
    updated_at: occurredAt,
    last_action_type: actionType,
    ...(actionType === "CloseReview" ? { closed_at: occurredAt } : {}),
  };
  const action = {
    schema_version: "0.1.0", action_id: `action-${actionType}-${previous.case_version}`,
    action_type: actionType, case_id: previous.case_id,
    municipality_cut: previous.municipality_cut, license_id: previous.license_id,
    previous_case_version: previous.case_version,
    resulting_case_version: previous.case_version + 1,
    actor_id: "reviewer-001", actor_roles: ["rentas"],
    authority_id: "integrity:13101:reviewer-001", authority_version: 1,
    occurred_at: occurredAt,
    legal_effect: ["RequestMissingRequirement", "RequestCorrection"].includes(actionType)
      ? "external_communication_only" : "none",
    packet_ref: previous.packet_ref, command_sha256: "9".repeat(64),
    note: actionType === "NoObservations" ? null : "Fundamento trazable",
    outcome_code: null, external_reference: null,
  };
  return {
    operationKeySha256: "8".repeat(64), commandSha256: "9".repeat(64),
    expectedCaseVersion: previous.case_version, previousCaseSnapshot: previous,
    resultingCaseSnapshot: resulting, action,
    authorityFence: {
      authorityId: "integrity:13101:reviewer-001", authorityVersion: 1,
      actorId: "reviewer-001", municipalityCut: "13101",
      action: actionType, evaluatedAt: occurredAt,
    },
    ...overrides,
  };
}

async function seedAssignment(t: Awaited<ReturnType<typeof harness>>) {
  await t.mutation(reviewApi.commitOpenLicenseReview as any, { request: commitRequest() });
  await t.mutation(reviewApi.upsertAssignmentAuthorityGrant as any, assignmentAuthority());
  await t.mutation(reviewApi.upsertReviewerEligibilityGrant as any, reviewerGrant());
}

async function harness() {
  const t = convexTest(schema, modules);
  await t.mutation(reviewApi._seedReviewWriteLock as any, {});
  await t.mutation(reviewApi.upsertAuthorityGrant as any, authority());
  return t;
}

describe("commercial-license review storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.REVIEW_CASE_STORAGE_SECRET = "review-storage-test-secret";
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalReviewStorageSecret === undefined) delete process.env.REVIEW_CASE_STORAGE_SECRET;
    else process.env.REVIEW_CASE_STORAGE_SECRET = originalReviewStorageSecret;
  });

  test("keeps operation lookup private and no-store", async () => {
    const t = await harness();
    const unauthorized = await t.fetch("/api/internal-review-case-operation", {
      method: "POST",
      body: JSON.stringify({ lookup: {} }),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await t.fetch("/api/internal-review-case-operation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-review-case-storage-secret": "review-storage-test-secret",
      },
      body: JSON.stringify({
        lookup: {
          operationKeySha256: OPERATION_HASH,
          commandSha256: COMMAND_HASH,
          actorId: "actor-001",
          municipalityCut: "13101",
        },
      }),
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("cache-control")).toBe("no-store");
    expect(await authorized.json()).toEqual({ kind: "miss" });
  });

  test("commits packet, case, active pointer, action and operation atomically", async () => {
    const t = await harness();
    await expect(t.mutation(
      reviewApi.commitOpenLicenseReview as any,
      { request: commitRequest() },
    )).resolves.toEqual({ kind: "committed" });

    const counts = await t.run(async (ctx) => ({
      packets: (await ctx.db.query("reviewEvidencePackets").collect()).length,
      chunks: (await ctx.db.query("reviewEvidencePacketChunks").collect()).length,
      cases: (await ctx.db.query("reviewCases").collect()).length,
      active: (await ctx.db.query("reviewActiveCases").collect()).length,
      actions: (await ctx.db.query("reviewActions").collect()).length,
      operations: (await ctx.db.query("reviewOperations").collect()).length,
    }));
    expect(counts).toEqual({ packets: 1, chunks: 1, cases: 1, active: 1, actions: 1, operations: 1 });
  });

  test("replays the same actor/action operation without inserting again", async () => {
    const t = await harness();
    const request = commitRequest();
    await t.mutation(reviewApi.commitOpenLicenseReview as any, { request });
    const replay = await t.mutation(reviewApi.commitOpenLicenseReview as any, { request });
    expect(replay.kind).toBe("replayed");
    expect(replay.receipt.replayed).toBe(false);
    expect(replay.receipt.case.case_id).toBe("case-001");
  });

  test("binds an operation key to its original command across municipalities", async () => {
    const t = await harness();
    await t.mutation(reviewApi.commitOpenLicenseReview as any, { request: commitRequest() });
    const result = await t.query(reviewApi.readOpenLicenseReviewOperation as any, {
      lookup: {
        operationKeySha256: OPERATION_HASH,
        commandSha256: COMMAND_HASH,
        actorId: "actor-001",
        municipalityCut: "05109",
      },
    });
    expect(result).toEqual({ kind: "operation_conflict" });
  });

  test("rejects a second active case for the same license", async () => {
    const t = await harness();
    await t.mutation(reviewApi.commitOpenLicenseReview as any, { request: commitRequest() });
    const second = commitRequest({ operationKeySha256: "d".repeat(64) });
    second.caseSnapshot.case_id = "case-002";
    second.action.case_id = "case-002";
    second.action.action_id = "action-002";
    const packet = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(second.evidencePacketSnapshot.chunks[0]!.encodedBase64), (c) => c.charCodeAt(0)),
    ));
    packet.case_id = "case-002";
    packet.packet_id = "packet-002";
    const json = JSON.stringify(packet);
    const encoded = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of encoded) binary += String.fromCharCode(byte);
    second.evidencePacketSnapshot = {
      nature: "historical_non_executable",
      bytes: encoded.byteLength,
      chunks: [{ ordinal: 0, encodedBase64: btoa(binary), byteLength: encoded.byteLength }],
    };
    second.caseSnapshot.packet_ref.packet_id = "packet-002";
    second.action.packet_ref.packet_id = "packet-002";
    expect(await t.mutation(reviewApi.commitOpenLicenseReview as any, { request: second }))
      .toEqual({ kind: "active_case_conflict" });
  });

  test("fails closed when authority representation is not currently allowed", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(reviewApi._seedReviewWriteLock as any, {});
    await t.mutation(reviewApi.upsertAuthorityGrant as any, authority({
      allowedRepresentations: ["public"],
    }));
    expect(await t.mutation(reviewApi.commitOpenLicenseReview as any, {
      request: commitRequest(),
    })).toEqual({ kind: "cas_conflict" });
  });

  test("rolls back every table on malformed packet chunks", async () => {
    const t = await harness();
    const request = commitRequest();
    request.evidencePacketSnapshot.chunks[0]!.encodedBase64 = "not base64";
    await expect(t.mutation(reviewApi.commitOpenLicenseReview as any, { request })).rejects.toThrow();
    const rows = await t.run(async (ctx) => await ctx.db.query("reviewCases").collect());
    expect(rows).toHaveLength(0);
  });

  test("assigns a reviewer atomically while preserving the opening snapshot", async () => {
    const t = await harness();
    await seedAssignment(t);

    expect(await t.mutation(reviewApi.commitAssignReviewer as any, {
      request: assignmentRequest(),
    })).toEqual({ kind: "committed" });

    const state = await t.run(async (ctx) => ({
      cases: await ctx.db.query("reviewCases").collect(),
      active: await ctx.db.query("reviewActiveCases").collect(),
      actions: await ctx.db.query("reviewActions").collect(),
      operations: await ctx.db.query("reviewOperations").collect(),
    }));
    expect(state.cases).toHaveLength(2);
    expect(state.actions).toHaveLength(2);
    expect(state.operations).toHaveLength(2);
    expect(state.active[0]?.caseVersion).toBe(2);
    expect(JSON.parse(state.cases.find((row) => row.caseVersion === 1)!.snapshotJson).status)
      .toBe("open");
    const assigned = JSON.parse(state.cases.find((row) => row.caseVersion === 2)!.snapshotJson);
    expect(assigned).toMatchObject({
      status: "in_review", assignment: { reviewer_id: "reviewer-001" },
    });
    expect(assigned.packet_ref).toEqual(commitRequest().caseSnapshot.packet_ref);
  });

  test("replays reviewer assignment without duplicate rows", async () => {
    const t = await harness();
    await seedAssignment(t);
    const request = assignmentRequest();
    await t.mutation(reviewApi.commitAssignReviewer as any, { request });
    const replay = await t.mutation(reviewApi.commitAssignReviewer as any, { request });
    expect(replay.kind).toBe("replayed");
    expect(replay.receipt.case.case_version).toBe(2);
    const rows = await t.run(async (ctx) => await ctx.db.query("reviewCases").collect());
    expect(rows).toHaveLength(2);
  });

  test("binds assignment idempotency and rolls back malformed transitions", async () => {
    const t = await harness();
    await seedAssignment(t);
    const request = assignmentRequest();
    await t.mutation(reviewApi.commitAssignReviewer as any, { request });
    const conflicting = assignmentRequest();
    conflicting.commandSha256 = "f".repeat(64);
    conflicting.action.command_sha256 = "f".repeat(64);
    expect(await t.mutation(reviewApi.commitAssignReviewer as any, { request: conflicting }))
      .toEqual({ kind: "operation_conflict" });

    const fresh = await harness();
    await seedAssignment(fresh);
    const malformed = assignmentRequest();
    malformed.resultingCaseSnapshot.packet_ref.packet_id = "packet-other";
    await expect(fresh.mutation(reviewApi.commitAssignReviewer as any, { request: malformed }))
      .rejects.toThrow();
    const counts = await fresh.run(async (ctx) => ({
      cases: (await ctx.db.query("reviewCases").collect()).length,
      actions: (await ctx.db.query("reviewActions").collect()).length,
      operations: (await ctx.db.query("reviewOperations").collect()).length,
    }));
    expect(counts).toEqual({ cases: 1, actions: 1, operations: 1 });
  });

  test("rejects stale versions and revoked reviewer eligibility", async () => {
    const stale = await harness();
    await seedAssignment(stale);
    const staleRequest = assignmentRequest();
    staleRequest.expectedCaseVersion = 2;
    staleRequest.previousCaseSnapshot.case_version = 2;
    staleRequest.resultingCaseSnapshot.case_version = 3;
    staleRequest.action.previous_case_version = 2;
    staleRequest.action.resulting_case_version = 3;
    expect(await stale.mutation(reviewApi.commitAssignReviewer as any, { request: staleRequest }))
      .toEqual({ kind: "cas_conflict" });

    const revoked = await harness();
    await revoked.mutation(reviewApi.commitOpenLicenseReview as any, { request: commitRequest() });
    await revoked.mutation(reviewApi.upsertAssignmentAuthorityGrant as any, assignmentAuthority());
    await revoked.mutation(reviewApi.upsertReviewerEligibilityGrant as any,
      reviewerGrant({ revokedAt: "2026-08-29T11:00:00.000Z" }));
    expect(await revoked.mutation(reviewApi.commitAssignReviewer as any,
      { request: assignmentRequest() })).toEqual({ kind: "cas_conflict" });
  });

  test("keeps assignment storage routes secret-authenticated and no-store", async () => {
    const t = await harness();
    await seedAssignment(t);
    const response = await t.fetch("/api/internal-review-case-assignment-snapshot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-review-case-storage-secret": "review-storage-test-secret",
      },
      body: JSON.stringify({ lookup: {
        caseId: "case-001", caseVersion: 1, municipalityCut: "13101",
      } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).case_version).toBe(1);
  });

  test("provisions a workflow actor and appends a human action without mutating history", async () => {
    const t = await harness();
    await seedAssignment(t);
    await t.mutation(reviewApi.commitAssignReviewer as any, { request: assignmentRequest() });
    await t.mutation(reviewApi.provisionWorkflowActor as any, {
      actorId: "reviewer-001", municipalityCut: "13101", authorityVersion: 1,
      roles: ["rentas"], validFrom: "2026-01-01T00:00:00.000Z",
    });
    const previous = assignmentRequest().resultingCaseSnapshot;
    const result = await t.mutation(reviewApi.commitReviewAction as any, {
      request: workflowRequest(previous),
    });
    expect(result).toMatchObject({ kind: "committed", actionId: "action-NoObservations-2" });
    const state = await t.run(async (ctx) => ({
      cases: await ctx.db.query("reviewCases").collect(),
      actions: await ctx.db.query("reviewActions").collect(),
      active: await ctx.db.query("reviewActiveCases").collect(),
    }));
    expect(state.cases.map((row) => row.caseVersion)).toEqual([1, 2, 3]);
    expect(state.actions).toHaveLength(3);
    expect(state.active[0]?.caseVersion).toBe(3);
    expect(JSON.parse(state.cases[1]!.snapshotJson).last_action_type).toBeUndefined();
  });

  test("closes only after a no-observations or official outcome action", async () => {
    const t = await harness();
    await seedAssignment(t);
    await t.mutation(reviewApi.commitAssignReviewer as any, { request: assignmentRequest() });
    await t.mutation(reviewApi.provisionWorkflowActor as any, {
      actorId: "reviewer-001", municipalityCut: "13101", authorityVersion: 1,
      roles: ["rentas"], validFrom: "2026-01-01T00:00:00.000Z",
    });
    await t.mutation(reviewApi.provisionWorkflowActor as any, {
      actorId: "coordinator-close", municipalityCut: "13101", authorityVersion: 1,
      roles: ["coordinator"], validFrom: "2026-01-01T00:00:00.000Z",
    });
    const assigned = assignmentRequest().resultingCaseSnapshot;
    const premature = workflowRequest(assigned, "CloseReview", {
      operationKeySha256: "6".repeat(64),
    });
    premature.action.actor_id = "coordinator-close";
    premature.action.actor_roles = ["coordinator"];
    premature.action.authority_id = "integrity:13101:coordinator-close";
    premature.authorityFence.actorId = "coordinator-close";
    premature.authorityFence.authorityId = "integrity:13101:coordinator-close";
    await expect(t.mutation(reviewApi.commitReviewAction as any, { request: premature }))
      .rejects.toThrow();
    const observedRequest = workflowRequest(assigned);
    await t.mutation(reviewApi.commitReviewAction as any, { request: observedRequest });
    const observed = observedRequest.resultingCaseSnapshot;
    const closeRequest = workflowRequest(observed, "CloseReview", {
      operationKeySha256: "7".repeat(64),
    });
    closeRequest.action.actor_id = "coordinator-close";
    closeRequest.action.actor_roles = ["coordinator"];
    closeRequest.action.authority_id = "integrity:13101:coordinator-close";
    closeRequest.authorityFence.actorId = "coordinator-close";
    closeRequest.authorityFence.authorityId = "integrity:13101:coordinator-close";
    expect(await t.mutation(reviewApi.commitReviewAction as any, { request: closeRequest }))
      .toMatchObject({ kind: "committed" });
    const active = await t.run(async (ctx) => await ctx.db.query("reviewActiveCases").collect());
    expect(active).toHaveLength(0);
  });

  test("returns an exact-version dossier through a secret-authenticated no-store route", async () => {
    const t = await harness();
    await t.mutation(reviewApi.commitOpenLicenseReview as any, { request: commitRequest() });
    await t.mutation(reviewApi.provisionWorkflowActor as any, {
      actorId: "actor-001", municipalityCut: "13101", authorityVersion: 1,
      roles: ["rentas"], validFrom: "2026-01-01T00:00:00.000Z",
    });
    const response = await t.fetch("/api/internal-review-case-dossier", {
      method: "POST",
      headers: { "content-type": "application/json",
        "x-review-case-storage-secret": "review-storage-test-secret" },
      body: JSON.stringify({ lookup: {
        actorId: "actor-001", municipalityCut: "13101", caseId: "case-001",
        caseVersion: 1, maxPacketBytes: 2 * 1024 * 1024,
      } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const dossier = await response.json();
    expect(JSON.parse(dossier.caseJson).case_version).toBe(1);
    expect(dossier.actionJson).toHaveLength(1);
    expect(JSON.parse(dossier.evidencePacketJson).case_id).toBe("case-001");
  });
});
