import { hashEvidencePacketContent } from './evidence-packet-canonical';
import { parseEvidencePacket, type Marking } from './evidence-packet-contract';
import {
  parseReviewCaseDossier,
  parseReviewCaseSnapshot,
  type ReviewCaseDossier,
  type ReviewCaseSnapshot,
} from './review-case-contract';

const DEFAULT_MAX_PACKET_BYTES = 2 * 1024 * 1024;

export interface ReviewCaseLookup {
  caseId: string;
  caseVersion: number;
}

export interface EvidencePacketLookup {
  municipalityCut: string;
  caseId: string;
  caseVersion: number;
  packetId: string;
  expectedSha256: string;
  primaryReleaseId: string;
  maxBytes: number;
}

export interface ReviewCaseReadPort {
  readCaseSnapshot(lookup: ReviewCaseLookup): Promise<unknown | null>;
  /** Implementations must enforce maxBytes before fully materializing packet content. */
  readEvidencePacket(lookup: EvidencePacketLookup): Promise<string | null>;
}

export interface ReviewCaseAuthorizationRequest {
  caseId: string;
  caseVersion: number;
  municipalityCut: string;
  requiredMarkings: readonly Marking[];
  phase: 'snapshot' | 'packet';
}

/** The implementation closes over server-derived actor identity and scope. */
export type ReviewCaseAuthorizationPort = (
  request: ReviewCaseAuthorizationRequest,
) => boolean | Promise<boolean>;

export interface ReviewCaseReaderConfig {
  readPort: ReviewCaseReadPort;
  authorize: ReviewCaseAuthorizationPort;
  maxEvidencePacketBytes?: number;
}

export interface ReviewCaseReader {
  getReviewCaseDossier(lookup: ReviewCaseLookup): Promise<ReviewCaseDossier>;
}

export type ReviewCaseReaderErrorKind =
  | 'invalid_request'
  | 'not_found_or_denied'
  | 'storage_unavailable'
  | 'packet_too_large'
  | 'integrity_failure';

/** Safe error: it never retains storage errors, packet content, or identifiers. */
export class ReviewCaseReaderError extends Error {
  readonly kind: ReviewCaseReaderErrorKind;

  constructor(kind: ReviewCaseReaderErrorKind, message: string) {
    super(message);
    this.name = 'ReviewCaseReaderError';
    this.kind = kind;
  }
}

export function createReviewCaseReader(config: ReviewCaseReaderConfig): ReviewCaseReader {
  const maxPacketBytes = validSizeCap(config.maxEvidencePacketBytes);

  return {
    async getReviewCaseDossier(lookup) {
      validateLookup(lookup);

      const storedSnapshot = await readSnapshot(config.readPort, lookup);
      if (storedSnapshot === null) throw notFoundOrDenied();

      const snapshot = parseSnapshot(storedSnapshot);
      if (snapshot.case_id !== lookup.caseId || snapshot.case_version !== lookup.caseVersion) {
        throw notFoundOrDenied();
      }

      await requireAuthorization(
        config.authorize,
        snapshot,
        [...snapshot.classification, ...snapshot.packet_ref.required_markings],
        'snapshot',
      );

      const packetJson = await readPacket(config.readPort, {
        municipalityCut: snapshot.municipality_cut,
        caseId: snapshot.case_id,
        caseVersion: snapshot.case_version,
        packetId: snapshot.packet_ref.packet_id,
        expectedSha256: snapshot.packet_ref.packet_content_sha256,
        primaryReleaseId: snapshot.packet_ref.primary_release_id,
        maxBytes: maxPacketBytes,
      });
      if (packetJson === null) throw integrityFailure();
      if (typeof packetJson !== 'string') throw integrityFailure();
      if (new TextEncoder().encode(packetJson).byteLength > maxPacketBytes) {
        throw new ReviewCaseReaderError(
          'packet_too_large',
          'The review case evidence packet cannot be processed',
        );
      }

      const packet = parsePacketJson(packetJson);
      await verifyPacketIntegrity(snapshot, packet);

      const effectiveMarkings = collectEffectiveMarkings(snapshot, packet);
      if (!sameStringSet(effectiveMarkings, snapshot.packet_ref.required_markings)) {
        throw integrityFailure();
      }
      await requireAuthorization(config.authorize, snapshot, effectiveMarkings, 'packet');

      const dossierCandidate = {
        schema_version: '0.1.0' as const,
        case: snapshot,
        evidence_packet_snapshot: {
          nature: 'historical_non_executable' as const,
          packet,
        },
        assessment: {
          gap_ids: packet.gaps.map((gap) => gap.gap_id).sort(),
          conflict_ids: packet.conflicts.map((conflict) => conflict.conflict_id).sort(),
          has_stale_release: packet.pinned_releases.some(
            (release) => release.availability === 'stale_last_good',
          ),
          action_snapshot_stale: packet.permitted_next_actions.some(
            (action) => Date.parse(action.evaluated_at) < Date.parse(snapshot.updated_at),
          ),
          historical_action_evaluations: packet.permitted_next_actions
            .map((action) => ({
              action_id: action.action_id,
              action_type: action.action_type,
              evaluated_at: action.evaluated_at,
              packet_reported_permitted: action.permitted,
              executable: false as const,
            }))
            .sort((left, right) => compareStrings(left.action_id, right.action_id)),
          historical_recommended_action_id: packet.recommended_next_action_id ?? null,
        },
      };

      try {
        return parseReviewCaseDossier(dossierCandidate);
      } catch {
        throw integrityFailure();
      }
    },
  };
}

