/**
 * Fail-closed runtime contract for Inteligencia Inmobiliaria's
 * `commercial-licenses` capability responses.
 *
 * The upstream is outside this process, so TypeScript types alone are not a
 * trust boundary. These parsers validate the complete response before a
 * handler or EvidencePacket may consume it.
 */

export type Availability = 'current' | 'stale_last_good';
export type DataMarking = 'PUBLIC' | 'MUNICIPAL_INTERNAL';
export type Representation = 'public' | 'municipal_restricted';
export type ResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';
export type MatchMethod =
  | 'source_role_exact'
  | 'normalized_address_exact'
  | 'spatial'
  | 'composite'
  | 'manual_review'
  | 'none';
export type LimitationCode =
  | 'data_gap'
  | 'stale_release'
  | 'restricted_field'
  | 'source_conflict'
  | 'unresolved_match'
  | 'ambiguous_match'
  | 'incomplete_timeline'
  | 'unavailable_capability'
  | 'other';

export interface CommercialLicensesReadOptions {
  release_id?: string;
  representation?: Representation;
}

export interface PatentGetParams extends CommercialLicensesReadOptions {
  municipality_cut: string;
  license_id: string;
  effective_on?: string;
}

export interface PatentTimelineParams extends CommercialLicensesReadOptions {
  municipality_cut: string;
  license_id: string;
}

export interface PatentSearchParams extends CommercialLicensesReadOptions {
  municipality_cut: string;
  status?: string;
  license_type?: string;
  activity?: string;
  legal_entity_rut?: string;
  address?: string;
  establishment_id?: string;
  parcel_id?: string;
  effective_on?: string;
  cursor?: string;
  limit?: number;
}

export interface PatentCoverageParams extends CommercialLicensesReadOptions {
  municipality_cut: string;
  period_from?: string;
  period_to?: string;
}

export interface EstablishmentResolveRequest {
  municipality_cut: string;
  address?: string;
  unit?: string | null;
  role?: string;
  effective_on?: string | null;
}

export interface ReleaseMetadata {
  producer: 'inteligencia-inmobiliaria';
  product: 'commercial-licenses';
  release_id: string;
  schema_version: string;
  data_as_of: string;
  promoted_at: string;
  quality_status: 'promoted';
  availability: Availability;
  data_marking: DataMarking;
  last_good_release_id: string | null;
  quality_report_uri: string;
}

export interface SourceRef {
  source_ref: string;
  source_kind: 'active_transparency' | 'access_response' | 'municipal_export' | 'administrative_act' | 'other';
  municipality_cut?: string;
  source_record_id?: string | null;
  uri?: string | null;
  sha256?: string | null;
  observed_at: string;
  effective_at?: string | null;
}

export interface Holder {
  holder_kind: 'legal_entity' | 'natural_person_redacted' | 'unknown';
  legal_entity_id?: string | null;
  legal_entity_rut?: string | null;
  display_name: string;
  valid_from: string;
  valid_to?: string | null;
  source_refs: string[];
}

export interface Address {
  original: string;
  normalized?: string | null;
  unit?: string | null;
  municipality_cut: string;
  valid_from?: string | null;
  valid_to?: string | null;
  source_refs: string[];
}

export interface Establishment {
  establishment_id: string;
  name?: string | null;
  address: Address;
  valid_from?: string | null;
  valid_to?: string | null;
  source_refs: string[];
}

export interface ParcelMatch {
  candidate_id: string;
  parcel_id?: string | null;
  role?: string | null;
  match_status: ResolutionStatus;
  method: MatchMethod;
  confidence: number;
  parcel_release_id: string;
  geometry?: Record<string, unknown> | null;
  explanation?: string | null;
  source_refs: string[];
}

export interface LicenseEvent {
  event_id: string;
  event_type:
    | 'application' | 'granted' | 'renewed' | 'modified' | 'holder_changed'
    | 'activity_changed' | 'address_changed' | 'provisional_converted'
    | 'suspended' | 'expired' | 'revoked' | 'closed' | 'reopened'
    | 'regularized' | 'other';
  effective_at?: string | null;
  observed_at: string;
  previous_status?: string | null;
  next_status?: string | null;
  administrative_act_ref?: string | null;
  source_refs: string[];
}

export interface LicenseActivity {
  activity: string;
  valid_from: string | null;
  valid_to?: string | null;
  source_refs: string[];
}

export interface Requirement {
  requirement_id: string;
  requirement_type: string;
  responsible_organization?: string | null;
  document_ref?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  reported_status: string;
  verified_at?: string | null;
  source_refs: string[];
}

