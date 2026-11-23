import crypto from 'crypto';
import zlib from 'zlib';
import type express from 'express';

export const SESSION_COOKIE_NAME = 'smav_web_session';
export const SEALED_TOKEN_PREFIX = 'smav_sess_v2.';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding session until explicit Sign Out
export const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
export const SUPABASE_REFRESH_LEEWAY_MS = 5 * 60 * 1000; // Refresh 5 min before JWT expiry

export type SessionErrorCode =
  | 'SESSION_MISSING'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'ACCOUNT_DISABLED'
  | 'SESSION_INVALIDATED';

export interface SealedOutletCompact {
  id: string;
  code: string;
  name: string;
  category: 'restaurant' | 'salon' | 'retail' | 'other';
  address?: string;
  phone?: string;
  gstin?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  providerType?: 'supabase_salon' | 'supabase_restaurant' | 'central_smav' | 'custom_outlet';
  isActive: boolean;
}

export interface SealedMembershipCompact {
  outletId: string;
  outletCode: string;
  outletName: string;
  outletCategory: 'restaurant' | 'salon' | 'retail' | 'other';
  role: 'superadmin' | 'admin' | 'staff';
  displayRole?: 'SUPERADMIN' | 'ADMIN' | 'POS_BILLING';
  specificTitle?: string;
  isPrimary?: boolean;
}

export interface SealedSessionPayload {
  v: 2;
  sid: string;
  userId: string;
  email: string;
  fullName: string;
  role: 'superadmin' | 'admin' | 'staff';
  displayRole?: 'SUPERADMIN' | 'ADMIN' | 'POS_BILLING';
  platformRole?: string;
  activeOutlet: SealedOutletCompact;
  assignedOutlets?: SealedMembershipCompact[];
  specificTitle: string;
  permissions: string[];
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  supabaseToken?: string;
  supabaseRefreshToken?: string;
  supabaseExpiresAt?: number;
}

export interface SessionValidationOutcome<TSession> {
  ok: boolean;
  session?: TSession;
  code?: SessionErrorCode;
  message?: string;
  tokenRotated?: boolean;
  supabaseRefreshed?: boolean;
}

export interface SupabaseRefreshResult {
  status: 'fresh' | 'refreshed' | 'invalid' | 'transient_error' | 'no_refresh_token';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  code?: SessionErrorCode;
  message?: string;
}

// Runtime random fallback if no environment secret is configured (never hardcoded).
const runtimeEphemeralSecret = crypto.randomBytes(32).toString('hex');

export function resolveSessionSecretMaterial(explicitSecret?: string): string {
  const candidates = [
    explicitSecret,
    process.env.SMAV_SESSION_SECRET,
    process.env.SMAV_GATEWAY_SECRET,
    process.env.SMAV_DISPATCH_SECRET,
    process.env.SMAV_SERVICE_ROLE_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    runtimeEphemeralSecret,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }
  return runtimeEphemeralSecret;
}

function deriveAesKey(secretOverride?: string): Buffer {
  const material = resolveSessionSecretMaterial(secretOverride);
  return crypto.createHash('sha256').update(`smav-session-seal-v2:${material}`).digest();
}

export function generateSessionId(): string {
  return `sid_${crypto.randomBytes(16).toString('hex')}`;
}

export function sealSessionPayload(payload: SealedSessionPayload, secretOverride?: string): string {
  const key = deriveAesKey(secretOverride);
  const iv = crypto.randomBytes(12);
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressed = zlib.deflateRawSync(jsonBuf);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const packed = Buffer.concat([iv, authTag, encrypted]).toString('base64url');
  return `${SEALED_TOKEN_PREFIX}${packed}`;
}

