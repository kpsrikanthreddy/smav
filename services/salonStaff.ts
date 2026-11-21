export interface NormalizedStylist {
  id: string;
  name: string;
  role: string;
  sourceRole?: CanonicalGlossyUserRole;
  smavRole?: 'ADMIN' | 'POS_BILLING';
  outletId: string;
  available: boolean;
}

export type CanonicalGlossyUserRole =
  | 'OWNER'
  | 'MANAGER'
  | 'ADMIN'
  | 'STYLIST'
  | 'RECEPTIONIST'
  | 'INVENTORY_STAFF'
  | 'POS_BILLING'
  | 'STAFF';

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
  knownBranchIds?: string[];
}

export interface SalonStaffFetchResult {
  success: boolean;
  stylists: NormalizedStylist[];
  upstreamStatus: number | null;
  diagnosticCode: StaffDiagnosticCode;
  message: string | null;
}

export interface AuthoritativeGlossyUserRecord {
  id?: string | null;
  user_id?: string | null;
  staff_id?: string | null;
  email?: string | null;
  username?: string | null;
  phone?: string | null;
  full_name?: string | null;
  name?: string | null;
  role?: string | null;
  is_active?: boolean | null;
}

export interface FetchGlossyLooksStaffOptions {
  outlet: OutletMatchTarget;
  staffApiUrl?: string;
  integrationKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Optional authoritative Glossy Looks public.users rows used to override public.staff.role job titles */
  authoritativeUsers?: AuthoritativeGlossyUserRecord[];
  glossySupabaseUrl?: string;
  glossySupabaseServiceKey?: string;
}

const DEFAULT_GLOSSY_LOOKS_STAFF_URL = 'https://www.glossylooks.in/api/staff';

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
  'on_leave',
]);

const CANONICAL_USER_ROLE_SET = new Set<string>([
  'OWNER',
  'MANAGER',
  'ADMIN',
  'STYLIST',
  'RECEPTIONIST',
  'INVENTORY_STAFF',
  'POS_BILLING',
  'STAFF',
  'SUPERADMIN',
]);

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

function normalizePhoneLookupKey(phone: unknown): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
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
    (v) => v !== undefined && v !== null && String(v).trim() !== ''
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

/**
 * Normalizes a raw authoritative `public.users.role` token into a canonical Glossy Looks role.
 * NEVER falls back to free-text job titles from `public.staff.role`.
 */
export function parseCanonicalGlossyUserRole(rawValue: unknown): CanonicalGlossyUserRole | 'SUPERADMIN' | null {
  const token = String(rawValue || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!token) return null;
  if (CANONICAL_USER_ROLE_SET.has(token)) {
    return token as CanonicalGlossyUserRole | 'SUPERADMIN';
  }
  return null;
}

export function formatAuthoritativeDisplayRole(canonicalRole: CanonicalGlossyUserRole | null | undefined): string {
  switch (canonicalRole) {
    case 'STYLIST':
      return 'Stylist';
    case 'RECEPTIONIST':
      return 'Receptionist';
    case 'INVENTORY_STAFF':
      return 'Inventory Staff';
    case 'MANAGER':
      return 'Manager';
    case 'OWNER':
      return 'Owner';
    case 'ADMIN':
      return 'Admin';
    case 'POS_BILLING':
    case 'STAFF':
      return 'POS Billing';
    default:
      return 'POS Billing';
  }
}