export interface AdministrativeMeasure {
  measure_id: string;
  measure_type: 'requirement' | 'fine' | 'closure' | 'reopening' | 'filing' | 'other';
  effective_at?: string | null;
  observed_at: string;
  administrative_act_ref?: string | null;
  source_refs: string[];
}

export interface CommercialLicense {
  license_id: string;
  source_license_id: string;
  license_number?: string | null;
  municipality_cut: string;
  license_type: string;
  reported_status: string;
  provisional_status: 'provisional' | 'definitive' | 'unknown';
  applied_at?: string | null;
  granted_at?: string | null;
  renewed_at?: string | null;
  expires_at?: string | null;
  address: Address;
  holders: Holder[];
  activities: LicenseActivity[];
  source_refs: string[];
}

export interface Limitation {
  code: LimitationCode;
  message: string;
  affected_fields?: string[];
  source_refs?: string[];
}

interface ResponseEnvelope {
  metadata: ReleaseMetadata;
  source_refs: SourceRef[];
  limitations: Limitation[];
}

export interface PatentGetResponse extends ResponseEnvelope {
  effective_on?: string | null;
  license: CommercialLicense;
  timeline: LicenseEvent[];
  establishments: Establishment[];
  parcel_matches: ParcelMatch[];
  requirements: Requirement[];
  measures: AdministrativeMeasure[];
}

export interface PatentTimelineResponse extends ResponseEnvelope {
  license_id: string;
  events: LicenseEvent[];
}

export interface PatentSearchItem {
  license: CommercialLicense;
  establishments: Establishment[];
  parcel_matches: ParcelMatch[];
  limitations: Limitation[];
}

export interface PatentSearchResponse extends ResponseEnvelope {
  items: PatentSearchItem[];
  next_cursor?: string | null;
}

export interface Coverage {
  municipality_cut: string;
  period_from: string;
  period_to: string;
  declared_universe?: number | null;
  received_records: number;
  included_license_types: string[];
  available_fields: string[];
  freshness_status: 'current' | 'stale' | 'unknown';
  gaps: Limitation[];
}

export interface CommercialLicenseRefreshStatus {
  status: 'never_run' | 'running' | 'success' | 'partial' | 'failed';
  run_id?: string;
  trigger?: 'scheduled' | 'manual';
  started_at?: string;
  completed_at?: string | null;
  discovery_status?: 'not_run' | 'skipped' | 'success' | 'failed';
  discovered_resources?: number;
  candidate_resources?: number;
  pending_releases?: number;
  imported_releases?: number;
  failed_releases?: number;
}

export interface PatentCoverageResponse extends ResponseEnvelope {
  refresh: CommercialLicenseRefreshStatus;
  coverage: Coverage[];
}

export interface EstablishmentCandidate {
  candidate_id: string;
  establishment: Establishment;
  parcel_match: ParcelMatch;
}

export interface EstablishmentResolveResponse extends ResponseEnvelope {
  resolution_status: ResolutionStatus;
  selected_candidate_id: string | null;
  candidates: EstablishmentCandidate[];
}

export type CommercialLicensesResponse =
  | PatentGetResponse
  | PatentTimelineResponse
  | PatentSearchResponse
  | PatentCoverageResponse
  | EstablishmentResolveResponse;

export class CommercialLicensesContractError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'CommercialLicensesContractError';
    this.path = path;
  }
}

type JsonRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new CommercialLicensesContractError(path, message);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function record(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value as JsonRecord;
}

function strict(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): JsonRecord {
  const result = record(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) fail(`${path}.${key}`, 'is not allowed');
  for (const key of required) if (!hasOwn(result, key)) fail(`${path}.${key}`, 'is required');
  return result;
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) fail(path, 'must be a non-empty string');
  return value as string;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(path, `must be one of ${allowed.join(', ')}`);
  return value as T;
}

function number(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function integer(value: unknown, path: string): number {
  const result = number(value, path, 0);
  if (!Number.isSafeInteger(result)) fail(path, 'must be a non-negative safe integer');
  return result;
}

function array<T>(value: unknown, path: string, parse: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value.map((item, index) => parse(item, `${path}[${index}]`));
}

function stringArray(value: unknown, path: string, minimum = 0): string[] {
  const result = array(value, path, string);
  if (result.length < minimum) fail(path, `must contain at least ${minimum} item(s)`);
  if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
  return result;
}

function cut(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{5}$/.test(result)) fail(path, 'must be a five-digit CUT code');
  return result;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function dateTime(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result)
    || !isCalendarDate(result)
    || Number.isNaN(Date.parse(result))) {
    fail(path, 'must be an RFC 3339 date-time with timezone');
  }
  return result;
}

