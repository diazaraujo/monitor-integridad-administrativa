// @vitest-environment node

import { afterEach, describe, expect, test, vi } from 'vitest';

const contract = vi.hoisted(() => {
  class CommercialLicensesContractError extends Error {}
  const parse = vi.fn((value: unknown) => {
    if (value === 'contract-error') throw new CommercialLicensesContractError('sensitive detail');
    return value;
  });
  return { CommercialLicensesContractError, parse };
});

vi.mock('../_shared/commercial-licenses-contract', () => ({
  CommercialLicensesContractError: contract.CommercialLicensesContractError,
  parsePatentGetResponse: contract.parse,
  parsePatentTimelineResponse: contract.parse,
  parsePatentSearchResponse: contract.parse,
  parsePatentCoverageResponse: contract.parse,
  parseEstablishmentResolveResponse: contract.parse,
}));

import {
  CommercialLicensesClientError,
  createCommercialLicensesClient,
  createCommercialLicensesClientFromEnv,
} from '../_shared/commercial-licenses-client';

const RELEASE_ID = 'release-2026-08-28';

function response(
  releaseId = RELEASE_ID,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    metadata: {
      release_id: releaseId,
      schema_version: '0.1.0',
      data_marking: 'PUBLIC',
    },
    effective_on: '2026-08-01',
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createHarness(values: Array<Response | Error> = [jsonResponse(response())]) {
  const fetchImpl = vi.fn(async () => {
    const next = values.shift();
    if (!next) throw new Error('Unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  const getServiceKey = vi.fn(async () => 'secret-service-key');
  const client = createCommercialLicensesClient({
    baseUrl: 'https://licenses.test/capabilities/',
    getServiceKey,
    fetchImpl,
  });
  return { client, fetchImpl, getServiceKey };
}

afterEach(() => {
  vi.restoreAllMocks();
  contract.parse.mockClear();
});

describe('commercial licenses HTTP client', () => {
  test('serializes patents.get path, query and required headers', async () => {
    const { client, fetchImpl } = createHarness();

    await client.getPatent({
      municipalityCut: '13101',
      sourceLicenseId: 'license / 42',
      releaseId: RELEASE_ID,
      effectiveOn: '2026-08-01',
      representation: 'public',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/capabilities/v1/patents/13101/license%20%2F%2042');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      effective_on: '2026-08-01',
      release_id: RELEASE_ID,
      representation: 'public',
    });
    expect(init).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Service-Key': 'secret-service-key',
        'User-Agent': 'chile-monitor-server/1.0 (commercial-licenses)',
      },
    });
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('serializes patents.timeline and omits absent query parameters', async () => {
    const { client, fetchImpl } = createHarness();

    await client.getPatentTimeline({ municipalityCut: '13101', sourceLicenseId: 'license-1' });

    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toBe(
      'https://licenses.test/capabilities/v1/patents/13101/license-1/timeline?representation=public',
    );
    expect(init?.method).toBe('GET');
  });

  test('serializes every patents.search filter with URLSearchParams', async () => {
    const { client, fetchImpl } = createHarness();

    await client.searchPatents({
      municipalityCut: '13101',
      releaseId: RELEASE_ID,
      representation: 'public',
      status: 'vigente & observada',
      licenseType: 'commercial',
      activity: 'alimentos',
      address: 'Avenida Uno 123 #4',
      establishmentId: 'est-1',
      parcelId: 'parcel-1',
      effectiveOn: '2026-08-01',
      cursor: 'opaque+cursor=',
      limit: 25,
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe('/capabilities/v1/patents/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      activity: 'alimentos',
      address: 'Avenida Uno 123 #4',
      cursor: 'opaque+cursor=',
      effective_on: '2026-08-01',
      establishment_id: 'est-1',
      license_type: 'commercial',
      limit: '25',
      municipality_cut: '13101',
      parcel_id: 'parcel-1',
      release_id: RELEASE_ID,
      representation: 'public',
      status: 'vigente & observada',
    });
  });

  test('serializes patents.coverage', async () => {
    const { client, fetchImpl } = createHarness();

    await client.getPatentCoverage({
      municipalityCut: '13101',
      periodFrom: '2021-01-01',
      periodTo: '2026-08-28',
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname).toBe('/capabilities/v1/patents/coverage');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      municipality_cut: '13101',
      period_from: '2021-01-01',
      period_to: '2026-08-28',
      representation: 'public',
    });
  });

  test('serializes establishments.resolve body and release query', async () => {
    const { client, fetchImpl } = createHarness();
    const body = {
      municipality_cut: '13101',
      address: 'Avenida Uno 123',
      unit: null,
      effective_on: '2026-08-01',
    };

    await client.resolveEstablishment(body, { releaseId: RELEASE_ID });

    const [input, init] = fetchImpl.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/capabilities/v1/establishments/resolve');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      release_id: RELEASE_ID,
      representation: 'public',
    });
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  });

  test('uses an eight second timeout and resolves service-key auth for each request', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const { client, getServiceKey } = createHarness([
      jsonResponse(response()),
      jsonResponse(response()),
    ]);

    await client.getPatentCoverage({ municipalityCut: '13101' });
    await client.getPatentCoverage({ municipalityCut: '13101' });

    expect(timeout).toHaveBeenNthCalledWith(1, 8_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 8_000);
    expect(getServiceKey).toHaveBeenCalledTimes(2);
  });

  test('rejects a response that does not match the exact pinned release', async () => {
    const { client } = createHarness([jsonResponse(response('different-release'))]);

    await expect(
      client.getPatent({
        municipalityCut: '13101',
        sourceLicenseId: 'secret-id',
        releaseId: RELEASE_ID,
      }),
    ).rejects.toMatchObject({
      name: 'CommercialLicensesClientError',
      kind: 'release_mismatch',
    });
  });

  test('rejects schema, temporal and representation mismatches', async () => {
    const incompatible = createHarness([
      jsonResponse(response(RELEASE_ID, {
        metadata: {
          release_id: RELEASE_ID,
          schema_version: '1.0.0',
          data_marking: 'PUBLIC',
        },
      })),
    ]);
    await expect(
      incompatible.client.getPatentCoverage({ municipalityCut: '13101' }),
    ).rejects.toMatchObject({ kind: 'schema_incompatible' });

    const wrongDate = createHarness([
      jsonResponse(response(RELEASE_ID, { effective_on: '2026-07-31' })),
    ]);
    await expect(
      wrongDate.client.getPatent({
        municipalityCut: '13101',
        sourceLicenseId: 'license-1',
        effectiveOn: '2026-08-01',
      }),
    ).rejects.toMatchObject({ kind: 'temporal_mismatch' });

    const wrongMarking = createHarness([
      jsonResponse(response(RELEASE_ID, {
        metadata: {
          release_id: RELEASE_ID,
          schema_version: '0.1.0',
          data_marking: 'MUNICIPAL_INTERNAL',
        },
      })),
    ]);
    await expect(
      wrongMarking.client.getPatentCoverage({
        municipalityCut: '13101',
        representation: 'public',
      }),
    ).rejects.toMatchObject({ kind: 'representation_mismatch' });
  });

  test('keeps safe HTTP error fields without exposing upstream messages', async () => {
    const secret = 'Avenida Secreta 123';
    const { client } = createHarness([
      jsonResponse({ error: { code: 'release_not_found', message: secret, retryable: false } }, 404),
    ]);

    let caught: unknown;
    try {
      await client.getPatent({ municipalityCut: '13101', sourceLicenseId: 'sensitive-license' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      kind: 'http',
      status: 404,
      upstreamCode: 'release_not_found',
      retryable: false,
    });
    expect(String(caught)).not.toContain(secret);
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  test('types invalid JSON, contract, timeout and network failures without retrying', async () => {
    const cases: Array<{ value: Response | Error; kind: string }> = [
      { value: new Response('{invalid', { status: 200 }), kind: 'invalid_json' },
      { value: jsonResponse('contract-error'), kind: 'invalid_payload' },
      { value: new DOMException('secret timeout detail', 'TimeoutError'), kind: 'timeout' },
      { value: new Error('secret network detail'), kind: 'network' },
    ];

    for (const entry of cases) {
      const { client, fetchImpl } = createHarness([entry.value]);
      await expect(client.getPatentCoverage({ municipalityCut: '13101' })).rejects.toMatchObject({
        name: 'CommercialLicensesClientError',
        kind: entry.kind,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  test('rejects unsafe configuration and unavailable auth before fetch', async () => {
    expect(() =>
      createCommercialLicensesClient({
        baseUrl: 'https://token:secret@licenses.test/',
        getServiceKey: () => 'token',
      }),
    ).toThrowError(CommercialLicensesClientError);

    const fetchImpl = vi.fn();
    const client = createCommercialLicensesClient({
      baseUrl: 'https://licenses.test',
      getServiceKey: () => ' key-with-whitespace ',
      fetchImpl,
    });
    await expect(client.getPatentCoverage({ municipalityCut: '13101' })).rejects.toMatchObject({
      kind: 'configuration',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    expect(() =>
      createCommercialLicensesClient({
        baseUrl: 'https://licenses.test/',
        getServiceKey: () => 'key',
        supportedSchemaMajor: -1,
      }),
    ).toThrowError(CommercialLicensesClientError);
  });

  test('builds a server-only client from the Purranque environment contract', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(response('purranque-2026-s1')));
    const client = createCommercialLicensesClientFromEnv({
      CHILE_COMMERCIAL_LICENSES_BASE_URL: 'http://10.0.0.3:8130/api/integrity/',
      CHILE_COMMERCIAL_LICENSES_SERVICE_KEY: 'purranque-test-service-key',
      CHILE_COMMERCIAL_LICENSES_TIMEOUT_MS: '1200',
    }, fetchImpl);

    await client.getPatentCoverage({
      municipalityCut: '10303',
      releaseId: 'purranque-2026-s1',
    });

    const [input, init] = fetchImpl.mock.calls[0];
    expect(new URL(String(input)).pathname).toBe('/api/integrity/v1/patents/coverage');
    expect(new Headers(init?.headers).get('X-Service-Key')).toBe('purranque-test-service-key');
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
  });

  test('rejects missing env, public HTTP and invalid timeout before transport', () => {
    expect(() => createCommercialLicensesClientFromEnv({})).toThrowError(
      CommercialLicensesClientError,
    );
    expect(() => createCommercialLicensesClient({
      baseUrl: 'http://licenses.example.test/',
      getServiceKey: () => 'key',
    })).toThrowError(CommercialLicensesClientError);
    expect(() => createCommercialLicensesClientFromEnv({
      CHILE_COMMERCIAL_LICENSES_BASE_URL: 'https://licenses.test/',
      CHILE_COMMERCIAL_LICENSES_SERVICE_KEY: 'key',
      CHILE_COMMERCIAL_LICENSES_TIMEOUT_MS: '30001',
    })).toThrowError(CommercialLicensesClientError);
  });

  test('rejects the unavailable municipal-restricted representation before transport', async () => {
    const { client, fetchImpl } = createHarness();
    await expect(client.getPatentCoverage({
      municipalityCut: '13101',
      representation: 'municipal_restricted',
    })).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