export function mapAuthoritativeGlossyRoleToSmav(rawRole: unknown): {
  canonicalRole: CanonicalGlossyUserRole;
  displayRole: string;
  smavRole: 'ADMIN' | 'STAFF';
  contractRole: 'ADMIN' | 'POS_BILLING';
  edgeRoleHint: 'OWNER' | 'MANAGER' | 'ADMIN' | 'STYLIST' | 'RECEPTIONIST' | 'INVENTORY_STAFF';
  isProtectedSuperadmin: boolean;
} {
  const parsed = parseCanonicalGlossyUserRole(rawRole);
  if (parsed === 'SUPERADMIN') {
    return {
      canonicalRole: 'ADMIN',
      displayRole: 'Admin',
      smavRole: 'ADMIN',
      contractRole: 'ADMIN',
      edgeRoleHint: 'ADMIN',
      isProtectedSuperadmin: true,
    };
  }

  switch (parsed) {
    case 'OWNER':
      return {
        canonicalRole: 'OWNER',
        displayRole: 'Owner',
        smavRole: 'ADMIN',
        contractRole: 'ADMIN',
        edgeRoleHint: 'OWNER',
        isProtectedSuperadmin: false,
      };
    case 'MANAGER':
      return {
        canonicalRole: 'MANAGER',
        displayRole: 'Manager',
        smavRole: 'ADMIN',
        contractRole: 'ADMIN',
        edgeRoleHint: 'MANAGER',
        isProtectedSuperadmin: false,
      };
    case 'ADMIN':
      return {
        canonicalRole: 'ADMIN',
        displayRole: 'Admin',
        smavRole: 'ADMIN',
        contractRole: 'ADMIN',
        edgeRoleHint: 'ADMIN',
        isProtectedSuperadmin: false,
      };
    case 'STYLIST':
      return {
        canonicalRole: 'STYLIST',
        displayRole: 'Stylist',
        smavRole: 'STAFF',
        contractRole: 'POS_BILLING',
        edgeRoleHint: 'STYLIST',
        isProtectedSuperadmin: false,
      };
    case 'INVENTORY_STAFF':
      return {
        canonicalRole: 'INVENTORY_STAFF',
        displayRole: 'Inventory Staff',
        smavRole: 'STAFF',
        contractRole: 'POS_BILLING',
        edgeRoleHint: 'INVENTORY_STAFF',
        isProtectedSuperadmin: false,
      };
    case 'RECEPTIONIST':
      return {
        canonicalRole: 'RECEPTIONIST',
        displayRole: 'Receptionist',
        smavRole: 'STAFF',
        contractRole: 'POS_BILLING',
        edgeRoleHint: 'RECEPTIONIST',
        isProtectedSuperadmin: false,
      };
    case 'POS_BILLING':
    case 'STAFF':
    default:
      return {
        canonicalRole: parsed || 'POS_BILLING',
        displayRole: formatAuthoritativeDisplayRole(parsed || 'POS_BILLING'),
        smavRole: 'STAFF',
        contractRole: 'POS_BILLING',
        edgeRoleHint: 'RECEPTIONIST',
        isProtectedSuperadmin: false,
      };
  }
}

export interface AuthoritativeUserRoleIndex {
  byId: Map<string, AuthoritativeGlossyUserRecord>;
  byEmail: Map<string, AuthoritativeGlossyUserRecord>;
  byUsername: Map<string, AuthoritativeGlossyUserRecord>;
  byPhone: Map<string, AuthoritativeGlossyUserRecord>;
  byName: Map<string, AuthoritativeGlossyUserRecord>;
}

export function buildAuthoritativeUserRoleIndex(
  users?: AuthoritativeGlossyUserRecord[]
): AuthoritativeUserRoleIndex | null {
  if (!Array.isArray(users) || users.length === 0) return null;
  const byId = new Map<string, AuthoritativeGlossyUserRecord>();
  const byEmail = new Map<string, AuthoritativeGlossyUserRecord>();
  const byUsername = new Map<string, AuthoritativeGlossyUserRecord>();
  const byPhone = new Map<string, AuthoritativeGlossyUserRecord>();
  const byName = new Map<string, AuthoritativeGlossyUserRecord>();

  for (const u of users) {
    if (!u || typeof u !== 'object') continue;
    for (const idCandidate of [u.id, u.user_id, u.staff_id]) {
      const cleanId = firstNonEmptyString(idCandidate).toLowerCase();
      if (cleanId) byId.set(cleanId, u);
    }
    const email = firstNonEmptyString(u.email).toLowerCase();
    if (email) byEmail.set(email, u);
    const username = firstNonEmptyString(u.username).toLowerCase();
    if (username) byUsername.set(username, u);
    const phoneKey = normalizePhoneLookupKey(u.phone);
    if (phoneKey) byPhone.set(phoneKey, u);
    const nameKey = firstNonEmptyString(u.full_name, u.name).toLowerCase();
    if (nameKey) byName.set(nameKey, u);
  }

  return { byId, byEmail, byUsername, byPhone, byName };
}

