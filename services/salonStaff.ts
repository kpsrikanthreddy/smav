export interface NormalizedStylist {
  id: string;
  name: string;
  role: string;
  outletId: string;
  available: boolean;
}

export type StaffDiagnosticCode =
  | 'OK'
  | 'NO_ACTIVE_STAFF'
  | 'STAFF_CONFIG_ERROR'
  | 'STAFF_UPSTREAM_AUTH_ERROR'
  | 'STAFF_UPSTREAM_HTTP_ERROR'
  | 'STAFF_UPSTREAM_TIMEOUT'
  | 'STAFF_UPSTREAM_NETWORK_ERROR'
  | 'STAFF_INVALID_JSON'
  | 'STAFF_MAPPING_ERROR';

export interface OutletMatchTarget {
  id: string;
  code: string;
  name?: string;
  supabaseUrl?: string;
}

export interface SalonStaffFetchResult {
  success: boolean;
  stylists: NormalizedStylist[];
  upstreamStatus: number | null;
  diagnosticCode: StaffDiagnosticCode;
  message: string | null;
}

export interface FetchGlossyLooksStaffOptions {
  outlet: OutletMatchTarget;
  staffApiUrl?: string;
  integrationKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_GLOSSY_LOOKS_STAFF_URL = 'https://www.glossylooks.in/api/staff';
const GLOSSY_FLAGSHIP_BRANCH_ID = 'tgl-gachibowli-main';

const ACTIVE_STATUS_TOKENS = new Set(['true', '1', 'active', 'enabled', 'available']);
const INACTIVE_STATUS_TOKENS = new Set([
  'false',
  '0',
  'inactive',
  'disabled',
  'unavailable',
  'deleted',
  'terminated',
  'archived',
  'suspended',
  'on_leave'
]);

const SALON_ROLE_PATTERN =
  /\b(stylist|beautician|therapist|barber|technician|salon[\s_-]*staff|hair[\s_-]*dresser|hair[\s_-]*stylist)\b/i;

function firstNonEmptyString(...values: unknown[]): string {
  for (const val of values) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length > 0) return trimmed;
    } else if (typeof val === 'number' && Number.isFinite(val)) {
      return String(val);
    }
  }
  return '';
}

function combineNameParts(first: unknown, last: unknown): string {
  const firstStr = firstNonEmptyString(first);
  const lastStr = firstNonEmptyString(last);
  return [firstStr, lastStr].filter(Boolean).join(' ').trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatusFlag(value: unknown): 'active' | 'inactive' | 'unknown' {
  if (typeof value === 'boolean') return value ? 'active' : 'inactive';
  if (typeof value === 'number') {
    if (value === 1) return 'active';
    if (value === 0) return 'inactive';
    return 'unknown';
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return 'unknown';
    if (ACTIVE_STATUS_TOKENS.has(normalized)) return 'active';
    if (INACTIVE_STATUS_TOKENS.has(normalized)) return 'inactive';
  }
  return 'unknown';
}

export function isStaffRecordActive(record: Record<string, unknown>): boolean {
  if (record.is_deleted === true || record.isDeleted === true) return false;
  if (record.deleted_at !== undefined && record.deleted_at !== null && String(record.deleted_at).trim() !== '') {
    return false;
  }

  const boolCandidates = [record.is_active, record.isActive, record.active].filter(
    v => v !== undefined && v !== null && String(v).trim() !== ''
  );

  for (const candidate of boolCandidates) {
    const parsed = parseStatusFlag(candidate);
    if (parsed !== 'active') return false;
  }

  if (record.status !== undefined && record.status !== null && String(record.status).trim() !== '') {
    const parsedStatus = parseStatusFlag(record.status);
    if (parsedStatus !== 'active') return false;
  }

  if (record.available !== undefined && record.available !== null && String(record.available).trim() !== '') {
    const parsedAvail = parseStatusFlag(record.available);
    if (parsedAvail !== 'active') return false;
  }

  return true;
}

export function normalizeSalonRole(record: Record<string, unknown>): { accepted: boolean; role: string } {
  const rawRole = firstNonEmptyString(
    record.role,
    record.designation,
    record.jobTitle,
    record.job_title,
    record.specialty
  );
  if (!rawRole) {
    return { accepted: true, role: 'Salon Staff' };
  }
  if (!SALON_ROLE_PATTERN.test(rawRole)) {
    return { accepted: false, role: rawRole };
  }
  return { accepted: true, role: rawRole };
}

export function extractStaffCollection(payload: unknown): { ok: true; rows: unknown[] } | { ok: false } {
  if (Array.isArray(payload)) {
    return { ok: true, rows: payload };
  }
  if (!isPlainRecord(payload)) {
    return { ok: false };
  }

  const directKeys = ['staff', 'stylists', 'employees', 'users', 'data'] as const;
  for (const key of directKeys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return { ok: true, rows: candidate };
    }
  }

  // Handle nested { data: { staff: [...] } } wrappers safely
  if (isPlainRecord(payload.data)) {
    for (const key of ['staff', 'stylists', 'employees', 'users'] as const) {
      const nested = payload.data[key];
      if (Array.isArray(nested)) {
        return { ok: true, rows: nested };
      }
    }
  }

  return { ok: false };
}

