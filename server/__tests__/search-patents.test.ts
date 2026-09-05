import { afterEach, describe, expect, test, vi } from 'vitest';

import { CommercialLicensesClientError } from '../_shared/commercial-licenses-client';
import { IntegrityActorScopeError } from '../_shared/integrity-actor-scope';
import {
  __setSearchPatentsDependenciesForTests,
  searchPatents,
} from '../worldmonitor/integrity/v1/search-patents';

const actor = {
  actor_id: 'user-municipal-1',
  municipality_cut: '13115',
  roles: ['rentas'] as const,
  representation: 'public' as const,
};

function context() {
  const request = new Request('https://monitor.test/api/integrity/v1/search-patents');
  return { request, pathParams: {}, headers: {} };
}

function response() {
  return {
    metadata: {
      producer: 'inteligencia-inmobiliaria' as const,
      product: 'commercial-licenses' as const,
      release_id: 'lo-barnechea-2025-s1',
      schema_version: '0.1.0',
      data_as_of: '2025-06-30T00:00:00.000Z',
      promoted_at: '2026-08-31T00:00:00.000Z',
      quality_status: 'promoted' as const,
      availability: 'current' as const,
      data_marking: 'PUBLIC' as const,
      last_good_release_id: null,
      quality_report_uri: 'urn:quality:lo-barnechea-2025-s1',
    },
    source_refs: [],
    limitations: [],
    next_cursor: 'next-1',
    items: [{
      license: {
        license_id: 'opaque-internal-uuid', source_license_id: '7-092387', license_number: '92387',
        municipality_cut: '13115', license_type: 'commercial', reported_status: 'vigente',
        provisional_status: 'provisional' as const,
        address: { original: 'Av. Siempre Viva 123', municipality_cut: '13115', source_refs: [] },
        holders: [{
          holder_kind: 'legal_entity' as const, display_name: 'Titular público',
          valid_from: '2025-01-01', source_refs: [],
        }],
        activities: [{ activity: 'Restaurante', valid_from: null, source_refs: [] }],
        source_refs: [],
      },
      establishments: [{
        establishment_id: 'est-1',
        address: { original: 'Av. Siempre Viva 123', municipality_cut: '13115', source_refs: [] },
        source_refs: [],
      }],
      parcel_matches: [{
        candidate_id: 'candidate-1', parcel_id: 'parcel-1', match_status: 'ambiguous' as const,
        method: 'normalized_address_exact' as const, confidence: 0.7,
        parcel_release_id: 'parcel-release-1', source_refs: [],
      }],
      limitations: [{ code: 'ambiguous_match' as const, message: 'Requiere revisión' }],
    }],
  };
}

afterEach(() => __setSearchPatentsDependenciesForTests(null));

describe('IntegrityService.searchPatents', () => {
  test('derives municipality and representation from the authenticated server scope', async () => {
    const searchPatentsUpstream = vi.fn(async () => response());
    __setSearchPatentsDependenciesForTests({
      resolveActorScope: async () => actor,
      createClient: () => ({ searchPatents: searchPatentsUpstream } as never),
    });

    const result = await searchPatents(context(), {
      releaseId: '', status: 'vigente', licenseType: '', activity: '',
      address: 'Siempre Viva', effectiveOn: '', cursor: '', pageSize: 20,
      establishmentId: 'est-1', parcelId: 'parcel-1',
    });

    expect(searchPatentsUpstream).toHaveBeenCalledWith(expect.objectContaining({
      municipalityCut: '13115',
      representation: 'public',
      status: 'vigente',
      address: 'Siempre Viva',
      establishmentId: 'est-1',
      parcelId: 'parcel-1',
      limit: 20,
    }));
    expect(result).toMatchObject({
      releaseId: 'lo-barnechea-2025-s1',
      nextCursor: 'next-1',
      items: [{
        licenseId: '7-092387',
        municipalityCut: '13115',
        provisionalStatus: 'provisional',
        parcelResolutionStatus: 'ambiguous',
        limitationCodes: ['ambiguous_match'],
      }],
    });
  });

  test('fails closed before contacting upstream when authentication is absent', async () => {
    const createClient = vi.fn();
    __setSearchPatentsDependenciesForTests({
      resolveActorScope: async () => { throw new IntegrityActorScopeError('unauthenticated'); },
      createClient,
    });

    await expect(searchPatents(context(), {
      releaseId: '', status: '', licenseType: '', activity: '', address: '',
      effectiveOn: '', cursor: '', pageSize: 0, establishmentId: '', parcelId: '',
    })).rejects.toMatchObject({ statusCode: 401 });
    expect(createClient).not.toHaveBeenCalled();
  });

  test('does not expose upstream error details', async () => {
    __setSearchPatentsDependenciesForTests({
      resolveActorScope: async () => actor,
      createClient: () => ({
        searchPatents: async () => {
          throw new CommercialLicensesClientError('network', 'secret upstream detail');
        },
      } as never),
    });

    await expect(searchPatents(context(), {
      releaseId: '', status: '', licenseType: '', activity: '', address: '',
      effectiveOn: '', cursor: '', pageSize: 0, establishmentId: '', parcelId: '',
    })).rejects.toMatchObject({ statusCode: 503, message: 'Commercial licenses unavailable' });
  });

  test('preserves producer request and release errors without silent fallback', async () => {
    for (const [upstreamStatus, expectedStatus] of [[400, 400], [404, 404]] as const) {
      __setSearchPatentsDependenciesForTests({
        resolveActorScope: async () => actor,
        createClient: () => ({
          searchPatents: async () => {
            throw new CommercialLicensesClientError('http', 'secret upstream detail', {
              status: upstreamStatus,
              upstreamCode: upstreamStatus === 404 ? 'release_not_found' : 'invalid_cursor',
            });
          },
        } as never),
      });

      await expect(searchPatents(context(), {
        releaseId: 'pinned-release', status: '', licenseType: '', activity: '', address: '',
        effectiveOn: '', cursor: '', pageSize: 0, establishmentId: '', parcelId: '',
      })).rejects.toMatchObject({ statusCode: expectedStatus });
    }
  });

  test('fails closed before transport for the unavailable restricted representation', async () => {
    const createClient = vi.fn();
    __setSearchPatentsDependenciesForTests({
      resolveActorScope: async () => ({ ...actor, representation: 'municipal_restricted' }),
      createClient,
    });

    await expect(searchPatents(context(), {
      releaseId: '', status: '', licenseType: '', activity: '', address: '',
      effectiveOn: '', cursor: '', pageSize: 0, establishmentId: '', parcelId: '',
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(createClient).not.toHaveBeenCalled();
  });
});