export function unsealSessionPayload(
  token: string,
  secretOverride?: string
): SealedSessionPayload | null {
  if (!token || typeof token !== 'string' || !token.startsWith(SEALED_TOKEN_PREFIX)) {
    return null;
  }
  try {
    const raw = Buffer.from(token.slice(SEALED_TOKEN_PREFIX.length), 'base64url');
    if (raw.length < 12 + 16 + 1) return null;

    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);

    const key = deriveAesKey(secretOverride);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const jsonText = zlib.inflateRawSync(compressed).toString('utf8');
    const parsed = JSON.parse(jsonText) as SealedSessionPayload;

    if (!parsed || parsed.v !== 2 || !parsed.sid || !parsed.userId || !parsed.activeOutlet?.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function extractJwtExpiryMs(jwt?: string | null): number | undefined {
  if (!jwt || typeof jwt !== 'string') return undefined;
  const parts = jwt.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadJson) as { exp?: number };
    if (typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) && parsed.exp > 0) {
      return parsed.exp * 1000;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export class SessionRevocationStore {
  private revokedSessionIds = new Map<string, number>();
  private revokedUsersBefore = new Map<string, number>();

  public revokeSessionId(sid: string, ttlMs = SESSION_TTL_MS): void {
    if (!sid) return;
    this.revokedSessionIds.set(sid, Date.now() + ttlMs);
    this.pruneExpired();
  }

  public revokeUserBefore(userId: string, cutoffMs = Date.now()): void {
    const uid = String(userId || '').trim();
    if (!uid) return;
    const prev = this.revokedUsersBefore.get(uid) || 0;
    this.revokedUsersBefore.set(uid, Math.max(prev, cutoffMs));
  }

  public isSessionRevoked(sid?: string, userId?: string, createdAtIso?: string): boolean {
    this.pruneExpired();
    if (sid && this.revokedSessionIds.has(sid)) {
      return true;
    }
    if (userId) {
      const cutoff = this.revokedUsersBefore.get(userId);
      if (cutoff && createdAtIso) {
        const createdMs = new Date(createdAtIso).getTime();
        if (Number.isFinite(createdMs) && createdMs <= cutoff) {
          return true;
        }
      }
    }
    return false;
  }

  public clearAll(): void {
    this.revokedSessionIds.clear();
    this.revokedUsersBefore.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    if (this.revokedSessionIds.size < 250) return;
    for (const [sid, exp] of this.revokedSessionIds.entries()) {
      if (exp < now) this.revokedSessionIds.delete(sid);
    }
  }
}

export function sanitizeSessionForClient<T extends Record<string, any>>(session: T): Omit<
  T,
  'supabaseToken' | 'supabaseRefreshToken'
> & {
  hasSupabaseRefreshSession: boolean;
} {
  const { supabaseToken: _st, supabaseRefreshToken: _srt, ...safe } = session;
  return {
    ...safe,
    hasSupabaseRefreshSession: Boolean(_srt || _st),
  };
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

export function isSecureRequest(req: Pick<express.Request, 'secure' | 'headers'>): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (forwardedProto.includes('https')) return true;
  if (req.secure) return true;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1')) {
    return true;
  }
  return false;
}

export function buildSessionCookieHeader(
  token: string,
  req: Pick<express.Request, 'secure' | 'headers'>,
  maxAgeSeconds = SESSION_TTL_SECONDS
): string {
  const encoded = encodeURIComponent(token);
  if (isSecureRequest(req)) {
    return `${SESSION_COOKIE_NAME}=${encoded}; Path=/; HttpOnly; Max-Age=${maxAgeSeconds}; SameSite=None; Secure; Partitioned`;
  }
  return `${SESSION_COOKIE_NAME}=${encoded}; Path=/; HttpOnly; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

export function buildClearSessionCookieHeader(
  req: Pick<express.Request, 'secure' | 'headers'>
): string {
  if (isSecureRequest(req)) {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=None; Secure; Partitioned`;
  }
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
}

export function setSessionCookie(res: express.Response, req: express.Request, token?: string): void {
  if (!token) return;
  res.append('Set-Cookie', buildSessionCookieHeader(token, req));
}

export function clearSessionCookie(res: express.Response, req: express.Request): void {
  res.append('Set-Cookie', buildClearSessionCookieHeader(req));
}

export function extractRequestSessionToken(
  req: Pick<express.Request, 'headers'>
): { token: string | null; source: 'bearer' | 'cookie' | null } {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) {
      return { token: bearer, source: 'bearer' };
    }
  }
  const cookies = parseCookies(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.trim()) {
    return { token: cookieToken.trim(), source: 'cookie' };
  }
  return { token: null, source: null };
}