function nullableDateTime(value: unknown, path: string): string | null {
  return value === null ? null : dateTime(value, path);
}

function date(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !isCalendarDate(result)) fail(path, 'must be an ISO date');
  return result;
}

function uriReference(value: unknown, path: string): string {
  const result = string(value, path);
  if (/\s/.test(result)) fail(path, 'must be a URI reference without whitespace');
  try { new URL(result, 'file:///'); } catch { fail(path, 'must be a URI reference'); }
  return result;
}

function temporalOrder(from: string | null | undefined, to: string | null | undefined, path: string): void {
  if (from && to && Date.parse(from) > Date.parse(to)) fail(path, 'valid_from must not be after valid_to');
}

function parseReleaseMetadata(value: unknown, path: string): ReleaseMetadata {
  const v = strict(value, path, [
    'producer', 'product', 'release_id', 'schema_version', 'data_as_of', 'promoted_at', 'quality_status',
    'availability', 'data_marking', 'last_good_release_id', 'quality_report_uri',
  ]);
  const result: ReleaseMetadata = {
    producer: oneOf(v.producer, `${path}.producer`, ['inteligencia-inmobiliaria']),
    product: oneOf(v.product, `${path}.product`, ['commercial-licenses']),
    release_id: string(v.release_id, `${path}.release_id`),
    schema_version: string(v.schema_version, `${path}.schema_version`),
    data_as_of: dateTime(v.data_as_of, `${path}.data_as_of`),
    promoted_at: dateTime(v.promoted_at, `${path}.promoted_at`),
    quality_status: oneOf(v.quality_status, `${path}.quality_status`, ['promoted']),
    availability: oneOf(v.availability, `${path}.availability`, ['current', 'stale_last_good']),
    data_marking: oneOf(v.data_marking, `${path}.data_marking`, ['PUBLIC', 'MUNICIPAL_INTERNAL']),
    last_good_release_id: nullableString(v.last_good_release_id, `${path}.last_good_release_id`),
    quality_report_uri: uriReference(v.quality_report_uri, `${path}.quality_report_uri`),
  };
  if (!/^\d+\.\d+\.\d+$/.test(result.schema_version)) fail(`${path}.schema_version`, 'must use semantic x.y.z form');
  if (result.availability === 'stale_last_good' && !result.last_good_release_id) {
    fail(`${path}.last_good_release_id`, 'is required for stale_last_good availability');
  }
  if (Date.parse(result.promoted_at) < Date.parse(result.data_as_of)) fail(`${path}.promoted_at`, 'must not predate data_as_of');
  return result;
}

function parseSourceRef(value: unknown, path: string): SourceRef {
  const v = strict(value, path, ['source_ref', 'source_kind', 'observed_at'], [
    'municipality_cut', 'source_record_id', 'uri', 'sha256', 'effective_at',
  ]);
  const result: SourceRef = {
    source_ref: string(v.source_ref, `${path}.source_ref`),
    source_kind: oneOf(v.source_kind, `${path}.source_kind`, [
      'active_transparency', 'access_response', 'municipal_export', 'administrative_act', 'other',
    ]),
    observed_at: dateTime(v.observed_at, `${path}.observed_at`),
  };
  if (hasOwn(v, 'municipality_cut')) result.municipality_cut = cut(v.municipality_cut, `${path}.municipality_cut`);
  if (hasOwn(v, 'source_record_id')) result.source_record_id = nullableString(v.source_record_id, `${path}.source_record_id`);
  if (hasOwn(v, 'uri')) result.uri = v.uri === null ? null : uriReference(v.uri, `${path}.uri`);
  if (hasOwn(v, 'sha256')) {
    result.sha256 = nullableString(v.sha256, `${path}.sha256`);
    if (result.sha256 !== null && !/^[a-fA-F0-9]{64}$/.test(result.sha256)) fail(`${path}.sha256`, 'must be a 64-character hexadecimal digest');
  }
  if (hasOwn(v, 'effective_at')) result.effective_at = nullableDateTime(v.effective_at, `${path}.effective_at`);
  return result;
}