function findAuthoritativeUserMatch(
  record: Record<string, unknown>,
  index: AuthoritativeUserRoleIndex | null
): AuthoritativeGlossyUserRecord | null {
  if (!index) return null;

  const idCandidates = [
    record.user_id,
    record.userId,
    record.auth_user_id,
    record.authUserId,
    record.staff_id,
    record.staffId,
    record.id,
  ];
  for (const cand of idCandidates) {
    const key = firstNonEmptyString(cand).toLowerCase();
    if (key && index.byId.has(key)) return index.byId.get(key)!;
  }

  const email = firstNonEmptyString(record.email, record.user_email, record.userEmail).toLowerCase();
  if (email && index.byEmail.has(email)) return index.byEmail.get(email)!;

  const username = firstNonEmptyString(record.username, record.user_name, record.userName).toLowerCase();
  if (username && index.byUsername.has(username)) return index.byUsername.get(username)!;

  const phoneKey = normalizePhoneLookupKey(record.phone ?? record.mobile);
  if (phoneKey && index.byPhone.has(phoneKey)) return index.byPhone.get(phoneKey)!;

  const nameKey = firstNonEmptyString(
    record.name,
    record.fullName,
    record.full_name,
    record.displayName,
    combineNameParts(record.firstName ?? record.first_name, record.lastName ?? record.last_name)
  ).toLowerCase();
  if (nameKey && index.byName.has(nameKey)) return index.byName.get(nameKey)!;

  return null;
}

/**
 * Resolves authoritative `public.users.role` for a Glossy Looks staff record.
 * Priority:
 *  1. Direct match in authoritative `public.users` lookup index (if provided)
 *  2. Nested `users.role` / `user.role` from joined API payload
 *  3. Explicit user-role fields (`user_role`, `userRole`, `account_role`, `accountRole`, `auth_role`, `system_role`)
 *  4. `record.role` ONLY when it is a canonical `public.users.role` value (NOT a free-text `public.staff.role` job title)
 *
 * Explicitly ignores `staff_role`, `staffRole`, `jobTitle`, `job_title`, `designation`, and `specialty`.
 */
export function resolveAuthoritativeUserRole(
  record: Record<string, unknown>,
  userIndex: AuthoritativeUserRoleIndex | null = null
): {
  canonicalRole: CanonicalGlossyUserRole | null;
  displayRole: string | null;
  smavRole: 'ADMIN' | 'POS_BILLING';
  userIsActive: boolean | null;
} {
  const matchedUser = findAuthoritativeUserMatch(record, userIndex);
  const nestedUser = isPlainRecord(record.users)
    ? record.users
    : isPlainRecord(record.user)
      ? record.user
      : null;

  const userIsActive =
    matchedUser && typeof matchedUser.is_active === 'boolean'
      ? matchedUser.is_active
      : nestedUser && typeof nestedUser.is_active === 'boolean'
        ? nestedUser.is_active
        : null;

  const explicitUserRoleRaw = firstNonEmptyString(
    matchedUser?.role,
    nestedUser?.role,
    record.user_role,
    record.userRole,
    record.public_user_role,
    record.publicUserRole,
    record.account_role,
    record.accountRole,
    record.auth_role,
    record.authRole,
    record.system_role,
    record.systemRole
  );

  if (explicitUserRoleRaw) {
    const parsed = parseCanonicalGlossyUserRole(explicitUserRoleRaw);
    if (parsed && parsed !== 'SUPERADMIN') {
      const mapped = mapAuthoritativeGlossyRoleToSmav(parsed);
      return {
        canonicalRole: mapped.canonicalRole,
        displayRole: mapped.displayRole,
        smavRole: mapped.contractRole,
        userIsActive,
      };
    }
  }

  // Only inspect `record.role` if it is NOT flagged as a `public.staff` job title AND parses as a canonical `public.users.role`.
  const roleSource = firstNonEmptyString(record.role_source, record.roleSource).toLowerCase();
  if (roleSource !== 'staff' && roleSource !== 'job_title') {
    const fallbackCanonical = parseCanonicalGlossyUserRole(record.role);
    if (fallbackCanonical && fallbackCanonical !== 'SUPERADMIN') {
      const mapped = mapAuthoritativeGlossyRoleToSmav(fallbackCanonical);
      return {
        canonicalRole: mapped.canonicalRole,
        displayRole: mapped.displayRole,
        smavRole: mapped.contractRole,
        userIsActive,
      };
    }
  }

  return {
    canonicalRole: null,
    displayRole: null,
    smavRole: 'POS_BILLING',
    userIsActive,
  };
}

