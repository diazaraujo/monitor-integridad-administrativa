import {
  CommercialLicensesContractError,
  parseEstablishmentResolveResponse,
  parsePatentCoverageResponse,
  parsePatentGetResponse,
  parsePatentSearchResponse,
  parsePatentTimelineResponse,
  type EstablishmentResolveRequest,
  type EstablishmentResolveResponse,
  type PatentCoverageResponse,
  type PatentGetResponse,
  type PatentSearchResponse,
  type PatentTimelineResponse,
} from './commercial-licenses-contract';

export type { EstablishmentResolveRequest } from './commercial-licenses-contract';

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_SUPPORTED_SCHEMA_MAJOR = 0;
const USER_AGENT = 'chile-monitor-server/1.0 (commercial-licenses)';

export type CommercialLicensesRepresentation = 'public' | 'municipal_restricted';

export interface PatentGetParams {
  municipalityCut: string;
  /** Municipality-issued source identifier; never the producer's internal UUID. */
  sourceLicenseId: string;
  releaseId?: string;
  effectiveOn?: string;
  representation?: CommercialLicensesRepresentation;
}

export interface PatentTimelineParams {
  municipalityCut: string;
  /** Municipality-issued source identifier; never the producer's internal UUID. */
  sourceLicenseId: string;
  releaseId?: string;
  representation?: CommercialLicensesRepresentation;
}

export interface PatentSearchParams {
  municipalityCut: string;
  releaseId?: string;
  representation?: CommercialLicensesRepresentation;
  status?: string;
  licenseType?: string;
  activity?: string;
  address?: string;
  establishmentId?: string;
  parcelId?: string;
  effectiveOn?: string;
  cursor?: string;
  limit?: number;
}

export interface PatentCoverageParams {
  municipalityCut: string;
  releaseId?: string;
  representation?: CommercialLicensesRepresentation;
  periodFrom?: string;
  periodTo?: string;
}

export interface CommercialLicensesRequestOptions {
  releaseId?: string;
  representation?: CommercialLicensesRepresentation;
}

export interface CommercialLicensesClient {
  getPatent(params: PatentGetParams): Promise<PatentGetResponse>;
  getPatentTimeline(params: PatentTimelineParams): Promise<PatentTimelineResponse>;
  searchPatents(params: PatentSearchParams): Promise<PatentSearchResponse>;
  getPatentCoverage(params: PatentCoverageParams): Promise<PatentCoverageResponse>;
  resolveEstablishment(
    request: EstablishmentResolveRequest,
    options?: CommercialLicensesRequestOptions,
  ): Promise<EstablishmentResolveResponse>;
}

export type CommercialLicensesClientErrorKind =
  | 'configuration'
  | 'timeout'
  | 'network'
  | 'http'
  | 'invalid_json'
  | 'invalid_payload'
  | 'release_mismatch'
  | 'schema_incompatible'
  | 'temporal_mismatch'
  | 'representation_mismatch';

interface CommercialLicensesClientErrorOptions {
  status?: number;
  upstreamCode?: string;
  retryable?: boolean;
}

/**
 * Safe transport error. It intentionally excludes request URLs, bodies, tokens,
 * upstream messages and parser details because those can contain protected data.
 */
export class CommercialLicensesClientError extends Error {
  readonly kind: CommercialLicensesClientErrorKind;
  readonly status?: number;
  readonly upstreamCode?: string;
  readonly retryable?: boolean;

  constructor(
    kind: CommercialLicensesClientErrorKind,
    message: string,
    options: CommercialLicensesClientErrorOptions = {},
  ) {
    super(message);
    this.name = 'CommercialLicensesClientError';
    this.kind = kind;
    this.status = options.status;
    this.upstreamCode = options.upstreamCode;
    this.retryable = options.retryable;
  }
}

type ServiceKeyProvider = () => string | Promise<string>;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CommercialLicensesClientConfig {
  baseUrl: string;
  getServiceKey: ServiceKeyProvider;
  timeoutMs?: number;
  supportedSchemaMajor?: number;
  fetchImpl?: FetchImplementation;
}

type ParsedResponse =
  | PatentGetResponse
  | PatentTimelineResponse
  | PatentSearchResponse
  | PatentCoverageResponse
  | EstablishmentResolveResponse;

type ResponseParser<T extends ParsedResponse> = (value: unknown) => T;