function parseHolder(value: unknown, path: string): Holder {
  const v = strict(value, path, ['holder_kind', 'display_name', 'valid_from', 'source_refs'], [
    'legal_entity_id', 'legal_entity_rut', 'valid_to',
  ]);
  const result: Holder = {
    holder_kind: oneOf(v.holder_kind, `${path}.holder_kind`, ['legal_entity', 'natural_person_redacted', 'unknown']),
    display_name: string(v.display_name, `${path}.display_name`),
    valid_from: dateTime(v.valid_from, `${path}.valid_from`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'legal_entity_id')) result.legal_entity_id = nullableString(v.legal_entity_id, `${path}.legal_entity_id`);
  if (hasOwn(v, 'legal_entity_rut')) {
    result.legal_entity_rut = nullableString(v.legal_entity_rut, `${path}.legal_entity_rut`);
    if (result.legal_entity_rut !== null && !/^\d{7,8}-[\dKk]$/.test(result.legal_entity_rut)) fail(`${path}.legal_entity_rut`, 'must be a Chilean legal-entity RUT without dots');
  }
  if (hasOwn(v, 'valid_to')) result.valid_to = nullableDateTime(v.valid_to, `${path}.valid_to`);
  temporalOrder(result.valid_from, result.valid_to, path);
  if (result.holder_kind === 'natural_person_redacted') {
    if (result.display_name !== 'REDACTED') fail(`${path}.display_name`, 'must be REDACTED for a natural person');
    if (result.legal_entity_id !== null || result.legal_entity_rut !== null) fail(path, 'natural-person identifiers must be null');
    if (!hasOwn(v, 'legal_entity_id') || !hasOwn(v, 'legal_entity_rut')) fail(path, 'redacted identifier fields must be explicitly null');
  } else if (result.legal_entity_rut && result.holder_kind !== 'legal_entity') {
    fail(`${path}.legal_entity_rut`, 'is only allowed for legal_entity holders');
  }
  return result;
}

function parseAddress(value: unknown, path: string): Address {
  const v = strict(value, path, ['original', 'municipality_cut', 'source_refs'], ['normalized', 'unit', 'valid_from', 'valid_to']);
  const result: Address = {
    original: string(v.original, `${path}.original`),
    municipality_cut: cut(v.municipality_cut, `${path}.municipality_cut`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'normalized')) result.normalized = nullableString(v.normalized, `${path}.normalized`);
  if (hasOwn(v, 'unit')) result.unit = nullableString(v.unit, `${path}.unit`);
  if (hasOwn(v, 'valid_from')) result.valid_from = nullableDateTime(v.valid_from, `${path}.valid_from`);
  if (hasOwn(v, 'valid_to')) result.valid_to = nullableDateTime(v.valid_to, `${path}.valid_to`);
  temporalOrder(result.valid_from, result.valid_to, path);
  return result;
}

function parseEstablishment(value: unknown, path: string): Establishment {
  const v = strict(value, path, ['establishment_id', 'address', 'source_refs'], ['name', 'valid_from', 'valid_to']);
  const result: Establishment = {
    establishment_id: string(v.establishment_id, `${path}.establishment_id`),
    address: parseAddress(v.address, `${path}.address`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'name')) result.name = nullableString(v.name, `${path}.name`);
  if (hasOwn(v, 'valid_from')) result.valid_from = nullableDateTime(v.valid_from, `${path}.valid_from`);
  if (hasOwn(v, 'valid_to')) result.valid_to = nullableDateTime(v.valid_to, `${path}.valid_to`);
  temporalOrder(result.valid_from, result.valid_to, path);
  return result;
}