/**
 * Determines whether a staff record is eligible for *assignment to a salon
 * service*. This does not grant SMAV login or administrative access.
 *
 * A linked portal account remains authoritative: only a linked STYLIST can
 * be selected. An active staff profile with no canonical portal role can also
 * be selected when its operational designation is a salon service role. This
 * is needed for artists who do not require an individual portal login.
 */
export function normalizeSalonRole(
  record: Record<string, unknown>,
  userIndex: AuthoritativeUserRoleIndex | null = null
): {
  accepted: boolean;
  role: string;
  sourceRole?: CanonicalGlossyUserRole;
  smavRole: 'ADMIN' | 'POS_BILLING';
} {
  const resolved = resolveAuthoritativeUserRole(record, userIndex);
  // A linked user account is authoritative whenever it exists. Only a linked
  // STYLIST account is selectable; owners/managers/receptionists never become
  // service stylists merely because of a free-text staff designation.
  if (resolved.canonicalRole === 'STYLIST') {
    return {
      accepted: true,
      role: resolved.displayRole, // Always "Stylist"
      sourceRole: resolved.canonicalRole,
      smavRole: resolved.smavRole,
    };
  }

  // An explicit non-stylist portal role is never overridden by a staff job
  // title. This keeps reception, inventory and admin accounts out of POS
  // service assignment.
  if (resolved.canonicalRole) {
    return {
      accepted: false,
      role: resolved.displayRole || '',
      sourceRole: resolved.canonicalRole,
      smavRole: resolved.smavRole,
    };
  }

  // A salon service specialist does not need a portal-login user account just
  // to be assigned to a bill. The earlier implementation returned before this
  // block whenever canonicalRole was absent, making this intended fallback
  // unreachable and leaving valid artists out of the dropdown.
  const jobTitle = firstNonEmptyString(
    record.staff_role,
    record.staffRole,
    record.job_title,
    record.jobTitle,
    record.designation,
    record.specialty,
    record.role
  ).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const isNonServiceRole = /\b(owner|manager|admin|reception|cashier|billing|inventory|account|security)\b/.test(jobTitle);
  const isSalonServiceSpecialist = /\b(stylist|beautician|hairdresser|therapist|technician|esthetician|cosmetologist)\b/.test(jobTitle)
    || /\b(makeup|nail|hair|beauty|bridal|facial|spa)\b.*\b(artist|specialist|expert|professional)\b/.test(jobTitle);

  if (!isNonServiceRole && isSalonServiceSpecialist) {
    return {
      accepted: true,
      role: 'Stylist',
      sourceRole: 'STYLIST',
      smavRole: 'POS_BILLING',
    };
  }

  return {
    accepted: false,
    role: '',
    smavRole: resolved.smavRole,
  };
}

