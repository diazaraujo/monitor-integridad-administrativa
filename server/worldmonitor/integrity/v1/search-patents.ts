import type {
  IntegrityServiceHandler,
  PatentQueueItem,
  SearchPatentsRequest,
  SearchPatentsResponse,
  ServerContext,
} from '../../../../src/generated/server/worldmonitor/integrity/v1/service_server';
import { ApiError } from '../../../../src/generated/server/worldmonitor/integrity/v1/service_server';

import {
  CommercialLicensesClientError,
  createCommercialLicensesClientFromEnv,
  type CommercialLicensesClient,
} from '../../../_shared/commercial-licenses-client';
import {
  IntegrityActorScopeError,
  resolveIntegrityActorScope,
  type IntegrityActorScope,
} from '../../../_shared/integrity-actor-scope';
import { markNoCacheResponse } from '../../../_shared/response-headers';

interface SearchPatentsDependencies {
  resolveActorScope(request: Request): Promise<IntegrityActorScope>;
  createClient(): CommercialLicensesClient;
}

const defaultDependencies: SearchPatentsDependencies = {
  resolveActorScope: resolveIntegrityActorScope,
  createClient: createCommercialLicensesClientFromEnv,
};

let dependencies = defaultDependencies;

export function __setSearchPatentsDependenciesForTests(
  overrides: Partial<SearchPatentsDependencies> | null,
): void {
  dependencies = overrides ? { ...defaultDependencies, ...overrides } : defaultDependencies;
}

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}

function parcelResolutionStatus(item: {
  parcel_matches: { match_status: string }[];
}): string {
  if (item.parcel_matches.some((match) => match.match_status === 'resolved')) return 'resolved';
  if (item.parcel_matches.some((match) => match.match_status === 'ambiguous')) return 'ambiguous';
  return 'unresolved';
}

function projectQueueItem(item: Awaited<ReturnType<CommercialLicensesClient['searchPatents']>>['items'][number]): PatentQueueItem {
  return {
    licenseId: item.license.license_id,
    municipalityCut: item.license.municipality_cut,
    licenseNumber: item.license.license_number ?? '',
    licenseType: item.license.license_type,
    reportedStatus: item.license.reported_status,
    provisionalStatus: item.license.provisional_status,
    address: item.license.address.original,
    holderDisplayNames: item.license.holders.map((holder) => holder.display_name),
    activities: item.license.activities.map((activity) => activity.activity),
    establishmentIds: item.establishments.map((establishment) => establishment.establishment_id),
    parcelResolutionStatus: parcelResolutionStatus(item),
    limitationCodes: [...new Set(item.limitations.map((limitation) => limitation.code))].sort(),
  };
}

export const searchPatents: IntegrityServiceHandler['searchPatents'] = async (
  ctx: ServerContext,
  req: SearchPatentsRequest,
): Promise<SearchPatentsResponse> => {
  markNoCacheResponse(ctx.request);

  let actor: IntegrityActorScope;
  try {
    actor = await dependencies.resolveActorScope(ctx.request);
  } catch (error) {
    if (error instanceof IntegrityActorScopeError) {
      if (error.kind === 'unauthenticated') throw new ApiError(401, 'Authentication required', '');
      if (error.kind === 'forbidden') throw new ApiError(403, 'Municipal scope not authorized', '');
    }
    throw new ApiError(503, 'Municipal authorization unavailable', '');
  }

  try {
    const response = await dependencies.createClient().searchPatents({
      municipalityCut: actor.municipality_cut,
      representation: actor.representation,
      releaseId: optional(req.releaseId),
      status: optional(req.status),
      licenseType: optional(req.licenseType),
      activity: optional(req.activity),
      legalEntityRut: optional(req.legalEntityRut),
      address: optional(req.address),
      effectiveOn: optional(req.effectiveOn),
      cursor: optional(req.cursor),
      limit: req.pageSize > 0 ? req.pageSize : 25,
    });
    return {
      items: response.items.map(projectQueueItem),
      nextCursor: response.next_cursor ?? '',
      releaseId: response.metadata.release_id,
      dataAsOf: response.metadata.data_as_of,
      availability: response.metadata.availability,
      dataMarking: response.metadata.data_marking,
      limitationCodes: [...new Set(response.limitations.map((item) => item.code))].sort(),
    };
  } catch (error) {
    if (error instanceof CommercialLicensesClientError) {
      if (error.kind === 'http' && error.status === 404) {
        return {
          items: [], nextCursor: '', releaseId: '', dataAsOf: '', availability: 'current',
          dataMarking: actor.representation === 'public' ? 'PUBLIC' : 'MUNICIPAL_INTERNAL',
          limitationCodes: ['data_gap'],
        };
      }
    }
    throw new ApiError(503, 'Commercial licenses unavailable', '');
  }
};