export function verifyCookieMutationCsrf(
  req: Pick<express.Request, 'method' | 'headers'>
): boolean {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }
  const requestedWith = String(req.headers['x-requested-with'] || '').trim();
  if (requestedWith.length > 0) {
    return true;
  }
  const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (!expectedHost) return false;

  const origin = String(req.headers.origin || '').trim();
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      return originHost === expectedHost;
    } catch {
      return false;
    }
  }
  const referer = String(req.headers.referer || '').trim();
  if (referer) {
    try {
      const refererHost = new URL(referer).host.toLowerCase();
      return refererHost === expectedHost;
    } catch {
      return false;
    }
  }
  return false;
}

export function isConfirmedInvalidRefreshError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.error_description || '').toLowerCase();
  const code = String(err?.code || err?.error || '').toLowerCase();
  const status = Number(err?.status || 0);

  // Never classify network/timeout/5xx errors as confirmed invalidation
  if (status >= 500 || status === 0 && /fetch|network|timeout|econn|enotfound|etimedout|socket|abort/i.test(msg)) {
    return false;
  }

  return (
    code === 'refresh_token_not_found' ||
    code === 'invalid_grant' ||
    code === 'session_not_found' ||
    code === 'user_banned' ||
    code === 'user_not_found' ||
    /invalid refresh token|refresh token not found|already used|revoked|user is banned|session not found/i.test(msg)
  );
}

export async function refreshSupabaseSessionIfNeeded(params: {
  supabaseToken?: string;
  supabaseRefreshToken?: string;
  supabaseExpiresAt?: number;
  forceRefresh?: boolean;
  refreshFn: (refreshToken: string) => Promise<{
    data?: {
      session?: {
        access_token?: string;
        refresh_token?: string;
        expires_at?: number;
      } | null;
    } | null;
    error?: any;
  }>;
}): Promise<SupabaseRefreshResult> {
  const { supabaseToken, supabaseRefreshToken, supabaseExpiresAt, forceRefresh, refreshFn } = params;

  if (!supabaseRefreshToken) {
    return { status: 'no_refresh_token' };
  }

  const effectiveExpiryMs =
    typeof supabaseExpiresAt === 'number' && Number.isFinite(supabaseExpiresAt)
      ? supabaseExpiresAt
      : extractJwtExpiryMs(supabaseToken);

  const needsRefresh =
    Boolean(forceRefresh) ||
    !supabaseToken ||
    !effectiveExpiryMs ||
    effectiveExpiryMs - Date.now() <= SUPABASE_REFRESH_LEEWAY_MS;

  if (!needsRefresh) {
    return {
      status: 'fresh',
      accessToken: supabaseToken,
      refreshToken: supabaseRefreshToken,
      expiresAt: effectiveExpiryMs,
    };
  }

  try {
    const result = await refreshFn(supabaseRefreshToken);
    if (result?.error) {
      if (isConfirmedInvalidRefreshError(result.error)) {
        return {
          status: 'invalid',
          code: 'SESSION_EXPIRED',
          message: 'Your authentication session has expired or was revoked. Please sign in again.',
        };
      }
      return {
        status: 'transient_error',
        message: String(result.error?.message || 'Temporary authentication refresh failure'),
      };
    }

    const nextSession = result?.data?.session;
    if (!nextSession?.access_token) {
      return {
        status: 'transient_error',
        message: 'Supabase refresh did not return a replacement access token.',
      };
    }

    const nextExpMs =
      typeof nextSession.expires_at === 'number' && nextSession.expires_at > 0
        ? nextSession.expires_at * 1000
        : extractJwtExpiryMs(nextSession.access_token) || Date.now() + 55 * 60 * 1000;

    return {
      status: 'refreshed',
      accessToken: nextSession.access_token,
      refreshToken: nextSession.refresh_token || supabaseRefreshToken,
      expiresAt: nextExpMs,
    };
  } catch (err: any) {
    if (isConfirmedInvalidRefreshError(err)) {
      return {
        status: 'invalid',
        code: 'SESSION_EXPIRED',
        message: 'Your authentication session has expired or was revoked. Please sign in again.',
      };
    }
    return {
      status: 'transient_error',
      message: String(err?.message || 'Temporary network error while refreshing Supabase session'),
    };
  }
}