export function extractStaffCollection(payload: unknown): { ok: true; rows: unknown[]; users?: AuthoritativeGlossyUserRecord[] } | { ok: false } {
  if (Array.isArray(payload)) {
    return { ok: true, rows: payload };
  }
  if (!isPlainRecord(payload)) {
    return { ok: false };
  }

  const embeddedUsers = Array.isArray(payload.users)
    ? (payload.users as AuthoritativeGlossyUserRecord[])
    : isPlainRecord(payload.data) && Array.isArray(payload.data.users)
      ? (payload.data.users as AuthoritativeGlossyUserRecord[])
      : undefined;

  const directKeys = ['staff', 'stylists', 'employees', 'users', 'data'] as const;
  for (const key of directKeys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return { ok: true, rows: candidate, users: key === 'users' ? undefined : embeddedUsers };
    }
  }

  // Handle nested { data: { staff: [...] } } wrappers safely
  if (isPlainRecord(payload.data)) {
    for (const key of ['staff', 'stylists', 'employees', 'users'] as const) {
      const nested = payload.data[key];
      if (Array.isArray(nested)) {
        return { ok: true, rows: nested, users: key === 'users' ? undefined : embeddedUsers };
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

  if (Array.isArray(outlet.knownBranchIds)) {
    for (const branchId of outlet.knownBranchIds) {
      const clean = String(branchId || '').trim().toLowerCase();
      if (clean) tokens.add(clean);
    }
  }

  if (code === 'glossylooks' || id === 'outlet_glossy_gach') {
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
  const outletCandidates = [
    firstNonEmptyString(record.outletId, record.outlet_id),
    firstNonEmptyString(record.outletCode, record.outlet_code),
    firstNonEmptyString(record.centralOutletCode, record.central_outlet_code),
  ].filter(Boolean);
  const branchCandidate = firstNonEmptyString(record.branchId, record.branch_id);

  if (outletCandidates.length === 0 && !branchCandidate) {
    return { matched: true, outletId: outlet.id };
  }

  const expected = getExpectedOutletTokens(outlet);
  for (const candidate of [...outletCandidates, ...(branchCandidate ? [branchCandidate] : [])]) {
    if (expected.has(candidate.toLowerCase())) {
      return { matched: true, outletId: outlet.id || candidate };
    }
  }

  // If the upstream staff API is already scoped to this GlossyLooks outlet and returned
  // a branch_id without a conflicting outlet identifier, accept any dynamic branch ID for this outlet.
  if (outletCandidates.length === 0 && branchCandidate && isGlossyLooksOutlet(outlet)) {
    return { matched: true, outletId: outlet.id };
  }

  return { matched: false, outletId: '' };
}

export function normalizeUpstreamStaffPayload(
  payload: unknown,
  outlet: OutletMatchTarget,
  authoritativeUsers?: AuthoritativeGlossyUserRecord[]
): SalonStaffFetchResult {
  const extracted = extractStaffCollection(payload);
  if (!extracted.ok) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'STAFF_MAPPING_ERROR',
      message: 'Upstream Glossy Looks staff response could not be mapped to a staff list.',
    };
  }

  const mergedAuthUsers = [
    ...(Array.isArray(authoritativeUsers) ? authoritativeUsers : []),
    ...(Array.isArray(extracted.users) ? extracted.users : []),
  ];
  const userIndex = buildAuthoritativeUserRoleIndex(mergedAuthUsers);

  if (extracted.rows.length === 0) {
    return {
      success: true,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'NO_ACTIVE_STAFF',
      message: 'No active stylists returned for this outlet from the Glossy Looks staff API.',
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

    const resolvedAuth = resolveAuthoritativeUserRole(row, userIndex);
    if (resolvedAuth.userIsActive === false) continue;

    const roleCheck = normalizeSalonRole(row, userIndex);
    if (!roleCheck.accepted) continue;

    const outletMatch = matchStaffOutlet(row, outlet);
    if (!outletMatch.matched) continue;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    stylists.push({
      id,
      name,
      role: roleCheck.role,
      sourceRole: roleCheck.sourceRole,
      smavRole: roleCheck.smavRole,
      outletId: outletMatch.outletId,
      available: true,
    });
  }

  if (validIdentityCount === 0) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'STAFF_MAPPING_ERROR',
      message: 'Upstream Glossy Looks staff records could not be mapped (missing ID or name fields).',
    };
  }

  if (stylists.length === 0) {
    return {
      success: true,
      stylists: [],
      upstreamStatus: 200,
      diagnosticCode: 'NO_ACTIVE_STAFF',
      message: 'No active stylists returned for this outlet from the Glossy Looks staff API.',
    };
  }

  return {
    success: true,
    stylists,
    upstreamStatus: 200,
    diagnosticCode: 'OK',
    message: null,
  };
}