export function isGlossyLooksOutlet(outlet: OutletMatchTarget): boolean {
  const code = (outlet.code || '').trim().toLowerCase();
  const id = (outlet.id || '').trim().toLowerCase();
  const name = (outlet.name || '').trim().toLowerCase();
  const supa = (outlet.supabaseUrl || '').trim().toLowerCase();
  return (
    code === 'glossylooks' ||
    id === 'outlet_glossy_gach' ||
    supa.includes('onswigwiwuvkvoduuhxr') ||
    name.includes('glossy looks')
  );
}

function getExpectedOutletTokens(outlet: OutletMatchTarget): Set<string> {
  const tokens = new Set<string>();
  const id = (outlet.id || '').trim().toLowerCase();
  const code = (outlet.code || '').trim().toLowerCase();
  if (id) tokens.add(id);
  if (code) tokens.add(code);

  // Glossy Looks Gachibowli flagship uses branch_id "tgl-gachibowli-main" upstream
  // alongside central_outlet_code "glossylooks" and central id "outlet_glossy_gach".
  if (code === 'glossylooks' || id === 'outlet_glossy_gach') {
    tokens.add(GLOSSY_FLAGSHIP_BRANCH_ID);
    tokens.add('the_glossy_looks');
    tokens.add('glossylooks');
    tokens.add('outlet_glossy_gach');
  }
  return tokens;
}

export function matchStaffOutlet(
  record: Record<string, unknown>,
  outlet: OutletMatchTarget
): { matched: boolean; outletId: string } {
  const candidates = [
    firstNonEmptyString(record.branchId, record.branch_id),
    firstNonEmptyString(record.outletId, record.outlet_id),
    firstNonEmptyString(record.outletCode, record.outlet_code),
    firstNonEmptyString(record.centralOutletCode, record.central_outlet_code)
  ].filter(Boolean);

  if (candidates.length === 0) {
    return { matched: true, outletId: outlet.id };
  }

  const expected = getExpectedOutletTokens(outlet);
  for (const candidate of candidates) {
    if (expected.has(candidate.toLowerCase())) {
      return { matched: true, outletId: outlet.id || candidate };
    }
  }

  return { matched: false, outletId: '' };
}

export function normalizeUpstreamStaffPayload(
  payload: unknown,
  outlet: OutletMatchTarget
): SalonStaffFetchResult {
  const extracted = extractStaffCollection(payload);
  if (!extracted.ok) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'STAFF_MAPPING_ERROR',
      message: 'Upstream Glossy Looks staff response could not be mapped to a staff list.'
    };
  }

  if (extracted.rows.length === 0) {
    return {
      success: true,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'NO_ACTIVE_STAFF',
      message: 'No active stylists returned for this outlet from the Glossy Looks staff API.'
    };
  }

  let validIdentityCount = 0;
  const stylists: NormalizedStylist[] = [];
  const seenIds = new Set<string>();

  for (const row of extracted.rows) {
    if (!isPlainRecord(row)) continue;

    const id = firstNonEmptyString(row.id, row.staffId, row.staff_id, row.userId, row.user_id);
    const name = firstNonEmptyString(
      row.name,
      row.fullName,
      row.full_name,
      row.displayName,
      combineNameParts(row.firstName ?? row.first_name, row.lastName ?? row.last_name)
    );

    if (!id || !name) continue;
    validIdentityCount += 1;

    if (!isStaffRecordActive(row)) continue;

    const roleCheck = normalizeSalonRole(row);
    if (!roleCheck.accepted) continue;

    const outletMatch = matchStaffOutlet(row, outlet);
    if (!outletMatch.matched) continue;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    stylists.push({
      id,
      name,
      role: roleCheck.role,
      outletId: outletMatch.outletId,
      available: true
    });
  }

  if (validIdentityCount === 0) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'STAFF_MAPPING_ERROR',
      message: 'Upstream Glossy Looks staff records could not be mapped (missing ID or name fields).'
    };
  }

  if (stylists.length === 0) {
    return {
      success: true,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'NO_ACTIVE_STAFF',
      message: 'No active stylists returned for this outlet from the Glossy Looks staff API.'
    };
  }

  return {
    success: true,
    stylists,
    upstreamStatus: 200,
    diagnosticCode: 'OK',
    message: null
  };
}

