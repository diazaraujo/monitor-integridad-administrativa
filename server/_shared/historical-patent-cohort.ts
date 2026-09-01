import { z } from 'zod';

import {
  CommercialLicensesClientError,
  type CommercialLicensesClient,
} from './commercial-licenses-client';
import {
  createEvidencePacketBuilder,
  EvidencePacketBuilderError,
} from './evidence-packet-builder';

const CUT = /^\d{5}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const INSUFFICIENT_GAP_CODES = new Set([
  'coverage_gap',
  'incomplete_timeline',
  'unavailable_capability',
  'unresolved_match',
]);

const cohortCaseSchema = z.object({
  case_id: z.string().regex(IDENTIFIER),
  municipality_cut: z.string().regex(CUT),
  license_id: z.string().regex(IDENTIFIER),
  release_id: z.string().min(1).max(300),
  effective_on: z.string().regex(DATE),
  expected_provisional_status: z.literal('provisional'),
  expected_parcel_match_status: z.enum(['resolved', 'ambiguous', 'unresolved']),
}).strict();

const cohortSchema = z.object({
  schema_version: z.literal('0.1.0'),
  cohort_id: z.string().regex(IDENTIFIER),
  generated_at: z.string().datetime({ offset: true }),
  purpose: z.literal('historical_provisional_license_reproduction'),
  minimum_reproduced: z.number().int().min(1).max(20),
  cases: z.array(cohortCaseSchema).length(20),
}).strict().superRefine((value, context) => {
  const caseIds = value.cases.map((item) => item.case_id);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: 'custom', path: ['cases'], message: 'case identifiers must be unique' });
  }
  const sourceKeys = value.cases.map((item) =>
    `${item.municipality_cut}\0${item.license_id}\0${item.release_id}\0${item.effective_on}`
  );
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    context.addIssue({ code: 'custom', path: ['cases'], message: 'source cases must be unique' });
  }
});

export type HistoricalPatentCohort = z.infer<typeof cohortSchema>;
export type HistoricalPatentCohortCase = z.infer<typeof cohortCaseSchema>;
export type HistoricalPatentCohortOutcome = 'reproduced' | 'insufficient_evidence' | 'failed';

export interface HistoricalPatentCohortCaseResult {
  case_id: string;
  municipality_cut: string;
  license_id: string;
  release_id: string;
  outcome: HistoricalPatentCohortOutcome;
  packet_id: string | null;
  packet_content_sha256: string | null;
  gap_codes: string[];
  expectation_mismatches: Array<'provisional_status' | 'parcel_match_status'>;
  error_kind: 'client' | 'builder' | 'expectation_mismatch' | 'unknown' | null;
}

export interface HistoricalPatentCohortReport {
  schema_version: '0.1.0';
  cohort_id: string;
  evaluated_at: string;
  persisted_review_cases: 0;
  counts: {
    total: number;
    reproduced: number;
    insufficient_evidence: number;
    failed: number;
  };
  gate: {
    minimum_reproduced: number;
    passed: boolean;
  };
  results: HistoricalPatentCohortCaseResult[];
}

export function parseHistoricalPatentCohort(value: unknown): HistoricalPatentCohort {
  return cohortSchema.parse(value);
}

export async function evaluateHistoricalPatentCohort(options: {
  cohort: HistoricalPatentCohort;
  client: CommercialLicensesClient;
  builderVersion: string;
}): Promise<HistoricalPatentCohortReport> {
  const cohort = parseHistoricalPatentCohort(options.cohort);
  const builder = createEvidencePacketBuilder({
    client: options.client,
    builderVersion: options.builderVersion,
    now: () => new Date(cohort.generated_at),
  });
  const results: HistoricalPatentCohortCaseResult[] = [];

  for (const item of cohort.cases) {
    try {
      const packet = await builder.build({
        caseId: item.case_id,
        municipalityCut: item.municipality_cut,
        classification: ['PUBLIC', 'ACTIVE_REVIEW'],
        licenseId: item.license_id,
        releaseId: item.release_id,
        effectiveOn: item.effective_on,
        representation: 'public',
        permittedNextActions: [historicalOpenReviewAction(cohort.generated_at)],
        recommendedNextActionId: 'historical-open-review',
      });
      const expectationMismatches: HistoricalPatentCohortCaseResult['expectation_mismatches'] = [];
      if (packet.license.provisional_status !== item.expected_provisional_status) {
        expectationMismatches.push('provisional_status');
      }
      if (!packet.parcel_resolutions.some((resolution) =>
        resolution.status === item.expected_parcel_match_status
      )) {
        expectationMismatches.push('parcel_match_status');
      }
      if (expectationMismatches.length > 0) {
        results.push(failedResult(item, 'expectation_mismatch', expectationMismatches));
        continue;
      }
      const gapCodes = [...new Set(packet.gaps.map((gap) => gap.code))].sort();
      const insufficient = gapCodes.some((code) => INSUFFICIENT_GAP_CODES.has(code));
      results.push({
        case_id: item.case_id,
        municipality_cut: item.municipality_cut,
        license_id: item.license_id,
        release_id: item.release_id,
        outcome: insufficient ? 'insufficient_evidence' : 'reproduced',
        packet_id: packet.packet_id,
        packet_content_sha256: packet.reproducibility.packet_content_sha256,
        gap_codes: gapCodes,
        expectation_mismatches: [],
        error_kind: null,
      });
    } catch (error) {
      results.push(failedResult(
        item,
        error instanceof CommercialLicensesClientError
          ? 'client'
          : error instanceof EvidencePacketBuilderError
            ? 'builder'
            : 'unknown',
      ));
    }
  }

  const counts = {
    total: results.length,
    reproduced: results.filter((item) => item.outcome === 'reproduced').length,
    insufficient_evidence: results.filter((item) => item.outcome === 'insufficient_evidence').length,
    failed: results.filter((item) => item.outcome === 'failed').length,
  };
  return {
    schema_version: '0.1.0',
    cohort_id: cohort.cohort_id,
    evaluated_at: cohort.generated_at,
    persisted_review_cases: 0,
    counts,
    gate: {
      minimum_reproduced: cohort.minimum_reproduced,
      passed: counts.reproduced >= cohort.minimum_reproduced,
    },
    results,
  };
}

function historicalOpenReviewAction(evaluatedAt: string): Record<string, unknown> {
  return {
    action_id: 'historical-open-review',
    action_type: 'OpenLicenseReview',
    permitted: true,
    authorized_roles: ['reviewer'],
    reason: 'Historical evaluation only; no case or administrative action is persisted.',
    legal_effect: 'none',
    prerequisites: [],
    blocking_gap_ids: [],
    blocking_conflict_ids: [],
    legal_authority_refs: [],
    evaluated_at: evaluatedAt,
  };
}

function failedResult(
  item: HistoricalPatentCohortCase,
  errorKind: HistoricalPatentCohortCaseResult['error_kind'],
  expectationMismatches: HistoricalPatentCohortCaseResult['expectation_mismatches'] = [],
): HistoricalPatentCohortCaseResult {
  return {
    case_id: item.case_id,
    municipality_cut: item.municipality_cut,
    license_id: item.license_id,
    release_id: item.release_id,
    outcome: 'failed',
    packet_id: null,
    packet_content_sha256: null,
    gap_codes: [],
    expectation_mismatches: expectationMismatches,
    error_kind: errorKind,
  };
}