function validSizeCap(value: number | undefined): number {
  const cap = value ?? DEFAULT_MAX_PACKET_BYTES;
  if (!Number.isSafeInteger(cap) || cap <= 0) {
    throw new ReviewCaseReaderError('invalid_request', 'Review case reader configuration is invalid');
  }
  return cap;
}

function validateLookup(lookup: ReviewCaseLookup): void {
  if (
    typeof lookup.caseId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(lookup.caseId) ||
    !Number.isSafeInteger(lookup.caseVersion) ||
    lookup.caseVersion < 1
  ) {
    throw new ReviewCaseReaderError('invalid_request', 'Review case lookup is invalid');
  }
}

async function readSnapshot(
  port: ReviewCaseReadPort,
  lookup: ReviewCaseLookup,
): Promise<unknown | null> {
  try {
    return await port.readCaseSnapshot(lookup);
  } catch {
    throw new ReviewCaseReaderError(
      'storage_unavailable',
      'Review case storage is unavailable',
    );
  }
}

async function readPacket(
  port: ReviewCaseReadPort,
  lookup: EvidencePacketLookup,
): Promise<string | null> {
  try {
    return await port.readEvidencePacket(lookup);
  } catch {
    throw new ReviewCaseReaderError(
      'storage_unavailable',
      'Review case storage is unavailable',
    );
  }
}

function parseSnapshot(value: unknown): ReviewCaseSnapshot {
  try {
    return parseReviewCaseSnapshot(value);
  } catch {
    throw notFoundOrDenied();
  }
}

function parsePacketJson(value: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw integrityFailure();
  }
  try {
    return parseEvidencePacket(parsed);
  } catch {
    throw integrityFailure();
  }
}

async function requireAuthorization(
  authorize: ReviewCaseAuthorizationPort,
  snapshot: ReviewCaseSnapshot,
  requiredMarkings: readonly Marking[],
  phase: ReviewCaseAuthorizationRequest['phase'],
): Promise<void> {
  let allowed = false;
  try {
    allowed = await authorize({
      caseId: snapshot.case_id,
      caseVersion: snapshot.case_version,
      municipalityCut: snapshot.municipality_cut,
      requiredMarkings: [...new Set(requiredMarkings)].sort(),
      phase,
    });
  } catch {
    throw notFoundOrDenied();
  }
  if (!allowed) throw notFoundOrDenied();
}

async function verifyPacketIntegrity(
  snapshot: ReviewCaseSnapshot,
  packet: ReturnType<typeof parseEvidencePacket>,
): Promise<void> {
  const reference = snapshot.packet_ref;
  if (
    packet.packet_id !== reference.packet_id ||
    packet.schema_version !== reference.packet_schema_version ||
    packet.generated_at !== reference.packet_generated_at ||
    packet.case_id !== snapshot.case_id ||
    packet.municipality_cut !== snapshot.municipality_cut ||
    packet.license.source_license_id !== snapshot.license_id ||
    !sameStringSet(packet.classification, snapshot.classification) ||
    packet.reproducibility.packet_content_sha256 !== reference.packet_content_sha256
  ) {
    throw integrityFailure();
  }

  const primaryReleases = packet.pinned_releases.filter(
    (release) => release.capability === 'patents.get',
  );
  const primaryQueries = packet.reproducibility.input_queries.filter(
    (query) => query.capability === 'patents.get',
  );
  const primaryRelease = primaryReleases[0];
  const primaryQuery = primaryQueries[0];
  if (
    primaryReleases.length !== 1 ||
    primaryQueries.length !== 1 ||
    primaryRelease === undefined ||
    primaryQuery === undefined ||
    primaryRelease.producer !== 'inteligencia-inmobiliaria' ||
    primaryRelease.product !== 'commercial-licenses' ||
    primaryQuery.producer !== 'inteligencia-inmobiliaria' ||
    primaryRelease.release_id !== reference.primary_release_id ||
    primaryQuery.release_id !== reference.primary_release_id ||
    primaryQuery.producer !== primaryRelease.producer
  ) {
    throw integrityFailure();
  }

  let computedHash: string;
  try {
    computedHash = await hashEvidencePacketContent(packet);
  } catch {
    throw integrityFailure();
  }
  if (
    computedHash !== packet.reproducibility.packet_content_sha256 ||
    computedHash !== reference.packet_content_sha256
  ) {
    throw integrityFailure();
  }
}

function collectEffectiveMarkings(
  snapshot: ReviewCaseSnapshot,
  packet: ReturnType<typeof parseEvidencePacket>,
): Marking[] {
  return [...new Set<Marking>([
    ...snapshot.classification,
    ...packet.classification,
    ...packet.evidence.flatMap((evidence) => evidence.classification),
    ...packet.pinned_releases.map((release) => release.data_marking),
  ])].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function notFoundOrDenied(): ReviewCaseReaderError {
  return new ReviewCaseReaderError(
    'not_found_or_denied',
    'Review case was not found or is not accessible',
  );
}

function integrityFailure(): ReviewCaseReaderError {
  return new ReviewCaseReaderError(
    'integrity_failure',
    'Review case data failed integrity validation',
  );
}