function parseParcelMatch(value: unknown, path: string): ParcelMatch {
  const v = strict(value, path, ['candidate_id', 'match_status', 'method', 'confidence', 'parcel_release_id', 'source_refs'], [
    'parcel_id', 'role', 'geometry', 'explanation',
  ]);
  const result: ParcelMatch = {
    candidate_id: string(v.candidate_id, `${path}.candidate_id`),
    match_status: oneOf(v.match_status, `${path}.match_status`, ['resolved', 'ambiguous', 'unresolved']),
    method: oneOf(v.method, `${path}.method`, ['source_role_exact', 'normalized_address_exact', 'spatial', 'composite', 'manual_review', 'none']),
    confidence: number(v.confidence, `${path}.confidence`, 0, 1),
    parcel_release_id: string(v.parcel_release_id, `${path}.parcel_release_id`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`),
  };
  if (hasOwn(v, 'parcel_id')) result.parcel_id = nullableString(v.parcel_id, `${path}.parcel_id`);
  if (hasOwn(v, 'role')) result.role = nullableString(v.role, `${path}.role`);
  if (hasOwn(v, 'geometry')) result.geometry = v.geometry === null ? null : record(v.geometry, `${path}.geometry`);
  if (hasOwn(v, 'explanation')) result.explanation = nullableString(v.explanation, `${path}.explanation`);
  if (result.match_status === 'resolved' && !result.parcel_id) fail(`${path}.parcel_id`, 'must identify the resolved parcel');
  if (result.match_status === 'unresolved' && result.method !== 'none') fail(`${path}.method`, 'must be none for an unresolved match');
  return result;
}

function parseLicenseEvent(value: unknown, path: string): LicenseEvent {
  const v = strict(value, path, ['event_id', 'event_type', 'observed_at', 'source_refs'], [
    'effective_at', 'previous_status', 'next_status', 'administrative_act_ref',
  ]);
  const result: LicenseEvent = {
    event_id: string(v.event_id, `${path}.event_id`),
    event_type: oneOf(v.event_type, `${path}.event_type`, [
      'application', 'granted', 'renewed', 'modified', 'holder_changed', 'activity_changed', 'address_changed',
      'provisional_converted', 'suspended', 'expired', 'revoked', 'closed', 'reopened', 'regularized', 'other',
    ]),
    observed_at: dateTime(v.observed_at, `${path}.observed_at`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'effective_at')) result.effective_at = nullableDateTime(v.effective_at, `${path}.effective_at`);
  if (hasOwn(v, 'previous_status')) result.previous_status = nullableString(v.previous_status, `${path}.previous_status`);
  if (hasOwn(v, 'next_status')) result.next_status = nullableString(v.next_status, `${path}.next_status`);
  if (hasOwn(v, 'administrative_act_ref')) result.administrative_act_ref = nullableString(v.administrative_act_ref, `${path}.administrative_act_ref`);
  if (result.effective_at && Date.parse(result.effective_at) > Date.parse(result.observed_at)) {
    fail(`${path}.effective_at`, 'must not be after observed_at');
  }
  return result;
}

function parseLicenseActivity(value: unknown, path: string): LicenseActivity {
  const v = strict(value, path, ['activity', 'valid_from', 'source_refs'], ['valid_to']);
  const result: LicenseActivity = {
    activity: string(v.activity, `${path}.activity`),
    valid_from: nullableDateTime(v.valid_from, `${path}.valid_from`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'valid_to')) result.valid_to = nullableDateTime(v.valid_to, `${path}.valid_to`);
  temporalOrder(result.valid_from, result.valid_to, path);
  return result;
}

function parseRequirement(value: unknown, path: string): Requirement {
  const v = strict(value, path, ['requirement_id', 'requirement_type', 'reported_status', 'source_refs'], [
    'responsible_organization', 'document_ref', 'issued_at', 'expires_at', 'verified_at',
  ]);
  const result: Requirement = {
    requirement_id: string(v.requirement_id, `${path}.requirement_id`),
    requirement_type: string(v.requirement_type, `${path}.requirement_type`),
    reported_status: string(v.reported_status, `${path}.reported_status`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  for (const key of ['responsible_organization', 'document_ref'] as const) {
    if (hasOwn(v, key)) result[key] = nullableString(v[key], `${path}.${key}`);
  }
  for (const key of ['issued_at', 'expires_at', 'verified_at'] as const) {
    if (hasOwn(v, key)) result[key] = nullableDateTime(v[key], `${path}.${key}`);
  }
  if (result.issued_at && result.expires_at && Date.parse(result.issued_at) > Date.parse(result.expires_at)) fail(path, 'issued_at must not be after expires_at');
  return result;
}

function parseMeasure(value: unknown, path: string): AdministrativeMeasure {
  const v = strict(value, path, ['measure_id', 'measure_type', 'observed_at', 'source_refs'], [
    'effective_at', 'administrative_act_ref',
  ]);
  const result: AdministrativeMeasure = {
    measure_id: string(v.measure_id, `${path}.measure_id`),
    measure_type: oneOf(v.measure_type, `${path}.measure_type`, ['requirement', 'fine', 'closure', 'reopening', 'filing', 'other']),
    observed_at: dateTime(v.observed_at, `${path}.observed_at`),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'effective_at')) result.effective_at = nullableDateTime(v.effective_at, `${path}.effective_at`);
  if (hasOwn(v, 'administrative_act_ref')) result.administrative_act_ref = nullableString(v.administrative_act_ref, `${path}.administrative_act_ref`);
  return result;
}

function parseLicense(value: unknown, path: string): CommercialLicense {
  const v = strict(value, path, [
    'license_id', 'source_license_id', 'municipality_cut', 'license_type', 'reported_status', 'provisional_status',
    'address', 'holders', 'activities', 'source_refs',
  ], ['license_number', 'applied_at', 'granted_at', 'renewed_at', 'expires_at']);
  const result: CommercialLicense = {
    license_id: string(v.license_id, `${path}.license_id`),
    source_license_id: string(v.source_license_id, `${path}.source_license_id`),
    municipality_cut: cut(v.municipality_cut, `${path}.municipality_cut`),
    license_type: string(v.license_type, `${path}.license_type`),
    reported_status: string(v.reported_status, `${path}.reported_status`),
    provisional_status: oneOf(v.provisional_status, `${path}.provisional_status`, ['provisional', 'definitive', 'unknown']),
    address: parseAddress(v.address, `${path}.address`),
    holders: array(v.holders, `${path}.holders`, parseHolder),
    activities: array(v.activities, `${path}.activities`, parseLicenseActivity),
    source_refs: stringArray(v.source_refs, `${path}.source_refs`, 1),
  };
  if (hasOwn(v, 'license_number')) result.license_number = nullableString(v.license_number, `${path}.license_number`);
  for (const key of ['applied_at', 'granted_at', 'renewed_at', 'expires_at'] as const) {
    if (hasOwn(v, key)) result[key] = nullableDateTime(v[key], `${path}.${key}`);
  }
  if (result.address.municipality_cut !== result.municipality_cut) fail(`${path}.address.municipality_cut`, 'must match the license municipality_cut');
  return result;
}

function parseLimitation(value: unknown, path: string): Limitation {
  const v = strict(value, path, ['code', 'message'], ['affected_fields', 'source_refs']);
  const result: Limitation = {
    code: oneOf(v.code, `${path}.code`, [
      'data_gap', 'stale_release', 'restricted_field', 'source_conflict', 'unresolved_match', 'ambiguous_match',
      'incomplete_timeline', 'unavailable_capability', 'other',
    ]),
    message: string(v.message, `${path}.message`),
  };
  if (hasOwn(v, 'affected_fields')) result.affected_fields = stringArray(v.affected_fields, `${path}.affected_fields`);
  if (hasOwn(v, 'source_refs')) result.source_refs = stringArray(v.source_refs, `${path}.source_refs`);
  return result;
}

interface ParsedEnvelope extends ResponseEnvelope { sourceIds: Set<string> }

function parseEnvelope(v: JsonRecord, path: string): ParsedEnvelope {
  const metadata = parseReleaseMetadata(v.metadata, `${path}.metadata`);
  const source_refs = array(v.source_refs, `${path}.source_refs`, parseSourceRef);
  const sourceIds = new Set<string>();
  for (const [index, source] of source_refs.entries()) {
    const id = source.source_ref;
    if (sourceIds.has(id)) fail(`${path}.source_refs[${index}].source_ref`, 'must be unique');
    sourceIds.add(id);
  }
  return { metadata, source_refs, limitations: array(v.limitations, `${path}.limitations`, parseLimitation), sourceIds };
}

function assertSourceLinks(value: unknown, sourceIds: Set<string>, path: string, key = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSourceLinks(item, sourceIds, `${path}[${index}]`, key));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [childKey, child] of Object.entries(value as JsonRecord)) {
    const childPath = `${path}.${childKey}`;
    if (childKey === 'source_refs' && Array.isArray(child) && key !== '') {
      child.forEach((ref, index) => {
        if (typeof ref === 'string' && !sourceIds.has(ref)) fail(`${childPath}[${index}]`, `references unknown source_ref ${ref}`);
      });
    } else {
      assertSourceLinks(child, sourceIds, childPath, childKey);
    }
  }
}

function assertTimelineOrder(events: LicenseEvent[], path: string): void {
  let previousPrimary = -Infinity;
  let previousObserved = -Infinity;
  for (const [index, event] of events.entries()) {
    const primary = Date.parse(event.effective_at ?? event.observed_at);
    const observed = Date.parse(event.observed_at);
    if (primary < previousPrimary || (primary === previousPrimary && observed < previousObserved)) {
      fail(`${path}[${index}]`, 'events must be ordered by effective_at and observed_at');
    }
    previousPrimary = primary;
    previousObserved = observed;
  }
}

function finalize<T extends ResponseEnvelope>(result: T, sourceIds: Set<string>, path: string): T {
  assertSourceLinks(result, sourceIds, path);
  if (result.metadata.availability === 'stale_last_good' && !result.limitations.some((item) => item.code === 'stale_release')) {
    fail(`${path}.limitations`, 'must include stale_release when serving stale_last_good data');
  }
  return result;
}

export function parsePatentGetResponse(value: unknown): PatentGetResponse {
  const path = '$';
  const v = strict(value, path, [
    'metadata', 'license', 'timeline', 'establishments', 'parcel_matches', 'requirements', 'measures', 'source_refs', 'limitations',
  ], ['effective_on']);
  const envelope = parseEnvelope(v, path);
  const result: PatentGetResponse = {
    metadata: envelope.metadata,
    license: parseLicense(v.license, '$.license'),
    timeline: array(v.timeline, '$.timeline', parseLicenseEvent),
    establishments: array(v.establishments, '$.establishments', parseEstablishment),
    parcel_matches: array(v.parcel_matches, '$.parcel_matches', parseParcelMatch),
    requirements: array(v.requirements, '$.requirements', parseRequirement),
    measures: array(v.measures, '$.measures', parseMeasure),
    source_refs: envelope.source_refs,
    limitations: envelope.limitations,
  };
  if (hasOwn(v, 'effective_on')) result.effective_on = v.effective_on === null ? null : date(v.effective_on, '$.effective_on');
  assertTimelineOrder(result.timeline, '$.timeline');
  return finalize(result, envelope.sourceIds, path);
}

export function parsePatentTimelineResponse(value: unknown): PatentTimelineResponse {
  const v = strict(value, '$', ['metadata', 'license_id', 'events', 'source_refs', 'limitations']);
  const envelope = parseEnvelope(v, '$');
  const result: PatentTimelineResponse = {
    metadata: envelope.metadata,
    license_id: string(v.license_id, '$.license_id'),
    events: array(v.events, '$.events', parseLicenseEvent),
    source_refs: envelope.source_refs,
    limitations: envelope.limitations,
  };
  assertTimelineOrder(result.events, '$.events');
  return finalize(result, envelope.sourceIds, '$');
}

function parseSearchItem(value: unknown, path: string): PatentSearchItem {
  const v = strict(value, path, ['license', 'establishments', 'parcel_matches', 'limitations']);
  return {
    license: parseLicense(v.license, `${path}.license`),
    establishments: array(v.establishments, `${path}.establishments`, parseEstablishment),
    parcel_matches: array(v.parcel_matches, `${path}.parcel_matches`, parseParcelMatch),
    limitations: array(v.limitations, `${path}.limitations`, parseLimitation),
  };
}

export function parsePatentSearchResponse(value: unknown): PatentSearchResponse {
  const v = strict(value, '$', ['metadata', 'items', 'source_refs', 'limitations'], ['next_cursor']);
  const envelope = parseEnvelope(v, '$');
  const result: PatentSearchResponse = {
    metadata: envelope.metadata,
    items: array(v.items, '$.items', parseSearchItem),
    source_refs: envelope.source_refs,
    limitations: envelope.limitations,
  };
  if (hasOwn(v, 'next_cursor')) result.next_cursor = nullableString(v.next_cursor, '$.next_cursor');
  return finalize(result, envelope.sourceIds, '$');
}

function parseCoverage(value: unknown, path: string): Coverage {
  const v = strict(value, path, [
    'municipality_cut', 'period_from', 'period_to', 'received_records', 'included_license_types',
    'available_fields', 'freshness_status', 'gaps',
  ], ['declared_universe']);
  const result: Coverage = {
    municipality_cut: cut(v.municipality_cut, `${path}.municipality_cut`),
    period_from: date(v.period_from, `${path}.period_from`),
    period_to: date(v.period_to, `${path}.period_to`),
    received_records: integer(v.received_records, `${path}.received_records`),
    included_license_types: stringArray(v.included_license_types, `${path}.included_license_types`),
    available_fields: stringArray(v.available_fields, `${path}.available_fields`),
    freshness_status: oneOf(v.freshness_status, `${path}.freshness_status`, ['current', 'stale', 'unknown']),
    gaps: array(v.gaps, `${path}.gaps`, parseLimitation),
  };
  if (hasOwn(v, 'declared_universe')) result.declared_universe = v.declared_universe === null ? null : integer(v.declared_universe, `${path}.declared_universe`);
  if (result.period_from > result.period_to) fail(path, 'period_from must not be after period_to');
  return result;
}

function parseRefreshStatus(value: unknown, path: string): CommercialLicenseRefreshStatus {
  const fields = [
    'run_id', 'trigger', 'started_at', 'completed_at', 'discovery_status',
    'discovered_resources', 'candidate_resources', 'pending_releases',
    'imported_releases', 'failed_releases',
  ] as const;
  const initial = strict(value, path, ['status'], fields);
  const status = oneOf(initial.status, `${path}.status`, [
    'never_run', 'running', 'success', 'partial', 'failed',
  ]);
  if (status === 'never_run') return { status };
  const v = strict(value, path, ['status', ...fields]);
  const result: CommercialLicenseRefreshStatus = {
    status,
    run_id: string(v.run_id, `${path}.run_id`),
    trigger: oneOf(v.trigger, `${path}.trigger`, ['scheduled', 'manual'] as const),
    started_at: dateTime(v.started_at, `${path}.started_at`),
    completed_at: nullableDateTime(v.completed_at, `${path}.completed_at`),
    discovery_status: oneOf(v.discovery_status, `${path}.discovery_status`, [
      'not_run', 'skipped', 'success', 'failed',
    ] as const),
    discovered_resources: integer(v.discovered_resources, `${path}.discovered_resources`),
    candidate_resources: integer(v.candidate_resources, `${path}.candidate_resources`),
    pending_releases: integer(v.pending_releases, `${path}.pending_releases`),
    imported_releases: integer(v.imported_releases, `${path}.imported_releases`),
    failed_releases: integer(v.failed_releases, `${path}.failed_releases`),
  };
  if (status === 'running' && result.completed_at !== null) {
    fail(`${path}.completed_at`, 'must be null while status is running');
  }
  if (status !== 'running' && result.completed_at === null) {
    fail(`${path}.completed_at`, 'must be present after the run completes');
  }
  if (result.completed_at && result.started_at && result.started_at > result.completed_at) {
    fail(path, 'started_at must not be after completed_at');
  }
  if (status === 'success' && result.failed_releases !== 0) {
    fail(`${path}.failed_releases`, 'must be zero for a successful run');
  }
  if ((status === 'partial' || status === 'failed') && result.failed_releases === 0) {
    fail(`${path}.failed_releases`, 'must be positive for a failed run');
  }
  return result;
}

export function parsePatentCoverageResponse(value: unknown): PatentCoverageResponse {
  const v = strict(value, '$', ['metadata', 'refresh', 'coverage', 'source_refs', 'limitations']);
  const envelope = parseEnvelope(v, '$');
  const result: PatentCoverageResponse = {
    metadata: envelope.metadata,
    refresh: parseRefreshStatus(v.refresh, '$.refresh'),
    coverage: array(v.coverage, '$.coverage', parseCoverage),
    source_refs: envelope.source_refs,
    limitations: envelope.limitations,
  };
  return finalize(result, envelope.sourceIds, '$');
}

function parseCandidate(value: unknown, path: string): EstablishmentCandidate {
  const v = strict(value, path, ['candidate_id', 'establishment', 'parcel_match']);
  const candidate_id = string(v.candidate_id, `${path}.candidate_id`);
  const parcel_match = parseParcelMatch(v.parcel_match, `${path}.parcel_match`);
  if (parcel_match.candidate_id !== candidate_id) fail(`${path}.parcel_match.candidate_id`, 'must match candidate_id');
  return { candidate_id, establishment: parseEstablishment(v.establishment, `${path}.establishment`), parcel_match };
}

export function parseEstablishmentResolveResponse(value: unknown): EstablishmentResolveResponse {
  const v = strict(value, '$', [
    'metadata', 'resolution_status', 'selected_candidate_id', 'candidates', 'source_refs', 'limitations',
  ]);
  const envelope = parseEnvelope(v, '$');
  const result: EstablishmentResolveResponse = {
    metadata: envelope.metadata,
    resolution_status: oneOf(v.resolution_status, '$.resolution_status', ['resolved', 'ambiguous', 'unresolved']),
    selected_candidate_id: nullableString(v.selected_candidate_id, '$.selected_candidate_id'),
    candidates: array(v.candidates, '$.candidates', parseCandidate),
    source_refs: envelope.source_refs,
    limitations: envelope.limitations,
  };
  const candidateIds = new Set(result.candidates.map((candidate) => candidate.candidate_id));
  if (candidateIds.size !== result.candidates.length) fail('$.candidates', 'candidate_id values must be unique');
  if (result.resolution_status === 'resolved') {
    if (!result.selected_candidate_id) fail('$.selected_candidate_id', 'must be non-null for resolved results');
    const selected = result.candidates.find((candidate) => candidate.candidate_id === result.selected_candidate_id);
    if (!selected) fail('$.selected_candidate_id', 'must identify a returned candidate');
    if (selected.parcel_match.match_status !== 'resolved') fail('$.selected_candidate_id', 'must identify a resolved parcel match');
  } else if (result.selected_candidate_id !== null) {
    fail('$.selected_candidate_id', 'must be null unless resolution_status is resolved');
  }
  if (result.resolution_status === 'ambiguous') {
    if (result.candidates.length < 2) fail('$.candidates', 'must contain at least two candidates for ambiguous results');
    if (!result.limitations.some((item) => item.code === 'ambiguous_match')) fail('$.limitations', 'must include ambiguous_match');
  }
  if (result.resolution_status === 'unresolved') {
    if (result.candidates.length !== 0) fail('$.candidates', 'must be empty for unresolved results');
    if (!result.limitations.some((item) => item.code === 'unresolved_match')) fail('$.limitations', 'must include unresolved_match');
  }
  return finalize(result, envelope.sourceIds, '$');
}