/**
 * Fetches authoritative `public.users` rows from Glossy Looks Supabase when configured.
 * Fails gracefully (returns empty list) if Glossy Looks Supabase service key is not present.
 */
export async function fetchGlossyLooksAuthoritativeUsers(options: {
  glossySupabaseUrl?: string;
  glossySupabaseServiceKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AuthoritativeGlossyUserRecord[]> {
  const url = (
    options.glossySupabaseUrl ||
    process.env.GLOSSYLOOKS_SUPABASE_URL ||
    ''
  ).trim().replace(/\/+$/, '');
  const key = (
    options.glossySupabaseServiceKey ||
    process.env.GLOSSYLOOKS_SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 4500;

  if (!url || !key) return [];

  try {
    const endpoint = `${url}/rest/v1/users?select=id,email,username,phone,full_name,name,role,is_active`;
    const res = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as AuthoritativeGlossyUserRecord[]) : [];
  } catch {
    return [];
  }
}

export async function fetchGlossyLooksStaff(
  options: FetchGlossyLooksStaffOptions
): Promise<SalonStaffFetchResult> {
  const {
    outlet,
    staffApiUrl = DEFAULT_GLOSSY_LOOKS_STAFF_URL,
    integrationKey = process.env.GLOSSYLOOKS_INTEGRATION_KEY?.trim() || '',
    timeoutMs = 8000,
    fetchImpl = fetch,
    authoritativeUsers,
    glossySupabaseUrl,
    glossySupabaseServiceKey,
  } = options;

  if (!isGlossyLooksOutlet(outlet)) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: null,
      diagnosticCode: 'STAFF_CONFIG_ERROR',
      message: `No upstream salon staff adapter is configured for outlet "${outlet.code || outlet.id}".`,
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
        message: 'Upstream salon staff API URL configuration is invalid (HTTPS required).',
      };
    }
  } catch {
    return {
      success: false,
      stylists: [],
      upstreamStatus: null,
      diagnosticCode: 'STAFF_CONFIG_ERROR',
      message: 'Upstream salon staff API URL is not configured.',
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (integrationKey) {
    headers['X-Integration-Key'] = integrationKey;
  }

  const authUsersPromise =
    authoritativeUsers && authoritativeUsers.length > 0
      ? Promise.resolve(authoritativeUsers)
      : fetchGlossyLooksAuthoritativeUsers({
          glossySupabaseUrl: glossySupabaseUrl || outlet.supabaseUrl,
          glossySupabaseServiceKey,
          timeoutMs: Math.min(timeoutMs, 4500),
          fetchImpl,
        });

  let response: Response;
  try {
    response = await fetchImpl(parsedUrl.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
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
        : 'Could not connect to the upstream Glossy Looks staff API.',
    };
  }

  if (response.status === 401 || response.status === 403) {
    if (!integrationKey) {
      return {
        success: false,
        stylists: [],
        upstreamStatus: response.status,
        diagnosticCode: 'STAFF_CONFIG_ERROR',
        message: `Glossy Looks integration key is missing or unauthorized (upstream HTTP ${response.status}). Configure GLOSSYLOOKS_INTEGRATION_KEY.`,
      };
    }
    return {
      success: false,
      stylists: [],
      upstreamStatus: response.status,
      diagnosticCode: 'STAFF_UPSTREAM_AUTH_ERROR',
      message: `Upstream Glossy Looks staff API rejected authorization (HTTP ${response.status}). Verify integration key permissions.`,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      stylists: [],
      upstreamStatus: response.status,
      diagnosticCode: 'STAFF_UPSTREAM_HTTP_ERROR',
      message: `Upstream Glossy Looks staff API failed with HTTP ${response.status}.`,
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
      message: `Upstream Glossy Looks staff API returned invalid JSON (HTTP ${response.status}).`,
    };
  }

  const resolvedAuthUsers = await authUsersPromise;
  return normalizeUpstreamStaffPayload(payload, outlet, resolvedAuthUsers);
}