export function createCommercialLicensesClient(
  config: CommercialLicensesClientConfig,
): CommercialLicensesClient {
  const baseUrl = parseBaseUrl(config.baseUrl);
  const timeoutMs = parseTimeout(config.timeoutMs);
  const supportedSchemaMajor = parseSchemaMajor(config.supportedSchemaMajor);
  const fetchImpl = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));

  async function request<T extends ParsedResponse>(options: {
    method: 'GET' | 'POST';
    path: string;
    query: URLSearchParams;
    releaseId?: string;
    effectiveOn?: string;
    representation?: CommercialLicensesRepresentation;
    body?: unknown;
    parse: ResponseParser<T>;
  }): Promise<T> {
    const representation = options.representation ?? 'public';
    if (representation !== 'public') {
      throw new CommercialLicensesClientError(
        'configuration',
        'Commercial licenses representation is unavailable',
      );
    }
    const serviceKey = await resolveServiceKey(config.getServiceKey);
    const url = new URL(options.path, baseUrl);
    url.search = options.query.toString();

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          'X-Service-Key': serviceKey,
          'User-Agent': USER_AGENT,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new CommercialLicensesClientError('timeout', 'Commercial licenses request timed out');
      }
      throw new CommercialLicensesClientError('network', 'Commercial licenses request failed');
    }

    const payload = await readJson(response);
    if (!response.ok) throwHttpError(response.status, payload);

    let parsed: T;
    try {
      parsed = options.parse(payload);
    } catch (error) {
      if (error instanceof CommercialLicensesContractError) {
        throw new CommercialLicensesClientError(
          'invalid_payload',
          'Commercial licenses response failed contract validation',
        );
      }
      throw new CommercialLicensesClientError(
        'invalid_payload',
        'Commercial licenses response could not be validated',
      );
    }

    if (options.releaseId !== undefined && parsed.metadata.release_id !== options.releaseId) {
      throw new CommercialLicensesClientError(
        'release_mismatch',
        'Commercial licenses response did not use the requested release',
      );
    }

    const [responseSchemaMajorText] = parsed.metadata.schema_version.split('.');
    const responseSchemaMajor = Number.parseInt(responseSchemaMajorText ?? '', 10);
    if (responseSchemaMajor !== supportedSchemaMajor) {
      throw new CommercialLicensesClientError(
        'schema_incompatible',
        'Commercial licenses response schema is incompatible',
      );
    }

    if (options.effectiveOn !== undefined) {
      if (!('effective_on' in parsed) || parsed.effective_on !== options.effectiveOn) {
        throw new CommercialLicensesClientError(
          'temporal_mismatch',
          'Commercial licenses response did not use the requested effective date',
        );
      }
    }

    if (representation === 'public' && parsed.metadata.data_marking !== 'PUBLIC') {
      throw new CommercialLicensesClientError(
        'representation_mismatch',
        'Commercial licenses response exceeded the requested representation',
      );
    }

    return parsed;
  }

  return {
    getPatent(params) {
      const query = commonQuery(params);
      addQuery(query, 'effective_on', params.effectiveOn);
      return request({
        method: 'GET',
        path: `v1/patents/${encodeURIComponent(params.municipalityCut)}/${encodeURIComponent(params.sourceLicenseId)}`,
        query,
        releaseId: params.releaseId,
        effectiveOn: params.effectiveOn,
        representation: params.representation,
        parse: parsePatentGetResponse,
      });
    },

    getPatentTimeline(params) {
      return request({
        method: 'GET',
        path: `v1/patents/${encodeURIComponent(params.municipalityCut)}/${encodeURIComponent(params.sourceLicenseId)}/timeline`,
        query: commonQuery(params),
        releaseId: params.releaseId,
        representation: params.representation,
        parse: parsePatentTimelineResponse,
      });
    },

    searchPatents(params) {
      const query = commonQuery(params);
      addQuery(query, 'municipality_cut', params.municipalityCut);
      addQuery(query, 'status', params.status);
      addQuery(query, 'license_type', params.licenseType);
      addQuery(query, 'activity', params.activity);
      addQuery(query, 'address', params.address);
      addQuery(query, 'establishment_id', params.establishmentId);
      addQuery(query, 'parcel_id', params.parcelId);
      addQuery(query, 'effective_on', params.effectiveOn);
      addQuery(query, 'cursor', params.cursor);
      addQuery(query, 'limit', params.limit);
      return request({
        method: 'GET',
        path: 'v1/patents/search',
        query,
        releaseId: params.releaseId,
        representation: params.representation,
        parse: parsePatentSearchResponse,
      });
    },

    getPatentCoverage(params) {
      const query = commonQuery(params);
      addQuery(query, 'municipality_cut', params.municipalityCut);
      addQuery(query, 'period_from', params.periodFrom);
      addQuery(query, 'period_to', params.periodTo);
      return request({
        method: 'GET',
        path: 'v1/patents/coverage',
        query,
        releaseId: params.releaseId,
        representation: params.representation,
        parse: parsePatentCoverageResponse,
      });
    },

    resolveEstablishment(resolveRequest, options = {}) {
      return request({
        method: 'POST',
        path: 'v1/establishments/resolve',
        query: commonQuery(options),
        releaseId: options.releaseId,
        representation: options.representation,
        body: resolveRequest,
        parse: parseEstablishmentResolveResponse,
      });
    },
  };
}