export async function fetchGlossyLooksStaff(
  options: FetchGlossyLooksStaffOptions
): Promise<SalonStaffFetchResult> {
  const {
    outlet,
    staffApiUrl = DEFAULT_GLOSSY_LOOKS_STAFF_URL,
    integrationKey = process.env.GLOSSYLOOKS_INTEGRATION_KEY?.trim() || '',
    timeoutMs = 8000,
    fetchImpl = fetch
  } = options;

  if (!isGlossyLooksOutlet(outlet)) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: null,
      diagnosticCode: 'STAFF_CONFIG_ERROR',
      message: `No upstream salon staff adapter is configured for outlet "${outlet.code || outlet.id}".`
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(staffApiUrl);
    if (parsedUrl.protocol !== 'https:') {
      return {
        success: false,
        stylists: [],
        upstreamStatus: null,
        diagnosticCode: 'STAFF_CONFIG_ERROR',
        message: 'Upstream salon staff API URL configuration is invalid (HTTPS required).'
      };
    }
  } catch {
    return {
      success: false,
      stylists: [],
      upstreamStatus: null,
      diagnosticCode: 'STAFF_CONFIG_ERROR',
      message: 'Upstream salon staff API URL is not configured.'
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (integrationKey) {
    headers['X-Integration-Key'] = integrationKey;
  }

  let response: Response;
  try {
    response = await fetchImpl(parsedUrl.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err: any) {
    const errName = String(err?.name || '');
    const errMsg = String(err?.message || '').toLowerCase();
    const isTimeout =
      errName === 'TimeoutError' ||
      errName === 'AbortError' ||
      errMsg.includes('timed out') ||
      errMsg.includes('timeout') ||
      errMsg.includes('aborted');

    return {
      success: false,
      stylists: [],
      upstreamStatus: isTimeout ? 504 : 502,
      diagnosticCode: isTimeout ? 'STAFF_UPSTREAM_TIMEOUT' : 'STAFF_UPSTREAM_NETWORK_ERROR',
      message: isTimeout
        ? 'Upstream Glossy Looks staff API timed out. Please retry.'
        : 'Could not connect to the upstream Glossy Looks staff API.'
    };
  }

  if (response.status === 401 || response.status === 403) {
    if (!integrationKey) {
      return {
        success: false,
        stylists: [],
        upstreamStatus: response.status,
        diagnosticCode: 'STAFF_CONFIG_ERROR',
        message: `Glossy Looks integration key is missing or unauthorized (upstream HTTP ${response.status}). Configure GLOSSYLOOKS_INTEGRATION_KEY.`
      };
    }
    return {
      success: false,
      stylists: [],
      upstreamStatus: response.status,
      diagnosticCode: 'STAFF_UPSTREAM_AUTH_ERROR',
      message: `Upstream Glossy Looks staff API rejected authorization (HTTP ${response.status}). Verify integration key permissions.`
    };
  }

  if (!response.ok) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: response.status,
      diagnosticCode: 'STAFF_UPSTREAM_HTTP_ERROR',
      message: `Upstream Glossy Looks staff API failed with HTTP ${response.status}.`
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      success: false,
      stylists: [],
      upstreamStatus: response.status,
      diagnosticCode: 'STAFF_INVALID_JSON',
      message: `Upstream Glossy Looks staff API returned invalid JSON (HTTP ${response.status}).`
    };
  }

  return normalizeUpstreamStaffPayload(payload, outlet);
}