export interface CommercialLicensesEnvironment {
  CHILE_COMMERCIAL_LICENSES_BASE_URL?: string;
  CHILE_COMMERCIAL_LICENSES_SERVICE_KEY?: string;
  CHILE_COMMERCIAL_LICENSES_TIMEOUT_MS?: string;
}

/** Server-only environment adapter. No `VITE_*` credential is accepted. */
export function createCommercialLicensesClientFromEnv(
  env: CommercialLicensesEnvironment = process.env,
  fetchImpl?: FetchImplementation,
): CommercialLicensesClient {
  const baseUrl = env.CHILE_COMMERCIAL_LICENSES_BASE_URL;
  const serviceKey = env.CHILE_COMMERCIAL_LICENSES_SERVICE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new CommercialLicensesClientError(
      'configuration',
      'Commercial licenses environment configuration is unavailable',
    );
  }
  const timeoutText = env.CHILE_COMMERCIAL_LICENSES_TIMEOUT_MS;
  let timeoutMs: number | undefined;
  if (timeoutText !== undefined) {
    if (!/^\d{1,5}$/u.test(timeoutText)) {
      throw new CommercialLicensesClientError(
        'configuration',
        'Commercial licenses timeout environment value is invalid',
      );
    }
    timeoutMs = Number(timeoutText);
  }
  return createCommercialLicensesClient({
    baseUrl,
    getServiceKey: () => serviceKey,
    timeoutMs,
    fetchImpl,
  });
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CommercialLicensesClientError('configuration', 'Commercial licenses base URL is invalid');
  }
  if (
    (url.protocol !== 'https:' && !isPrivateHttpUrl(url)) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new CommercialLicensesClientError('configuration', 'Commercial licenses base URL is invalid');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function parseTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new CommercialLicensesClientError('configuration', 'Commercial licenses timeout is invalid');
  }
  return timeoutMs;
}

function parseSchemaMajor(value: number | undefined): number {
  const major = value ?? DEFAULT_SUPPORTED_SCHEMA_MAJOR;
  if (!Number.isSafeInteger(major) || major < 0) {
    throw new CommercialLicensesClientError(
      'configuration',
      'Commercial licenses supported schema major is invalid',
    );
  }
  return major;
}

async function resolveServiceKey(provider: ServiceKeyProvider): Promise<string> {
  let serviceKey: unknown;
  try {
    serviceKey = await provider();
  } catch {
    throw new CommercialLicensesClientError(
      'configuration',
      'Commercial licenses authentication is unavailable',
    );
  }
  if (
    typeof serviceKey !== 'string' ||
    serviceKey.length > 2_048 ||
    serviceKey.trim() === '' ||
    serviceKey !== serviceKey.trim() ||
    /[\r\n]/u.test(serviceKey)
  ) {
    throw new CommercialLicensesClientError(
      'configuration',
      'Commercial licenses authentication is unavailable',
    );
  }
  return serviceKey;
}

function isPrivateHttpUrl(url: URL): boolean {
  if (url.protocol !== 'http:') return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (/^127(?:\.\d{1,3}){3}$/u.test(hostname)) return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function commonQuery(params: CommercialLicensesRequestOptions): URLSearchParams {
  const query = new URLSearchParams();
  addQuery(query, 'release_id', params.releaseId);
  addQuery(query, 'representation', params.representation ?? 'public');
  return query;
}

function addQuery(
  query: URLSearchParams,
  name: string,
  value: string | number | undefined,
): void {
  if (value !== undefined) query.set(name, String(value));
}

async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new CommercialLicensesClientError('network', 'Commercial licenses response could not be read');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return undefined;
    throw new CommercialLicensesClientError(
      'invalid_json',
      'Commercial licenses response was not valid JSON',
      { status: response.status },
    );
  }
}

function throwHttpError(status: number, payload: unknown): never {
  const record = isRecord(payload) ? payload : undefined;
  const nestedError = isRecord(record?.error) ? record.error : undefined;
  const upstreamCode = typeof nestedError?.code === 'string'
    ? nestedError.code
    : typeof record?.code === 'string' ? record.code : undefined;
  const retryable = typeof nestedError?.retryable === 'boolean'
    ? nestedError.retryable
    : typeof record?.retryable === 'boolean' ? record.retryable : undefined;
  throw new CommercialLicensesClientError('http', 'Commercial licenses upstream returned an error', {
    status,
    upstreamCode,
    retryable,
  });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
