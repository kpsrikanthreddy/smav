import { registerCatalogSource, resolveCatalogSource, glossyLooksSource } from './services/catalogSources';
import { previewCatalogImport, importMissingCatalogItems, type SourceCatalogItem } from './services/catalogImport';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import JSZip from 'jszip';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { OutletUserSyncCoordinator } from './syncCoordinator.ts';
import type { OutletTargetDescriptor } from './syncCoordinator.ts';
import { loadOutletRuntimeConfig, listPosTemplates } from './services/outletRegistry.ts';
import { loadCentralOutletCatalog, loadCentralCatalogChanges } from './services/outletAdapters.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const HOST = '0.0.0.0';
const isCompiledBundle = __filename.endsWith('.js') || __filename.endsWith('.mjs');
const isProductionMode = process.env.NODE_ENV === 'production' || isCompiledBundle;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// -------------------------------------------------------------------------------------------------
// Interfaces & Core Types for Database Independence (Item 8)
// -------------------------------------------------------------------------------------------------
export type UserRole = 'superadmin' | 'admin' | 'staff';
export type VisibleRole = 'SUPERADMIN' | 'ADMIN' | 'POS_BILLING';
export type BusinessCategory = 'restaurant' | 'salon' | 'retail' | 'other';

export function displayRoleFor(role: UserRole): VisibleRole {
  if (role === 'superadmin') return 'SUPERADMIN';
  if (role === 'admin') return 'ADMIN';
  return 'POS_BILLING';
}

export function permissionsForRole(role: UserRole): string[] {
  if (role === 'superadmin') return ['*'];
  if (role === 'admin') {
    return ['outlet:view_assigned', 'pos:manage_staff', 'catalog:manage', 'reports:view', 'pos:create_bill', 'pos:print_receipt'];
  }
  return ['outlet:view_assigned', 'pos:create_bill', 'pos:print_receipt'];
}

export interface Outlet {
  id: string;
  code: string;
  name: string;
  category: BusinessCategory;
  address: string;
  phone: string;
  gstin: string;
  receiptHeader: string;
  receiptFooter: string;
  providerType: 'supabase_salon' | 'supabase_restaurant' | 'central_smav' | 'custom_outlet';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  syncWebhookUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserOutletMembership {
  outletId: string;
  outletCode: string;
  outletName: string;
  outletCategory: BusinessCategory;
  role: UserRole;
  displayRole?: VisibleRole;
  specificTitle?: string;
  permissions: string[];
  isPrimary: boolean;
}

export interface UserAccount {
  id: string;
  email: string;
  username?: string;
  fullName: string;
  phone?: string;
  passwordHash: string;
  salt: string;
  role: UserRole;
  isActive: boolean;
  isLegacyMigrationRequired?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  memberships: UserOutletMembership[];
}

export interface UserSession {
  token: string;
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  displayRole?: VisibleRole;
  activeOutlet: Outlet;
  assignedOutlets?: UserOutletMembership[];
  specificTitle: string;
  permissions: string[];
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  supabaseToken?: string;
  platformRole?: string;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  multiBusiness?: boolean;
  tempToken?: string;
  availableOutlets?: UserOutletMembership[];
  session?: UserSession;
  redirectTo?: string;
  requiresPasswordReset?: boolean;
  requiresPasswordChange?: boolean;
  passwordChangeToken?: string;
  email?: string;
}

export interface AuditLogEntry {
  id: string;
  eventType: string;
  actorId?: string;
  actorEmail?: string;
  outletId?: string;
  ipAddress?: string;
  details: Record<string, any>;
  timestamp: string;
}

export interface IAuthProvider {
  readonly providerId: string;
  authenticate(credentials: {
    emailOrId: string;
    password: string;
    outletCode?: string;
    deviceId?: string;
    ipAddress?: string;
  }): Promise<AuthResult>;
  validateSession(token: string): Promise<UserSession | null>;
  requestPasswordReset(email: string, outletCode?: string): Promise<{ success: boolean; resetToken?: string; message: string }>;
  confirmPasswordReset(resetToken: string, newPassword: string): Promise<{ success: boolean; message: string }>;
  revokeSession(token: string): Promise<boolean>;
}

export interface IUserRepository {
  getUserById(id: string): Promise<UserAccount | null>;
  getUserByEmail(email: string): Promise<UserAccount | null>;
  listUsersByOutlet(outletId: string): Promise<UserAccount[]>;
  createUser(userData: Partial<UserAccount>): Promise<UserAccount>;
  updateUser(id: string, updates: Partial<UserAccount>): Promise<UserAccount | null>;
  setUserActive(id: string, isActive: boolean): Promise<boolean>;
  resetUserPassword(id: string, newPasswordHash: string, salt: string): Promise<boolean>;
}

export interface IOutletRepository {
  getOutletById(id: string): Promise<Outlet | null>;
  getOutletByCode(code: string): Promise<Outlet | null>;
  listAllOutlets(): Promise<Outlet[]>;
  createOutlet(outletData: Partial<Outlet>): Promise<Outlet>;
  updateOutlet(id: string, updates: Partial<Outlet>): Promise<Outlet | null>;
  setOutletActive(id: string, isActive: boolean): Promise<boolean>;
}

export interface ICatalogRepository {
  getCatalog(outletId: string, sinceRevision?: number): Promise<{
    currentRevision: number;
    items: any[];
    isDelta: boolean;
    upToDate: boolean;
  }>;
  saveItem(outletId: string, itemData: any): Promise<any>;
  deleteItem(outletId: string, itemId: string): Promise<boolean>;
  getRevision(outletId: string): Promise<number>;
}

// -------------------------------------------------------------------------------------------------
// Cryptographic Password Hashing & Security Utilities
// -------------------------------------------------------------------------------------------------
export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const generatedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, generatedSalt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt: generatedSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computed = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

export function generateSecureToken(prefix = 'smav_jwt'): string {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}_${Date.now()}`;
}

// -------------------------------------------------------------------------------------------------
// Rate Limiter Implementation (Item 9)
// -------------------------------------------------------------------------------------------------
interface RateLimitRecord {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

export class SecurityRateLimiter {
  private attemptsMap = new Map<string, RateLimitRecord>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(maxAttempts = 5, windowMs = 5 * 60 * 1000, blockDurationMs = 10 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.blockDurationMs = blockDurationMs;
  }

  public checkRateLimit(key: string): { allowed: boolean; waitSeconds?: number } {
    const now = Date.now();
    const record = this.attemptsMap.get(key);

    if (!record) return { allowed: true };

    if (record.blockedUntil && record.blockedUntil > now) {
      const waitSeconds = Math.ceil((record.blockedUntil - now) / 1000);
      return { allowed: false, waitSeconds };
    }

    if (now - record.firstAttemptAt > this.windowMs) {
      this.attemptsMap.delete(key);
      return { allowed: true };
    }

    if (record.attempts >= this.maxAttempts) {
      record.blockedUntil = now + this.blockDurationMs;
      return { allowed: false, waitSeconds: Math.ceil(this.blockDurationMs / 1000) };
    }

    return { allowed: true };
  }

  public recordAttempt(key: string, success: boolean) {
    if (success) {
      this.attemptsMap.delete(key);
      return;
    }

    const now = Date.now();
    const record = this.attemptsMap.get(key);
    if (!record) {
      this.attemptsMap.set(key, { attempts: 1, firstAttemptAt: now });
    } else {
      record.attempts += 1;
      if (record.attempts >= this.maxAttempts) {
        record.blockedUntil = now + this.blockDurationMs;
      }
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Security Audit Logger (Item 9)
// -------------------------------------------------------------------------------------------------
export class AuditLogger {
  private logs: AuditLogEntry[] = [];

  public log(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: 'audit_' + crypto.randomBytes(8).toString('hex'),
      timestamp: new Date().toISOString(),
      ...entry
    };
    this.logs.unshift(fullEntry);
    if (this.logs.length > 500) {
      this.logs.pop();
    }
    return fullEntry;
  }

  public getRecentLogs(limit = 100, outletId?: string): AuditLogEntry[] {
    if (outletId) {
      return this.logs.filter(l => l.outletId === outletId || !l.outletId).slice(0, limit);
    }
    return this.logs.slice(0, limit);
  }
}

export const auditLogger = new AuditLogger();
export const loginRateLimiter = new SecurityRateLimiter(5, 5 * 60 * 1000, 10 * 60 * 1000);
export const passwordResetRateLimiter = new SecurityRateLimiter(3, 10 * 60 * 1000, 15 * 60 * 1000);

// -------------------------------------------------------------------------------------------------
// Central SMAV Outlets Repository (Item 4 & 7)
// -------------------------------------------------------------------------------------------------
export class CentralOutletRepository implements IOutletRepository {
  // Never seed the production outlet registry with fabricated business details.
  private outlets: Outlet[] = [];

  public async getOutletById(id: string): Promise<Outlet | null> {
    return this.outlets.find(o => o.id === id) || null;
  }

  public async getOutletByCode(code: string): Promise<Outlet | null> {
    const cleanCode = code.trim().toLowerCase();
    return this.outlets.find(o => o.code.toLowerCase() === cleanCode) || null;
  }

  public async listAllOutlets(): Promise<Outlet[]> {
    return [...this.outlets];
  }

  public async createOutlet(outletData: Partial<Outlet>): Promise<Outlet> {
    const id = outletData.id || `outlet_${Math.random().toString(36).substring(2, 9)}`;
    const newOutlet: Outlet = {
      id,
      code: (outletData.code || outletData.name?.toLowerCase().replace(/\s+/g, '_') || id).toLowerCase(),
      name: outletData.name || 'New Registered Outlet',
      category: outletData.category || 'other',
      address: outletData.address || '',
      phone: outletData.phone || '',
      gstin: outletData.gstin || '',
      receiptHeader: outletData.receiptHeader || outletData.name || '',
      receiptFooter: outletData.receiptFooter || 'Thank you for your visit!',
      providerType: outletData.providerType || 'custom_outlet',
      supabaseUrl: outletData.supabaseUrl,
      supabaseAnonKey: outletData.supabaseAnonKey,
      isActive: outletData.isActive !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.outlets.push(newOutlet);
    return newOutlet;
  }

  public async updateOutlet(id: string, updates: Partial<Outlet>): Promise<Outlet | null> {
    const outlet = this.outlets.find(o => o.id === id);
    if (!outlet) return null;
    Object.assign(outlet, updates, { updatedAt: new Date().toISOString() });
    return outlet;
  }

  public async setOutletActive(id: string, isActive: boolean): Promise<boolean> {
    const outlet = this.outlets.find(o => o.id === id);
    if (!outlet) return false;
    outlet.isActive = isActive;
    outlet.updatedAt = new Date().toISOString();
    return true;
  }

  public async upsertRemoteOutlet(outletData: any): Promise<Outlet> {
    const id = outletData.id || `outlet_${Math.random().toString(36).substring(2, 9)}`;
    const code = (outletData.code || outletData.branch_code || outletData.name?.toLowerCase().replace(/\s+/g, '_') || id).toLowerCase();
    const existing = this.outlets.find(o => o.id === id || o.code.toLowerCase() === code);
    if (existing) {
      existing.name = outletData.name || outletData.outlet_name || existing.name;
      existing.category = (outletData.category || outletData.business_type || existing.category).toLowerCase() as any;
      existing.address = outletData.address || existing.address;
      existing.phone = outletData.phone || existing.phone;
      existing.gstin = outletData.gstin || existing.gstin;
      existing.isActive = outletData.is_active !== undefined ? Boolean(outletData.is_active) : existing.isActive;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    const newOutlet: Outlet = {
      id,
      code,
      name: outletData.name || outletData.outlet_name || 'Registered Outlet',
      category: (outletData.category || outletData.business_type || 'other').toLowerCase() as any,
      address: outletData.address || '',
      phone: outletData.phone || '',
      gstin: outletData.gstin || '',
      receiptHeader: outletData.receipt_header || outletData.name || '',
      receiptFooter: outletData.receipt_footer || 'Thank you for your visit!',
      providerType: 'central_smav',
      isActive: outletData.is_active !== false,
      createdAt: outletData.created_at || new Date().toISOString(),
      updatedAt: outletData.updated_at || new Date().toISOString()
    };
    this.outlets.push(newOutlet);
    return newOutlet;
  }
}

// -------------------------------------------------------------------------------------------------
// Central SMAV User Accounts & Identity Directory (Item 2 & 9)
// -------------------------------------------------------------------------------------------------
export class CentralUserRepository implements IUserRepository {
  private users: UserAccount[] = [];

  public async getUserById(id: string): Promise<UserAccount | null> {
    return this.users.find(u => u.id === id) || null;
  }

  public async getUserByEmail(email: string): Promise<UserAccount | null> {
    const clean = email.trim().toLowerCase();
    return this.users.find(u => u.email.toLowerCase() === clean || (u.username && u.username.toLowerCase() === clean)) || null;
  }

  public async listUsersByOutlet(outletId: string): Promise<UserAccount[]> {
    if (outletId === 'all') return [...this.users];
    return this.users.filter(u => u.memberships.some(m => m.outletId === outletId));
  }

  public async createUser(userData: Partial<UserAccount>): Promise<UserAccount> {
    const id = userData.id || `usr_${crypto.randomUUID()}`;
    const newUser: UserAccount = {
      id,
      email: userData.email || '',
      username: userData.username,
      fullName: userData.fullName || 'Staff Member',
      phone: userData.phone,
      passwordHash: userData.passwordHash || '',
      salt: userData.salt || '',
      role: userData.role || 'staff',
      isActive: userData.isActive !== false,
      createdAt: new Date().toISOString(),
      memberships: userData.memberships || []
    };
    this.users.push(newUser);
    return newUser;
  }

  public async updateUser(id: string, updates: Partial<UserAccount>): Promise<UserAccount | null> {
    const user = this.users.find(u => u.id === id);
    if (!user) return null;
    Object.assign(user, updates);
    return user;
  }

  public async setUserActive(id: string, isActive: boolean): Promise<boolean> {
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    user.isActive = isActive;
    return true;
  }

  public async resetUserPassword(id: string, newPasswordHash: string, salt: string): Promise<boolean> {
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    user.passwordHash = newPasswordHash;
    user.salt = salt;
    user.isLegacyMigrationRequired = false;
    return true;
  }

  public async removeOutletMembership(userId: string, outletId: string): Promise<boolean> {
    const user = this.users.find(u => u.id === userId);
    if (!user) return false;
    const beforeLen = user.memberships.length;
    user.memberships = user.memberships.filter(m => m.outletId !== outletId);
    if (user.memberships.length === beforeLen) return false;
    if (user.memberships.length === 0) {
      user.isActive = false;
    }
    return true;
  }
}

// -------------------------------------------------------------------------------------------------
// Retail Catalog Repository (for Retail Outlets)
// -------------------------------------------------------------------------------------------------
export interface RetailProduct {
  id: string;
  name: string;
  category: string;
  sku: string;
  price: number;
  gstPercent: number;
  stockQty: number;
  barcode: string;
  isActive: boolean;
  isDeleted: boolean;
  revision: number;
}

export class RetailCatalogRepository implements ICatalogRepository {
  private products: RetailProduct[] = [
    { id: 'ret_001', name: 'Cotton Linen Casual Shirt (Navy Blue)', category: 'Men Apparel', sku: 'MSH-LN-01', price: 1499, gstPercent: 12, stockQty: 42, barcode: '890123456701', isActive: true, isDeleted: false, revision: 10 },
    { id: 'ret_002', name: 'Slim Fit Denim Jeans (Raw Indigo)', category: 'Men Apparel', sku: 'MDN-SF-02', price: 2199, gstPercent: 12, stockQty: 28, barcode: '890123456702', isActive: true, isDeleted: false, revision: 10 },
    { id: 'ret_003', name: 'Embroidered Silk Anarkali Kurta Set', category: 'Women Ethnic', sku: 'WE-AK-03', price: 3499, gstPercent: 12, stockQty: 15, barcode: '890123456703', isActive: true, isDeleted: false, revision: 10 },
    { id: 'ret_004', name: 'Handcrafted Leather Crossbody Bag', category: 'Accessories', sku: 'ACC-LB-04', price: 1899, gstPercent: 18, stockQty: 19, barcode: '890123456704', isActive: true, isDeleted: false, revision: 10 },
    { id: 'ret_005', name: 'Sterling Silver Minimalist Cuff Bracelet', category: 'Jewelry', sku: 'JWL-SL-05', price: 1299, gstPercent: 3, stockQty: 30, barcode: '890123456705', isActive: true, isDeleted: false, revision: 10 }
  ];
  private revision = 10;

  public async getCatalog(outletId: string, sinceRevision = 0) {
    const isDelta = sinceRevision > 0;
    const items = isDelta ? this.products.filter(p => p.revision > sinceRevision) : this.products.filter(p => !p.isDeleted && p.isActive);
    return {
      currentRevision: this.revision,
      items,
      isDelta,
      upToDate: sinceRevision === this.revision
    };
  }

  public async saveItem(outletId: string, itemData: any) {
    this.revision += 1;
    let existing = this.products.find(p => p.id === itemData.id);
    if (existing) {
      Object.assign(existing, itemData, { revision: this.revision });
      return existing;
    } else {
      const newItem: RetailProduct = {
        id: itemData.id || `ret_${Math.random().toString(36).substring(2, 7)}`,
        name: itemData.name,
        category: itemData.category || 'General',
        sku: itemData.sku || `SKU-${Date.now().toString().slice(-4)}`,
        price: Number(itemData.price) || 0,
        gstPercent: Number(itemData.gstPercent) || 12,
        stockQty: Number(itemData.stockQty) || 10,
        barcode: itemData.barcode || `890${Date.now().toString().slice(-9)}`,
        isActive: itemData.isActive !== false,
        isDeleted: false,
        revision: this.revision
      };
      this.products.push(newItem);
      return newItem;
    }
  }

  public async deleteItem(outletId: string, itemId: string) {
    const item = this.products.find(p => p.id === itemId);
    if (!item) return false;
    this.revision += 1;
    item.isDeleted = true;
    item.isActive = false;
    item.revision = this.revision;
    return true;
  }

  public async getRevision(outletId: string) {
    return this.revision;
  }
}

// -------------------------------------------------------------------------------------------------
// Central SMAV Supabase Project Configuration & Provider (Requirement 1, 2, 3, 4, 9)
// -------------------------------------------------------------------------------------------------
export interface CentralSupabaseConfig {
  projectUrl: string;
  publishableKey: string;
  isConfigured: boolean;
}

export let centralSupabaseConfig: CentralSupabaseConfig = {
  projectUrl: process.env.SMAV_SUPABASE_URL || process.env.VITE_SMAV_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  publishableKey: process.env.SMAV_SUPABASE_ANON_KEY || process.env.SMAV_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SMAV_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  isConfigured: false
};

export function updateCentralSupabaseConfig(url: string, key: string) {
  centralSupabaseConfig.projectUrl = (url || '').trim();
  centralSupabaseConfig.publishableKey = (key || '').trim();
  centralSupabaseConfig.isConfigured = Boolean(
    centralSupabaseConfig.projectUrl &&
    centralSupabaseConfig.publishableKey &&
    !centralSupabaseConfig.projectUrl.includes('your-central-smav-project') &&
    centralSupabaseConfig.projectUrl.startsWith('http')
  );
}

// Evaluate configuration from environment variables on startup
updateCentralSupabaseConfig(centralSupabaseConfig.projectUrl, centralSupabaseConfig.publishableKey);

/**
 * Returns a Supabase client configured with the publishable/anon key.
 * If accessToken is supplied, sets Authorization: Bearer <accessToken> so RLS is evaluated as auth.uid().
 * NEVER exposes or uses service_role key.
 */
export function getCentralSupabaseClient(accessToken?: string) {
  if (!centralSupabaseConfig.isConfigured) return null;
  return createClient(centralSupabaseConfig.projectUrl, centralSupabaseConfig.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: accessToken ? {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    } : undefined
  });
}

/**
 * Server-only privileged client for trusted backend audit writes.
 * Never exposed to browsers or passed to untrusted callers.
 */
export function getCentralSupabaseServiceClient() {
  const serviceKey = (process.env.SMAV_SERVICE_ROLE_KEY || '').trim();
  if (!centralSupabaseConfig.isConfigured || !serviceKey) return null;
  return createClient(centralSupabaseConfig.projectUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export async function writeTrustedServerAuditLog(params: {
  userId?: string;
  userEmail?: string;
  outletId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, any>;
}) {
  try {
    const serviceDb = getCentralSupabaseServiceClient();
    if (!serviceDb) return;
    await serviceDb.from('smav_audit_logs').insert({
      user_id: params.userId || 'system',
      user_email: params.userEmail || 'system@smav.local',
      outlet_id: params.outletId ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      details: params.details || {},
      timestamp: new Date().toISOString()
    });
  } catch (_e) {}
}

// -------------------------------------------------------------------------------------------------
// Central SMAV Authentication Gateway (Item 2)
// -------------------------------------------------------------------------------------------------
export interface PasswordResetTokenRecord {
  token: string;
  userId: string;
  email: string;
  outletId?: string;
  expiresAt: number;
}

export class SmavAuthGateway implements IAuthProvider {
  public readonly providerId = 'smav_central_gateway';

  private outletRepo: CentralOutletRepository;
  private userRepo: CentralUserRepository;
  private activeSessions = new Map<string, UserSession>();
  private resetTokens = new Map<string, PasswordResetTokenRecord>();
  private pendingAuthSelections = new Map<string, {
    userId: string;
    email: string;
    fullName: string;
    platformRole: string;
    supabaseToken: string;
    memberships: UserOutletMembership[];
    outlets: Outlet[];
    expiresAt: number;
  }>();
  private pendingPasswordChanges = new Map<string, {
    userId: string;
    email: string;
    supabaseAccessToken: string;
    outletCode?: string;
    expiresAt: number;
  }>();

  constructor(outletRepo: CentralOutletRepository, userRepo: CentralUserRepository) {
    this.outletRepo = outletRepo;
    this.userRepo = userRepo;
  }

  public async authenticate(credentials: {
    emailOrId: string;
    password: string;
    outletCode?: string;
    deviceId?: string;
    ipAddress?: string;
  }): Promise<AuthResult> {
    const { emailOrId, password, outletCode, deviceId, ipAddress } = credentials;
    const clientIp = ipAddress || '127.0.0.1';
    const rateLimitKey = `login_${emailOrId.trim().toLowerCase()}_${clientIp}`;

    const rateCheck = loginRateLimiter.checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      auditLogger.log({
        eventType: 'LOGIN_RATE_LIMITED',
        actorEmail: emailOrId,
        ipAddress: clientIp,
        details: { waitSeconds: rateCheck.waitSeconds }
      });
      return {
        success: false,
        message: `Too many login attempts. For security, please wait ${rateCheck.waitSeconds} seconds before trying again.`
      };
    }

    let targetOutlet: Outlet | null = null;
    let resolvedProvider = 'central_smav';

    if (!centralSupabaseConfig.isConfigured) {
      return {
        success: false,
        message: 'Central SMAV Supabase Auth is not configured. Sign-in requires an active Central Supabase connection.'
      };
    }

    // Central Auth only: resolve either verified email OR unambiguous username safely
    let centralLoginEmail = emailOrId.trim();
    if (!centralLoginEmail.includes('@')) {
      const cleanUsername = centralLoginEmail.toLowerCase();
      if (!process.env.SMAV_SERVICE_ROLE_KEY || !centralSupabaseConfig.projectUrl) {
        return {
          success: false,
          message: 'Please sign in using your verified email address. Username lookup requires server-side identity lookup configuration.'
        };
      }

      try {
        const lookupUrl = `${centralSupabaseConfig.projectUrl}/rest/v1/smav_external_identities?username=ilike.${encodeURIComponent(cleanUsername)}&select=auth_user_id,email,source,username`;
        const lookup = await fetch(lookupUrl, {
          headers: {
            apikey: process.env.SMAV_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SMAV_SERVICE_ROLE_KEY}`
          },
          signal: AbortSignal.timeout(3500)
        });

        if (!lookup.ok) {
          loginRateLimiter.recordAttempt(rateLimitKey, false);
          return {
            success: false,
            message: 'Unable to verify username right now. Please sign in with your verified email address.'
          };
        }

        const rawIdentities: any[] = await lookup.json();
        const exactMatches = (rawIdentities || []).filter(
          (i: any) => String(i.username || '').trim().toLowerCase() === cleanUsername
        );
        const scopedMatches = outletCode?.trim()
          ? exactMatches.filter((i: any) => String(i.source || '').trim().toLowerCase() === outletCode.trim().toLowerCase())
          : exactMatches;

        const distinctUserIds = new Set(scopedMatches.map((i: any) => String(i.auth_user_id || '')).filter(Boolean));
        const distinctEmails = new Set(scopedMatches.map((i: any) => String(i.email || '').trim().toLowerCase()).filter(Boolean));

        if (distinctUserIds.size === 0 && distinctEmails.size === 0) {
          loginRateLimiter.recordAttempt(rateLimitKey, false);
          return {
            success: false,
            message: `Username "${centralLoginEmail}" was not found. Please sign in with your verified email address.`
          };
        }

        if (distinctUserIds.size > 1 || distinctEmails.size > 1) {
          loginRateLimiter.recordAttempt(rateLimitKey, false);
          auditLogger.log({
            eventType: 'LOGIN_REJECTED_AMBIGUOUS_USERNAME',
            actorEmail: centralLoginEmail,
            ipAddress: clientIp,
            details: { outletCode: outletCode || null, matchCount: scopedMatches.length }
          });
          return {
            success: false,
            message: `Ambiguous username "${centralLoginEmail}" matches multiple accounts. Please sign in with your verified email address.`
          };
        }

        const resolvedUserId = [...distinctUserIds][0];
        let resolvedAuthEmail = [...distinctEmails][0] || '';

        if (resolvedUserId) {
          const authUserRes = await fetch(`${centralSupabaseConfig.projectUrl}/auth/v1/admin/users/${encodeURIComponent(resolvedUserId)}`, {
            headers: {
              apikey: process.env.SMAV_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${process.env.SMAV_SERVICE_ROLE_KEY}`
            },
            signal: AbortSignal.timeout(3500)
          });
          if (authUserRes.ok) {
            const authUser = await authUserRes.json();
            if (authUser?.email) {
              resolvedAuthEmail = String(authUser.email).trim().toLowerCase();
            }
          }
        }

        if (!resolvedAuthEmail || !resolvedAuthEmail.includes('@')) {
          loginRateLimiter.recordAttempt(rateLimitKey, false);
          return {
            success: false,
            message: `Username "${centralLoginEmail}" has no verified login email. Contact your administrator or sign in with your email.`
          };
        }

        centralLoginEmail = resolvedAuthEmail;
      } catch (_lookupErr) {
        loginRateLimiter.recordAttempt(rateLimitKey, false);
        return {
          success: false,
          message: 'Username lookup failed safely. Please sign in with your verified email address.'
        };
      }
    }

    // ---------------------------------------------------------------------------------------------
    // Requirement 1 & 2: Central Supabase Auth signInWithPassword (Authoritative & Exclusive)
    // ---------------------------------------------------------------------------------------------
    if (centralSupabaseConfig.isConfigured) {
      const publicSupabase = getCentralSupabaseClient();
      if (publicSupabase) {
        try {
          const { data: authData, error: authError } = await publicSupabase.auth.signInWithPassword({
            email: centralLoginEmail,
            password
          });

          if (!authError && authData?.user && authData?.session) {
            // Requirement 3 & 6: Retrieve authenticated user's profile securely using their access token
            // This queries public.smav_profiles with auth.uid() matching the user, strictly respecting RLS
            const authedSupabase = getCentralSupabaseClient(authData.session.access_token);
            const { data: profile, error: profileErr } = await authedSupabase!
              .from('smav_profiles')
              .select('*')
              .eq('id', authData.user.id)
              .single();

            if (profileErr || !profile) {
              loginRateLimiter.recordAttempt(rateLimitKey, false);
              auditLogger.log({
                eventType: 'LOGIN_FAILED_PROFILE_NOT_FOUND',
                actorEmail: authData.user.email,
                ipAddress: clientIp,
                details: { error: profileErr?.message || 'Profile record missing in public.smav_profiles' }
              });
              return {
                success: false,
                message: `Authentication succeeded in Supabase Auth, but no linked profile was found in public.smav_profiles for user "${authData.user.email}". Error: ${profileErr?.message || 'Record not found'}.`
              };
            }

            const userEmail = authData.user.email || centralLoginEmail;
            const userPhone = (authData.user.user_metadata?.phone as string) || '';

            // Verify is_active = true
            const isActive = profile.is_active === true;
            if (!isActive) {
              loginRateLimiter.recordAttempt(rateLimitKey, false);
              auditLogger.log({
                eventType: 'LOGIN_DENIED_INACTIVE_PROFILE',
                actorId: profile.id,
                actorEmail: userEmail,
                ipAddress: clientIp,
                details: { reason: 'is_active is false in smav_profiles' }
              });
              return {
                success: false,
                message: 'Your SMAV account is currently deactivated (is_active = false). Please contact your administrator.'
              };
            }

            // Enforce personal password change when an admin provisioned or reset a temporary password
            if (authData.user.user_metadata?.must_change_password === true) {
              const passwordChangeToken = generateSecureToken('smav_pwdchg');
              this.pendingPasswordChanges.set(passwordChangeToken, {
                userId: profile.id,
                email: userEmail,
                supabaseAccessToken: authData.session.access_token,
                outletCode,
                expiresAt: Date.now() + 10 * 60 * 1000
              });

              auditLogger.log({
                eventType: 'FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED',
                actorId: profile.id,
                actorEmail: userEmail,
                ipAddress: clientIp,
                details: { outletCode: outletCode || null }
              });

              return {
                success: false,
                requiresPasswordChange: true,
                passwordChangeToken,
                email: userEmail,
                message: 'Temporary password verified. Set a new personal password (min. 8 characters) to complete sign-in.'
              };
            }

            const platformRole = String(profile.platform_role || 'USER').toUpperCase();
            if (platformRole === 'SUPERADMIN') {
              loginRateLimiter.recordAttempt(rateLimitKey, true);

              // Pull all active outlets from central smav_outlets table (Superadmin sees all)
              let allActiveMemberships: UserOutletMembership[] = [];
              try {
                const { data: remoteOutlets } = await authedSupabase!
                  .from('smav_outlets')
                  .select('*')
                  .eq('is_active', true)
                  .order('created_at');
                if (remoteOutlets && Array.isArray(remoteOutlets)) {
                  for (const ro of remoteOutlets) {
                    const mappedOutlet = await this.outletRepo.upsertRemoteOutlet(ro);
                    allActiveMemberships.push({
                      outletId: mappedOutlet.id,
                      outletCode: mappedOutlet.code,
                      outletName: mappedOutlet.name,
                      outletCategory: mappedOutlet.category,
                      role: 'superadmin',
                      displayRole: 'SUPERADMIN',
                      specificTitle: 'Superadministrator',
                      permissions: ['*'],
                      isPrimary: false
                    });
                  }
                }
              } catch (_e) {}

              const centralMembership: UserOutletMembership = {
                outletId: 'all',
                outletCode: 'smav_central',
                outletName: 'Central SMAV Enterprise Network',
                outletCategory: 'other',
                role: 'superadmin',
                displayRole: 'SUPERADMIN',
                specificTitle: 'Superadministrator',
                permissions: ['*'],
                isPrimary: true
              };

              const superadminUser: UserAccount = {
                id: profile.id,
                email: userEmail,
                username: (authData.user.user_metadata?.username as string) || userEmail.split('@')[0] || 'superadmin',
                fullName: profile.full_name || 'SMAV Central Superadmin',
                phone: userPhone,
                passwordHash: '',
                salt: '',
                role: 'superadmin',
                isActive: true,
                createdAt: profile.created_at || new Date().toISOString(),
                memberships: [centralMembership, ...allActiveMemberships]
              };

              const superadminOutlet: Outlet = {
                id: 'central_smav',
                code: 'smav',
                name: 'SMAV Enterprise Central Headquarters',
                category: 'other',
                address: 'Enterprise Cloud Gateway',
                phone: '+91 90000 00001',
                gstin: '36AABCU0000Z1Z0',
                receiptHeader: 'SMAV Central Enterprise Control',
                receiptFooter: 'Confidential Superadmin Console',
                providerType: 'central_smav',
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };

              const session = this.createSession(
                superadminUser,
                superadminOutlet,
                'Superadministrator',
                ['*'],
                deviceId,
                authData.session.access_token,
                'SUPERADMIN'
              );

              await writeTrustedServerAuditLog({
                userId: authData.user.id,
                userEmail,
                action: 'LOGIN_SUCCESS',
                entityType: 'AUTH_SESSION',
                entityId: session.token,
                details: {
                  platform_role: 'SUPERADMIN',
                  provider: 'central_smav_supabase',
                  ip: clientIp
                }
              });

              auditLogger.log({
                eventType: 'LOGIN_SUCCESS_SUPERADMIN_SUPABASE',
                actorId: authData.user.id,
                actorEmail: userEmail,
                ipAddress: clientIp,
                details: { role: 'SUPERADMIN', provider: 'central_supabase' }
              });

              return {
                success: true,
                session,
                redirectTo: '/superadmin/outlets'
              };
            } else if (['USER', 'ADMIN', 'STAFF', 'OUTLET_USER'].includes(platformRole)) {
              const { data: memberships, error: membershipError } = await authedSupabase!
                .from('smav_user_outlet_roles')
                .select('outlet_id, role, is_active, metadata')
                .eq('user_id', authData.user.id)
                .eq('is_active', true);

              if (membershipError || !memberships?.length) {
                loginRateLimiter.recordAttempt(rateLimitKey, false);
                return { success: false, message: 'No active SMAV outlet assignment found for this account.' };
              }

              const { data: rows, error: outletError } = await authedSupabase!
                .from('smav_outlets')
                .select('*')
                .in('id', memberships.map((m: any) => m.outlet_id))
                .eq('is_active', true);

              if (outletError || !rows?.length) {
                loginRateLimiter.recordAttempt(rateLimitKey, false);
                return { success: false, message: 'No active registered outlet is accessible for this account.' };
              }

              const authorizedOutlets: Outlet[] = [];
              const authorizedMemberships: UserOutletMembership[] = [];

              for (const r of rows) {
                const outlet = outletFromRow(r);
                await this.outletRepo.upsertRemoteOutlet(r);
                const m = memberships.find((mem: any) => mem.outlet_id === r.id);
                if (!m) continue;

                const rawOutletRole = String(m.role || '').toUpperCase();
                const isOutletAdmin = rawOutletRole
                  ? ['ADMIN', 'OWNER', 'MANAGER'].includes(rawOutletRole)
                  : platformRole === 'ADMIN';
                const outletUserRole: UserRole = isOutletAdmin ? 'admin' : 'staff';
                const visibleRole = displayRoleFor(outletUserRole);
                const perms = permissionsForRole(outletUserRole);

                authorizedOutlets.push(outlet);
                authorizedMemberships.push({
                  outletId: outlet.id,
                  outletCode: outlet.code,
                  outletName: outlet.name,
                  outletCategory: outlet.category,
                  role: outletUserRole,
                  displayRole: visibleRole,
                  specificTitle: isOutletAdmin ? 'Outlet Administrator' : 'POS Billing',
                  permissions: perms,
                  isPrimary: authorizedMemberships.length === 0
                });
              }

              if (authorizedOutlets.length === 0) {
                loginRateLimiter.recordAttempt(rateLimitKey, false);
                return { success: false, message: 'No active assigned outlets available.' };
              }

              // If user has multiple outlets and did not specify outletCode, prompt outlet selection
              if (!outletCode && authorizedOutlets.length > 1) {
                loginRateLimiter.recordAttempt(rateLimitKey, true);
                const tempToken = generateSecureToken('smav_temp');
                this.pendingAuthSelections.set(tempToken, {
                  userId: profile.id,
                  email: userEmail,
                  fullName: profile.full_name || userEmail.split('@')[0],
                  platformRole,
                  supabaseToken: authData.session.access_token,
                  memberships: authorizedMemberships,
                  outlets: authorizedOutlets,
                  expiresAt: Date.now() + 10 * 60 * 1000
                });

                auditLogger.log({
                  eventType: 'MULTI_OUTLET_SELECTION_PROMPTED',
                  actorId: profile.id,
                  actorEmail: userEmail,
                  ipAddress: clientIp,
                  details: { authorizedOutletsCount: authorizedOutlets.length }
                });

                return {
                  success: true,
                  multiBusiness: true,
                  tempToken,
                  availableOutlets: authorizedMemberships,
                  message: 'Multiple authorized outlets found. Select your destination.'
                };
              }

              const cleanCode = outletCode?.trim().toLowerCase();
              const selectedOutlet = cleanCode
                ? authorizedOutlets.find(o => o.code.toLowerCase() === cleanCode || o.id.toLowerCase() === cleanCode)
                : authorizedOutlets[0];

              if (!selectedOutlet) {
                loginRateLimiter.recordAttempt(rateLimitKey, false);
                auditLogger.log({
                  eventType: 'LOGIN_DENIED_UNAUTHORIZED_OUTLET',
                  actorId: profile.id,
                  actorEmail: userEmail,
                  ipAddress: clientIp,
                  details: { requestedOutletCode: outletCode }
                });
                return {
                  success: false,
                  message: `Access denied. You are not assigned to active outlet "${outletCode}".`
                };
              }

              const membership = authorizedMemberships.find(m => m.outletId === selectedOutlet.id)!;
              const account: UserAccount = {
                id: profile.id,
                email: userEmail,
                username: (authData.user.user_metadata?.username as string) || userEmail,
                fullName: profile.full_name || userEmail.split('@')[0],
                phone: userPhone,
                passwordHash: '',
                salt: '',
                role: membership.role,
                isActive: true,
                createdAt: profile.created_at || new Date().toISOString(),
                memberships: authorizedMemberships
              };

              const session = this.createSession(
                account,
                selectedOutlet,
                membership.specificTitle || displayRoleFor(membership.role),
                membership.permissions,
                deviceId,
                authData.session.access_token,
                platformRole
              );
              loginRateLimiter.recordAttempt(rateLimitKey, true);

              await writeTrustedServerAuditLog({
                userId: profile.id,
                userEmail,
                outletId: selectedOutlet.id,
                action: 'LOGIN_SUCCESS',
                entityType: 'AUTH_SESSION',
                entityId: session.token,
                details: {
                  role: membership.displayRole,
                  outletCode: selectedOutlet.code,
                  ip: clientIp
                }
              });

              auditLogger.log({
                eventType: 'LOGIN_SUCCESS',
                actorId: profile.id,
                actorEmail: userEmail,
                outletId: selectedOutlet.id,
                ipAddress: clientIp,
                details: { role: membership.displayRole, outletCode: selectedOutlet.code }
              });

              return {
                success: true,
                session,
                redirectTo: membership.role === 'admin' ? '/admin/dashboard' : '/pos'
              };
            } else {
              loginRateLimiter.recordAttempt(rateLimitKey, false);
              auditLogger.log({
                eventType: 'LOGIN_DENIED_UNKNOWN_PLATFORM_ROLE',
                actorId: profile.id,
                actorEmail: userEmail,
                ipAddress: clientIp,
                details: { detectedRole: platformRole }
              });
              return {
                success: false,
                message: `Authorization failed: User "${userEmail}" has unsupported platform_role "${platformRole}".`
              };
            }
          } else if (authError) {
            const errorMsg = authError.message || '';
            // If it's a project level or network error (not invalid credentials), report clearly
            if (
              !errorMsg.toLowerCase().includes('invalid login credentials') &&
              !errorMsg.toLowerCase().includes('email not confirmed')
            ) {
              auditLogger.log({
                eventType: 'SUPABASE_AUTH_ERROR',
                actorEmail: emailOrId,
                ipAddress: clientIp,
                details: { error: errorMsg, status: authError.status }
              });
              return {
                success: false,
                message: `Central Supabase Auth error: ${errorMsg}`
              };
            }
          }
        } catch (supabaseErr: any) {
          console.error('[Central Supabase Auth Exception]:', supabaseErr.message);
        }
      }
    }

    // Central Supabase Auth is the sole password authentication source — fail closed on any rejection.
    loginRateLimiter.recordAttempt(rateLimitKey, false);
    return {
      success: false,
      message: 'Invalid credentials or inactive Central SMAV account. Verify your email/username and password or contact your outlet administrator.'
    };
  }

  public async completeFirstLoginPasswordChange(
    passwordChangeToken: string,
    newPassword: string,
    ipAddress?: string
  ): Promise<{ success: boolean; email?: string; message: string }> {
    const tokenKey = String(passwordChangeToken || '').trim();
    const pending = this.pendingPasswordChanges.get(tokenKey);
    if (!pending) {
      return { success: false, message: 'Password change session expired or invalid. Please sign in again.' };
    }
    if (pending.expiresAt < Date.now()) {
      this.pendingPasswordChanges.delete(tokenKey);
      return { success: false, message: 'Password change session expired. Please sign in again.' };
    }
    if (!newPassword || newPassword.length < 8) {
      return { success: false, message: 'New password must be at least 8 characters.' };
    }

    try {
      const updateRes = await fetch(`${centralSupabaseConfig.projectUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: centralSupabaseConfig.publishableKey,
          Authorization: `Bearer ${pending.supabaseAccessToken}`
        },
        body: JSON.stringify({
          password: newPassword,
          data: {
            must_change_password: false,
            password_changed_at: new Date().toISOString()
          }
        })
      });

      const updateData = await updateRes.json().catch(() => ({}));
      if (!updateRes.ok) {
        return {
          success: false,
          message: updateData?.msg || updateData?.error_description || updateData?.message || 'Unable to update password in Central Auth.'
        };
      }

      this.pendingPasswordChanges.delete(tokenKey);

      await writeTrustedServerAuditLog({
        userId: pending.userId,
        userEmail: pending.email,
        action: 'FIRST_LOGIN_PASSWORD_CHANGED',
        entityType: 'USER',
        entityId: pending.userId,
        details: { ip: ipAddress || '127.0.0.1' }
      });

      auditLogger.log({
        eventType: 'FIRST_LOGIN_PASSWORD_CHANGED',
        actorId: pending.userId,
        actorEmail: pending.email,
        ipAddress: ipAddress || '127.0.0.1',
        details: {}
      });

      return {
        success: true,
        email: pending.email,
        message: 'Password updated successfully.'
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Failed to update password in Central Auth.'
      };
    }
  }

  public async selectAuthorizedOutlet(
    userIdOrTempToken: string,
    outletId: string,
    deviceId?: string,
    explicitTempToken?: string
  ): Promise<AuthResult> {
    const tokenKey =
      explicitTempToken ||
      (userIdOrTempToken && userIdOrTempToken.startsWith('smav_temp') ? userIdOrTempToken : '');

    if (tokenKey && this.pendingAuthSelections.has(tokenKey)) {
      const pending = this.pendingAuthSelections.get(tokenKey)!;
      if (pending.expiresAt < Date.now()) {
        this.pendingAuthSelections.delete(tokenKey);
        return { success: false, message: 'Outlet selection session expired. Please sign in again.' };
      }

      const membership = pending.memberships.find(m => m.outletId === outletId);
      const outlet = pending.outlets.find(o => o.id === outletId);

      if (!membership || !outlet || !outlet.isActive) {
        auditLogger.log({
          eventType: 'UNAUTHORIZED_OUTLET_SWITCH_ATTEMPT',
          actorId: pending.userId,
          actorEmail: pending.email,
          outletId,
          details: { attemptedOutletId: outletId }
        });
        return { success: false, message: 'Access denied: You are not authorized for this outlet.' };
      }

      this.pendingAuthSelections.delete(tokenKey);

      const account: UserAccount = {
        id: pending.userId,
        email: pending.email,
        fullName: pending.fullName,
        passwordHash: '',
        salt: '',
        role: membership.role,
        isActive: true,
        createdAt: new Date().toISOString(),
        memberships: pending.memberships
      };

      const session = this.createSession(
        account,
        outlet,
        membership.specificTitle || displayRoleFor(membership.role),
        membership.permissions,
        deviceId,
        pending.supabaseToken,
        pending.platformRole
      );

      auditLogger.log({
        eventType: 'OUTLET_SESSION_ACTIVATED',
        actorId: pending.userId,
        actorEmail: pending.email,
        outletId: outlet.id,
        details: { role: membership.displayRole, outletName: outlet.name }
      });

      return {
        success: true,
        session,
        redirectTo: membership.role === 'admin' ? '/admin/dashboard' : '/pos'
      };
    }

    return {
      success: false,
      message: 'Outlet selection session expired or unauthorized. Please sign in again.'
    };
  }

  private createSession(
    user: UserAccount,
    outlet: Outlet,
    specificTitle: string,
    permissions: string[],
    deviceId?: string,
    supabaseToken?: string,
    platformRole?: string
  ): UserSession {
    const token = generateSecureToken('smav_jwt');
    const now = Date.now();
    const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();

    const session: UserSession = {
      token,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      displayRole: displayRoleFor(user.role),
      activeOutlet: outlet,
      assignedOutlets: user.memberships || [],
      specificTitle,
      permissions,
      deviceId: deviceId || 'SMAV-DEV-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      createdAt: new Date(now).toISOString(),
      expiresAt,
      supabaseToken,
      platformRole
    };

    this.activeSessions.set(token, session);
    return session;
  }

  public async validateSession(token: string): Promise<UserSession | null> {
    if (!token) return null;
    const session = this.activeSessions.get(token);
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.activeSessions.delete(token);
      return null;
    }

    return session;
  }

  public async switchOutlet(token: string, outlet: Outlet): Promise<UserSession | null> {
    const session = await this.validateSession(token);
    if (!session || session.role !== 'superadmin') return null;
    session.activeOutlet = outlet;
    session.specificTitle = 'Superadmin Auditor';
    return session;
  }

  public async switchAuthenticatedOutlet(
    token: string,
    outlet: Outlet,
    outletRole: UserRole,
    assignedOutlets?: UserOutletMembership[]
  ): Promise<UserSession | null> {
    const session = await this.validateSession(token);
    if (!session) return null;
    session.activeOutlet = outlet;
    session.role = outletRole;
    session.displayRole = displayRoleFor(outletRole);
    session.permissions = permissionsForRole(outletRole);
    session.specificTitle =
      outletRole === 'superadmin'
        ? 'Superadministrator'
        : outletRole === 'admin'
        ? 'Outlet Administrator'
        : 'POS Billing';
    if (assignedOutlets) {
      session.assignedOutlets = assignedOutlets;
    }
    return session;
  }

  public async revokeSession(token: string): Promise<boolean> {
    const existing = this.activeSessions.get(token);
    if (existing) {
      this.activeSessions.delete(token);
      auditLogger.log({
        eventType: 'SESSION_REVOKED',
        actorId: existing.userId,
        actorEmail: existing.email,
        outletId: existing.activeOutlet.id,
        details: { deviceId: existing.deviceId }
      });
      return true;
    }
    return false;
  }

  public async requestPasswordReset(email: string, _outletCode?: string, ipAddress?: string): Promise<{ success: boolean; resetToken?: string; message: string }> {
    const clientIp = ipAddress || '127.0.0.1';
    const cleanEmail = email.toLowerCase().trim();
    const rateKey = `pwd_reset_${cleanEmail}_${clientIp}`;

    const rateCheck = passwordResetRateLimiter.checkRateLimit(rateKey);
    if (!rateCheck.allowed) {
      return {
        success: false,
        message: `Too many password reset requests. Please wait ${rateCheck.waitSeconds} seconds.`
      };
    }

    if (!centralSupabaseConfig.isConfigured) {
      return {
        success: false,
        message: 'Central SMAV Supabase Auth is not configured.'
      };
    }

    const publicSupabase = getCentralSupabaseClient();
    if (!publicSupabase) {
      return {
        success: false,
        message: 'Unable to reach Central SMAV Supabase Auth.'
      };
    }

    passwordResetRateLimiter.recordAttempt(rateKey, true);
    await publicSupabase.auth.resetPasswordForEmail(cleanEmail).catch(() => null);

    auditLogger.log({
      eventType: 'CENTRAL_PASSWORD_RESET_REQUESTED',
      actorEmail: cleanEmail,
      ipAddress: clientIp,
      details: { provider: 'central_smav_supabase' }
    });

    return {
      success: true,
      message: 'If the email matches an active Central SMAV account, a recovery email has been dispatched. Otherwise contact your outlet administrator for an activation/recovery link.'
    };
  }

  public async confirmPasswordReset(_resetToken: string, _newPassword: string): Promise<{ success: boolean; message: string }> {
    return {
      success: false,
      message: 'Password changes must be completed using the secure recovery link sent by Central SMAV Supabase Auth or issued by an authorized administrator.'
    };
  }
}

// -------------------------------------------------------------------------------------------------
// Instantiate Central Repositories & Gateway
// -------------------------------------------------------------------------------------------------
export const centralOutletRepo = new CentralOutletRepository();
export const centralUserRepo = new CentralUserRepository();
export const retailCatalogRepo = new RetailCatalogRepository();
export const smavGateway = new SmavAuthGateway(centralOutletRepo, centralUserRepo);

// -------------------------------------------------------------------------------------------------
// Authoritative Supabase Projects Configuration
// -------------------------------------------------------------------------------------------------
export const SUPABASE_CONFIG = {
  the_glossy_looks: {
    project_url: 'https://onswigwiwuvkvoduuhxr.supabase.co',
    upstream_api: 'https://www.glossylooks.in/api',
    business_name: 'The Glossy Looks Salon & Spa',
    branch_id: 'tgl-gachibowli-main',
    branch_code: 'GACH',
    branch_name: 'Gachibowli Main Studio'
  },
  mozz_starters4u: {
    project_url: 'https://uyqdnqbadfysnbzbncyj.supabase.co',
    upstream_api: 'https://www.starters4u.in/api',
    business_name: 'MOZZ Chinese & Pizzateria',
    branch_id: 'b0000000-0000-0000-0000-000000000001',
    branch_code: 'GACH',
    branch_name: 'Gachibowli Flagship Kitchen'
  }
};

let salonCatalogRevision = 101;
let salonCatalogLastUpdated = new Date().toISOString();

let restaurantCatalogRevision = 201;
let restaurantCatalogLastUpdated = new Date().toISOString();

export interface AuthoritativeSalonService {
  id: string;
  businessId: string;
  name: string;
  category: string;
  subcategory: string;
  price: number;
  gstPercent: number;
  durationMinutes: number;
  isDiscountEligible: boolean;
  isActive: boolean;
  isDeleted: boolean;
  revision: number;
  updatedAt: string;
}

export interface AuthoritativeMenuItem {
  id: string;
  businessId: string;
  name: string;
  category: string;
  basePrice: number;
  isVeg: boolean;
  variants: Array<{ id: string; name: string; priceDelta: number }>;
  isAvailable: boolean;
  isDeleted: boolean;
  revision: number;
  updatedAt: string;
}

let salonServices: AuthoritativeSalonService[] = [];

let stylists: any[] = [];
let salonAppointments: any[] = [];
let restaurantMenu: AuthoritativeMenuItem[] = [];

let lastSupabaseSyncTimestamp: string | null = null;

let restaurantTables = [
  { tableNumber: 'Table 1', capacity: 2, status: 'available' },
  { tableNumber: 'Table 2', capacity: 4, status: 'occupied', currentOrderId: 'MOZZ-GACH-LIVE-01' },
  { tableNumber: 'Table 3', capacity: 4, status: 'available' },
  { tableNumber: 'Table 4', capacity: 6, status: 'available' },
  { tableNumber: 'Counter 1', capacity: 1, status: 'available' },
  { tableNumber: 'Counter 2', capacity: 1, status: 'available' }
];

let pendingRestaurantOrders = [
  { orderNumber: 'MOZZ-GACH-LIVE-01', tokenNumber: '088', tableOrCounter: 'Table 2', orderType: 'dine_in', itemsCount: 3, grandTotal: 680, status: 'in_kitchen', placedAt: '12 mins ago' },
  { orderNumber: 'MOZZ-GACH-LIVE-02', tokenNumber: '089', tableOrCounter: 'Counter 1', orderType: 'takeaway', itemsCount: 2, grandTotal: 400, status: 'ready', placedAt: '5 mins ago' }
];

let pairedDevices: any[] = [
  { id: 'dev_init_1', device_id: 'SMAV-DEV-A9B2C3D4E5F6', outlet_id: 'outlet_glossy_gach', outlet_code: 'glossylooks', device_name: 'Salon Reception Tablet (Gachibowli)', model_info: 'Samsung Galaxy Tab A9', assigned_role: 'staff', paired_at: new Date(Date.now() - 86400000 * 2).toISOString(), last_seen_at: new Date().toISOString(), is_active: true },
  { id: 'dev_init_2', device_id: 'SMAV-DEV-7F8E9D0C1B2A', outlet_id: 'outlet_mozz_gach', outlet_code: 'mozz', device_name: 'MOZZ Diner Billing Counter #1', model_info: 'OnePlus Pad Go', assigned_role: 'staff', paired_at: new Date(Date.now() - 86400000).toISOString(), last_seen_at: new Date().toISOString(), is_active: true }
];

const syncedBills: any[] = [
  { id: 'bill_seed_01', bill_number: 'TGL-GACH-20261110-00101', business_id: 'the_glossy_looks', outlet_id: 'outlet_glossy_gach', branch_id: 'outlet_glossy_gach', branch_code: 'GACH', customer_name: 'Ananya Sharma', customer_phone: '9848011223', grand_total: 4500, payment_mode: 'upi', created_at_server: new Date(Date.now() - 3600000 * 3).toISOString() }
];
const syncedOrders: any[] = [
  { id: 'ord_seed_01', order_number: 'MOZZ-GACH-20261110-00088', token_number: '088', business_id: 'mozz_starters4u', outlet_id: 'outlet_mozz_gach', branch_id: 'outlet_mozz_gach', branch_code: 'GACH', table_or_counter: 'Table 2', grand_total: 680, payment_mode: 'cash', created_at_server: new Date(Date.now() - 3600000 * 2).toISOString() }
];
const whatsappQueue: any[] = [];

export async function syncLiveSupabaseCatalogs() {
  try {
    const [srvRes, catRes, staffRes] = await Promise.all([
      fetch('https://www.glossylooks.in/api/services', { signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw Error('Salon services API unavailable'); return r.json(); }).catch(() => null),
      fetch('https://www.glossylooks.in/api/categories', { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null),
      fetch('https://www.glossylooks.in/api/staff', { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null)
    ]);

    if (srvRes && Array.isArray(srvRes) && catRes && Array.isArray(catRes)) {
      const catMap = Object.fromEntries(catRes.map((c: any) => [c.id, c.name]));
      salonServices = srvRes.map((s: any) => ({
        id: s.id,
        businessId: 'the_glossy_looks',
        name: s.name,
        category: catMap[s.category_id] || 'Salon',
        subcategory: s.salon_subcategory || (s.description ? s.description.slice(0, 45) : ''),
        price: Number(s.price) || 0,
        gstPercent: 18.0,
        durationMinutes: s.duration_minutes || 45,
        isDiscountEligible: Boolean(s.discount_price && s.discount_price < s.price),
        isActive: Boolean(s.is_active !== false),
        isDeleted: false,
        revision: salonCatalogRevision,
        updatedAt: s.updated_at || new Date().toISOString()
      }));
    }

    const staffRows = Array.isArray(staffRes) ? staffRes :
      (Array.isArray(staffRes?.staff) ? staffRes.staff :
      (Array.isArray(staffRes?.data) ? staffRes.data : []));
    // Staff API is authoritative; do not invent staff or use the logged-in owner as stylist.
    stylists = staffRows
      .filter((st: any) => st && st.id && (st.name || st.full_name) && st.is_active !== false && st.active !== false && st.status !== 'inactive')
      .map((st: any) => ({
        id: String(st.id),
        name: String(st.name || st.full_name),
        specialty: st.specialty || st.role || 'Salon stylist',
        branchId: String(st.branch_id || st.branchId || 'outlet_glossy_gach'),
        phone: st.phone || '',
        skills: st.skills || [],
        isAvailable: true
      }));

    const menuRes = await fetch('https://www.starters4u.in/api/menu', { signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw Error('Restaurant menu API unavailable'); return r.json(); }).catch(() => null);
    if (menuRes && Array.isArray(menuRes)) {
      restaurantMenu = menuRes.map((m: any) => {
        const catClean = (m.category || 'chinese_starters').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        return {
          id: m.id,
          businessId: 'mozz_starters4u',
          name: m.name,
          category: catClean,
          basePrice: Number(m.price) || 0,
          isVeg: m.dietary === 'veg',
          variants: [{ id: 'v_regular', name: 'Regular Portion', priceDelta: 0.0 }],
          isAvailable: Boolean(m.inStock !== false),
          isDeleted: false,
          revision: restaurantCatalogRevision,
          updatedAt: new Date().toISOString()
        };
      });
    }

    if (!Array.isArray(srvRes) || !Array.isArray(catRes) || !Array.isArray(menuRes)) {
      return { success: false, error: "One or more upstream catalogs unavailable; no live synchronization confirmed" };
    }
    salonCatalogRevision += 1;
    restaurantCatalogRevision += 1;
    salonCatalogLastUpdated = new Date().toISOString();
    restaurantCatalogLastUpdated = new Date().toISOString();
    lastSupabaseSyncTimestamp = new Date().toISOString();

    return {
      success: true,
      timestamp: lastSupabaseSyncTimestamp,
      salonCount: salonServices.length,
      restaurantCount: restaurantMenu.length
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// -------------------------------------------------------------------------------------------------
// Realtime SSE Broadcast System
// -------------------------------------------------------------------------------------------------
interface RealtimeClient {
  id: string;
  outletId: string;
  res: express.Response;
}

const realtimeClients: RealtimeClient[] = [];

function broadcastCatalogUpdate(outletId: string, eventData: any) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  realtimeClients.forEach(client => {
    if (client.outletId === outletId || client.outletId === 'all') {
      try {
        client.res.write(payload);
      } catch (_e) {}
    }
  });
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'SMAV Print Agent Enterprise Authentication Gateway',
    mode: isProductionMode ? 'production' : 'development',
    port: PORT,
    host: HOST,
    envConfigured: {
      centralSupabase: centralSupabaseConfig.isConfigured,
      edgeFunction: Boolean(process.env.SMAV_EDGE_FUNCTION_URL || SMAV_EDGE_FUNCTION_URL),
      serviceRole: Boolean(process.env.SMAV_SERVICE_ROLE_KEY?.trim()),
      glossylooksIntegration: Boolean(process.env.GLOSSYLOOKS_INTEGRATION_KEY?.trim()),
      mozzIntegration: Boolean(process.env.MOZZ_INTEGRATION_KEY?.trim())
    },
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/api/realtime/catalog-events', (req, res) => {
  const outletId = (req.query.outlet_id as string) || (req.query.business_id as string) || 'all';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = 'client_' + Math.random().toString(36).substring(2, 9);
  const newClient: RealtimeClient = { id: clientId, outletId, res };
  realtimeClients.push(newClient);

  res.write(`data: ${JSON.stringify({
    type: 'CONNECTED',
    clientId,
    outletId,
    salonRevision: salonCatalogRevision,
    restaurantRevision: restaurantCatalogRevision,
    timestamp: Date.now()
  })}\n\n`);

  req.on('close', () => {
    const idx = realtimeClients.findIndex(c => c.id === clientId);
    if (idx !== -1) realtimeClients.splice(idx, 1);
  });
});

// -------------------------------------------------------------------------------------------------
// Authentication Middleware (Server-Side Verification)
// -------------------------------------------------------------------------------------------------
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];
  const session = await smavGateway.validateSession(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Session expired or invalidated. Please sign in again.' });
  }

  (req as any).userSession = session;
  next();
}

function requireSuperadmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session: UserSession = (req as any).userSession;
  if (!session || session.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Superadmin privileges required' });
  }
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session: UserSession = (req as any).userSession;
  if (!session || (session.role !== 'admin' && session.role !== 'superadmin')) {
    return res.status(403).json({ success: false, message: 'Admin privileges required' });
  }
  next();
}

// -------------------------------------------------------------------------------------------------
// 1. Central SMAV Authentication Gateway Endpoints
// -------------------------------------------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { emailOrId, email, password, outletCode, device_id } = req.body;
  const targetEmailOrId = emailOrId || email;

  if (!targetEmailOrId || !password) {
    return res.status(400).json({ success: false, message: 'Email / User ID and password are required' });
  }

  const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

  try {
    const result = await smavGateway.authenticate({
      emailOrId: targetEmailOrId,
      password,
      outletCode,
      deviceId: device_id,
      ipAddress
    });

    if (!result.success) {
      return res.status(result.requiresPasswordReset || result.requiresPasswordChange ? 403 : 401).json(result);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Authentication error: ' + err.message });
  }
});

app.post('/api/mobile-auth/login', async (req, res) => {
  const { email, password, outlet_code, device_id } = req.body;
  const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

  const result = await smavGateway.authenticate({
    emailOrId: email,
    password,
    outletCode: outlet_code,
    deviceId: device_id,
    ipAddress
  });

  if (!result.success) {
    return res.status(401).json(result);
  }

  if (result.multiBusiness) {
    return res.json({
      success: true,
      multi_business: true,
      temp_token: result.tempToken,
      available_businesses: result.availableOutlets?.map(m => ({
        business_id: m.outletId,
        business_name: m.outletName,
        business_type: m.outletCategory,
        branch_id: m.outletId,
        branch_code: m.outletCode,
        branch_name: m.outletName,
        role: m.role
      }))
    });
  }

  res.json({
    success: true,
    multi_business: false,
    token: result.session?.token,
    session: {
      ...result.session,
      business_id: result.session?.activeOutlet.id,
      business_type: result.session?.activeOutlet.category,
      business_name: result.session?.activeOutlet.name,
      branch_id: result.session?.activeOutlet.id,
      branch_code: result.session?.activeOutlet.code,
      branch_name: result.session?.activeOutlet.name
    },
    catalog_revision: result.session?.activeOutlet.category === 'salon' ? salonCatalogRevision : restaurantCatalogRevision
  });
});

app.post('/api/auth/select-outlet', async (req, res) => {
  const { tempToken, temp_token, userId, user_id, outletId, outlet_id, deviceId, device_id } = req.body;
  const targetToken = tempToken || temp_token;
  const targetUserId = userId || user_id || targetToken;
  const targetOutletId = outletId || outlet_id;

  if ((!targetToken && !targetUserId) || !targetOutletId) {
    return res.status(400).json({ success: false, message: 'tempToken (or userId) and outletId are required' });
  }

  const result = await smavGateway.selectAuthorizedOutlet(targetUserId, targetOutletId, deviceId || device_id, targetToken);
  if (!result.success) {
    return res.status(403).json(result);
  }

  res.json(result);
});

app.post('/api/mobile-auth/select-business', async (req, res) => {
  const { temp_token, tempToken, user_id, business_id, device_id } = req.body;
  const result = await smavGateway.selectAuthorizedOutlet(user_id || temp_token || tempToken, business_id, device_id, temp_token || tempToken);
  if (!result.success) return res.status(403).json(result);

  res.json({
    success: true,
    token: result.session?.token,
    session: {
      ...result.session,
      business_id: result.session?.activeOutlet.id,
      business_type: result.session?.activeOutlet.category,
      business_name: result.session?.activeOutlet.name,
      branch_id: result.session?.activeOutlet.id,
      branch_code: result.session?.activeOutlet.code,
      branch_name: result.session?.activeOutlet.name
    },
    catalog_revision: result.session?.activeOutlet.category === 'salon' ? salonCatalogRevision : restaurantCatalogRevision
  });
});

app.get('/api/auth/session', requireAuth, (req, res) => {
  res.json({ success: true, session: (req as any).userSession });
});

app.get('/api/auth/outlets', requireAuth, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (session.supabaseToken && centralSupabaseConfig.isConfigured) {
    const authedSupabase = getCentralSupabaseClient(session.supabaseToken);
    if (authedSupabase) {
      try {
        if (session.role === 'superadmin') {
          const { data: rows } = await authedSupabase.from('smav_outlets').select('*').eq('is_active', true).order('created_at');
          const memberships: UserOutletMembership[] = (rows || []).map(r => {
            const o = outletFromRow(r);
            return {
              outletId: o.id,
              outletCode: o.code,
              outletName: o.name,
              outletCategory: o.category,
              role: 'superadmin',
              displayRole: 'SUPERADMIN',
              specificTitle: 'Superadministrator',
              permissions: ['*'],
              isPrimary: false
            };
          });
          return res.json({ success: true, activeOutlet: session.activeOutlet, outlets: memberships });
        }

        const { data: roleRows } = await authedSupabase
          .from('smav_user_outlet_roles')
          .select('outlet_id, role, is_active')
          .eq('user_id', session.userId)
          .eq('is_active', true);

        const outletIds = (roleRows || []).map((r: any) => r.outlet_id);
        if (outletIds.length === 0) {
          return res.json({ success: true, activeOutlet: session.activeOutlet, outlets: [] });
        }

        const { data: outletRows } = await authedSupabase
          .from('smav_outlets')
          .select('*')
          .in('id', outletIds)
          .eq('is_active', true);

        const memberships: UserOutletMembership[] = (outletRows || []).map(r => {
          const o = outletFromRow(r);
          const m = (roleRows || []).find((mem: any) => mem.outlet_id === r.id);
          const isOutletAdmin = ['ADMIN', 'OWNER', 'MANAGER'].includes(String(m?.role || '').toUpperCase());
          const outletRole: UserRole = isOutletAdmin ? 'admin' : 'staff';
          return {
            outletId: o.id,
            outletCode: o.code,
            outletName: o.name,
            outletCategory: o.category,
            role: outletRole,
            displayRole: displayRoleFor(outletRole),
            specificTitle: outletRole === 'admin' ? 'Outlet Administrator' : 'POS Billing',
            permissions: permissionsForRole(outletRole),
            isPrimary: false
          };
        });

        return res.json({ success: true, activeOutlet: session.activeOutlet, outlets: memberships });
      } catch (err: any) {
        return res.status(503).json({ success: false, message: `Failed to verify assigned outlets: ${err.message}` });
      }
    }
  }

  res.json({ success: true, activeOutlet: session.activeOutlet, outlets: session.assignedOutlets || [] });
});

app.post('/api/auth/switch-outlet', requireAuth, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  const { outletId } = req.body;
  if (!outletId) {
    return res.status(400).json({ success: false, message: 'outletId is required' });
  }

  if (session.supabaseToken && centralSupabaseConfig.isConfigured) {
    const authedSupabase = getCentralSupabaseClient(session.supabaseToken);
    if (!authedSupabase) {
      return res.status(401).json({ success: false, message: 'Central Supabase session unavailable' });
    }

    const { data: outletRow, error: outletErr } = await authedSupabase
      .from('smav_outlets')
      .select('*')
      .eq('id', outletId)
      .eq('is_active', true)
      .maybeSingle();

    if (outletErr || !outletRow) {
      return res.status(403).json({ success: false, message: 'Selected outlet is inactive or inaccessible.' });
    }

    const targetOutlet = outletFromRow(outletRow);
    await centralOutletRepo.upsertRemoteOutlet(outletRow);

    if (session.role === 'superadmin') {
      const updated = await smavGateway.switchAuthenticatedOutlet(session.token, targetOutlet, 'superadmin');
      return res.json({ success: true, session: updated, redirectTo: '/superadmin/outlets' });
    }

    const { data: roleRows } = await authedSupabase
      .from('smav_user_outlet_roles')
      .select('outlet_id, role, is_active')
      .eq('user_id', session.userId)
      .eq('is_active', true);

    const matchedRole = (roleRows || []).find((r: any) => r.outlet_id === outletId);
    if (!matchedRole) {
      await writeTrustedServerAuditLog({
        userId: session.userId,
        userEmail: session.email,
        outletId,
        action: 'UNAUTHORIZED_OUTLET_SWITCH_ATTEMPT',
        entityType: 'OUTLET',
        entityId: outletId,
        details: { attemptedOutletId: outletId }
      });
      auditLogger.log({
        eventType: 'UNAUTHORIZED_OUTLET_SWITCH_ATTEMPT',
        actorId: session.userId,
        actorEmail: session.email,
        outletId,
        details: { attemptedOutletId: outletId }
      });
      return res.status(403).json({ success: false, message: 'Access denied: You are not assigned to this outlet.' });
    }

    const isOutletAdmin = ['ADMIN', 'OWNER', 'MANAGER'].includes(String(matchedRole.role || '').toUpperCase());
    const nextRole: UserRole = isOutletAdmin ? 'admin' : 'staff';
    const updated = await smavGateway.switchAuthenticatedOutlet(session.token, targetOutlet, nextRole);

    return res.json({
      success: true,
      session: updated,
      redirectTo: nextRole === 'admin' ? '/admin/dashboard' : '/pos'
    });
  }

  const membership = (session.assignedOutlets || []).find(m => m.outletId === outletId);
  if (session.role !== 'superadmin' && !membership) {
    return res.status(403).json({ success: false, message: 'Access denied: You are not assigned to this outlet.' });
  }
  const outlet = await centralOutletRepo.getOutletById(outletId);
  if (!outlet || !outlet.isActive) {
    return res.status(404).json({ success: false, message: 'Selected outlet not found or inactive.' });
  }
  const nextRole: UserRole = session.role === 'superadmin' ? 'superadmin' : (membership?.role || 'staff');
  const updated = await smavGateway.switchAuthenticatedOutlet(session.token, outlet, nextRole);
  res.json({
    success: true,
    session: updated,
    redirectTo: nextRole === 'superadmin' ? '/superadmin/outlets' : nextRole === 'admin' ? '/admin/dashboard' : '/pos'
  });
});

// -------------------------------------------------------------------------------------------------
// Requirement 6: Narrowly scoped authenticated endpoint so users can read only their own profile
// -------------------------------------------------------------------------------------------------
app.get('/api/auth/profile', requireAuth, async (req, res) => {
  const session: UserSession = (req as any).userSession;

  if (session.supabaseToken && centralSupabaseConfig.isConfigured) {
    const authedSupabase = getCentralSupabaseClient(session.supabaseToken);
    if (authedSupabase) {
      try {
        const { data: profile, error } = await authedSupabase
          .from('smav_profiles')
          .select('id, full_name, platform_role, is_active, created_at')
          .eq('id', session.userId)
          .single();

        if (!error && profile) {
          return res.json({
            success: true,
            source: 'central_smav_supabase_rls',
            profile: {
              id: profile.id,
              email: session.email,
              full_name: profile.full_name || session.fullName,
              platform_role: profile.platform_role,
              visible_role: session.displayRole || displayRoleFor(session.role),
              is_active: profile.is_active,
              assigned_outlets: session.assignedOutlets || [],
              created_at: profile.created_at
            }
          });
        }
      } catch (err: any) {
        console.warn('[Profile RLS fetch warn]:', err.message);
      }
    }
  }

  // Fallback internal scoped session profile (restricted strictly to own user)
  res.json({
    success: true,
    source: 'session_tenant_scoped',
    profile: {
      id: session.userId,
      email: session.email,
      full_name: session.fullName,
      platform_role: session.role === 'superadmin' ? 'SUPERADMIN' : 'USER',
      visible_role: session.displayRole || displayRoleFor(session.role),
      is_active: true,
      active_outlet: session.activeOutlet,
      assigned_outlets: session.assignedOutlets || [],
      permissions: session.permissions
    }
  });
});

// =================================================================================================
// Central SMAV Supabase Edge Function Integration (smav-identity-admin)
// Connects Glossy Looks, MOZZ, and SMAV UI to the central Edge Function
// =================================================================================================
const SMAV_EDGE_FUNCTION_URL = process.env.SMAV_EDGE_FUNCTION_URL ||
  'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin';

async function invokeEdgeAdminFunction(
  action: string,
  payload: any,
  tokenOrKey?: string,
  isBusinessKey = false,
  extraHeaders?: Record<string, string>
) {
  const anonKey = centralSupabaseConfig.publishableKey || process.env.SMAV_SUPABASE_ANON_KEY || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders || {})
  };

  if (anonKey) {
    headers['apikey'] = anonKey;
  }

  // Resolve authentic Supabase Auth JWT if an internal session token was provided
  let effectiveToken = tokenOrKey || '';
  if (tokenOrKey && tokenOrKey.startsWith('smav_jwt')) {
    const session = await smavGateway.validateSession(tokenOrKey);
    effectiveToken = session?.supabaseToken || '';
  }

  if (isBusinessKey && tokenOrKey) {
    headers['X-Integration-Key'] = tokenOrKey;
    headers['X-Business-Source'] = payload.businessSource || payload.outletCode || (action.includes('glossy') ? 'glossylooks' : action.includes('mozz') ? 'mozz' : 'central');
    // For backend integration calls, send valid user JWT if present or anonKey for Kong gateway routing only;
    // never inject service_role into untrusted caller requests.
    if (effectiveToken && effectiveToken.startsWith('eyJ')) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    } else if (anonKey) {
      headers['Authorization'] = `Bearer ${anonKey}`;
    }
  } else if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  } else if (action === 'get-info' && anonKey) {
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  try {
    const response = await fetch(SMAV_EDGE_FUNCTION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload })
    });

    const status = response.status;
    let data: any = {};
    try {
      data = await response.json();
    } catch {
      data = { success: false, error: `HTTP ${status}: Non-JSON response from Edge Function` };
    }

    if (status === 401 || status === 403) {
      const errDetail = data?.error || data?.message || (status === 403 ? 'Forbidden' : 'Unauthorized');
      const code = data?.details?.code || (data?.message?.includes('Missing authorization') ? 'UNAUTHORIZED_NO_AUTH_HEADER' : 'UNAUTHORIZED_AUTH_REJECTED');
      return {
        success: false,
        status,
        code,
        error: `Edge Function ${status} ${status === 403 ? 'Forbidden' : 'Unauthorized'}: ${errDetail}`,
        details: data?.details || data,
        diagnostic: status === 401 ? {
          origin: code === 'UNAUTHORIZED_NO_AUTH_HEADER' ? 'Supabase API Gateway (Kong)' : 'smav-identity-admin Function Logic',
          solution: 'Check that the request carries a valid user JWT or an authorized business integration key, and verify the Edge Function gateway JWT setting matches the intended authentication mode. Do not disable JWT verification without a security review.'
        } : undefined
      };
    }

    return { status, ...data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// 1. Staff Provisioning & Sync Endpoint
app.post('/api/central-auth/staff/provision', async (req, res) => {
  const gatewaySecret = req.headers['x-smav-gateway-secret'] || req.headers['x-integration-key'];
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : '';

  if (!bearerToken && !gatewaySecret) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Bearer token or integration key is required' });
  }

  let effectiveTokenOrKey = (gatewaySecret as string) || bearerToken;
  if (bearerToken && bearerToken.startsWith('smav_jwt')) {
    const sess = await smavGateway.validateSession(bearerToken);
    if (!sess) {
      return res.status(401).json({ success: false, message: 'Invalid or expired SMAV session' });
    }
    if (!['superadmin', 'admin'].includes(sess.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Admin or Superadmin role required' });
    }
    if (!sess.supabaseToken) {
      return res.status(401).json({ success: false, message: 'Central Supabase session token missing' });
    }
    effectiveTokenOrKey = sess.supabaseToken;
  }

  const { email, fullName, phone, role, outletCode, businessSource, externalStaffId, username, initialPassword, isActive } = req.body;
  if (!email || !outletCode) {
    return res.status(400).json({ success: false, message: 'email and outletCode are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanSource = String(businessSource || outletCode || 'central').toLowerCase();
  const isBusiness = Boolean(gatewaySecret && !bearerToken);

  const emailCheck = assessEmailQuality(cleanEmail);
  if (emailCheck.status !== 'valid') {
    return res.status(400).json({
      success: false,
      message: `A valid, reachable email address is required (${emailCheck.reason || 'invalid'}).`
    });
  }

  const edgeResult = await invokeEdgeAdminFunction('upsert-user', {
    email: cleanEmail,
    fullName,
    phone,
    role,
    outletCode,
    businessSource: cleanSource,
    externalStaffId,
    username,
    ...(initialPassword ? { initialPassword } : {}),
    ...(typeof isActive === 'boolean' ? { isActive } : {})
  }, effectiveTokenOrKey, isBusiness);

  if (edgeResult.success) {
    return res.json({
      success: true,
      message: edgeResult.message || `User "${cleanEmail}" synchronized with Central SMAV.`,
      centralUserId: edgeResult.userId,
      isNewUser: edgeResult.isNewUser ?? false,
      isLinked: true,
      outletCode,
      mustChangePassword: edgeResult.mustChangePassword
    });
  }

  const statusCode = edgeResult.status === 401 || edgeResult.error?.includes('Unauthorized')
    ? 401
    : edgeResult.status === 403 || edgeResult.error?.includes('Forbidden')
      ? 403
      : edgeResult.status || 400;
  res.status(statusCode).json({
    success: false,
    message: edgeResult.error || 'Failed to synchronize with Central SMAV identity system',
    details: edgeResult
  });
});

// 2. Staff Status (Activate / Deactivate) Endpoint
app.post('/api/central-auth/staff/status', async (req, res) => {
  const gatewaySecret = req.headers['x-smav-gateway-secret'] || req.headers['x-integration-key'];
  const bearerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : '';
  if (!bearerToken && !gatewaySecret) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Bearer token or integration key is required' });
  }

  let effectiveTokenOrKey = (gatewaySecret as string) || bearerToken;
  if (bearerToken && bearerToken.startsWith('smav_jwt')) {
    const session = await smavGateway.validateSession(bearerToken);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    if (session.role !== 'superadmin' && session.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: SUPERADMIN or outlet ADMIN privileges required.' });
    }
    if (!session.supabaseToken) {
      return res.status(401).json({ success: false, message: 'Central Supabase JWT missing on session.' });
    }
    effectiveTokenOrKey = session.supabaseToken;
  }

  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const outletCode = typeof req.body?.outletCode === 'string' ? req.body.outletCode.trim() : undefined;
  const isActive = Boolean(req.body?.isActive);

  if (!userId && !email) {
    return res.status(400).json({ success: false, message: 'Target userId or email is required.' });
  }

  const edgeResult = await invokeEdgeAdminFunction(
    'set-status',
    {
      ...(userId ? { userId } : {}),
      ...(email ? { email } : {}),
      ...(outletCode ? { outletCode } : {}),
      isActive
    },
    effectiveTokenOrKey,
    Boolean(gatewaySecret && !bearerToken)
  );

  res.status(edgeResult.success ? 200 : (edgeResult.status || 400)).json(edgeResult);
});

// -------------------------------------------------------------------------------------------------
// Email Quality, Role Normalization, & Enriched Central Staff Inspection Helpers
// -------------------------------------------------------------------------------------------------

function assessEmailQuality(email?: string | null): {
  status: 'valid' | 'dummy_or_alias' | 'missing';
  reason?: string;
} {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) {
    return { status: 'missing', reason: 'No email assigned' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) {
    return { status: 'dummy_or_alias', reason: 'Invalid email format' };
  }
  const [localPart, domainPart] = clean.split('@');
  if (
    /^(example\.|test\.|dummy\.|invalid|localhost|placeholder\.)/.test(domainPart) ||
    domainPart.endsWith('.local') ||
    domainPart.endsWith('.test') ||
    domainPart.endsWith('.invalid')
  ) {
    return { status: 'dummy_or_alias', reason: 'Dummy/placeholder domain' };
  }
  if (['staff', 'owner', 'admin', 'user', 'test', 'demo', 'dummy', 'noemail', 'noreply', 'temp'].includes(localPart)) {
    return { status: 'dummy_or_alias', reason: 'Generic alias/placeholder mailbox — update to staff member personal/verified email before activation' };
  }
  return { status: 'valid' };
}

function mapGlossyProductionRole(rawRole?: string): {
  smavRole: 'ADMIN' | 'STAFF';
  edgeRoleHint: 'OWNER' | 'MANAGER' | 'ADMIN' | 'STYLIST' | 'RECEPTIONIST';
  displayTitle: string;
} {
  const norm = String(rawRole || '').trim().toUpperCase();
  if (
    norm === 'OWNER' ||
    norm.includes('OWNER') ||
    norm.includes('DIRECTOR') ||
    norm.includes('FOUNDER') ||
    norm.includes('PARTNER') ||
    norm.includes('PROPRIETOR')
  ) {
    return { smavRole: 'ADMIN', edgeRoleHint: 'OWNER', displayTitle: rawRole || 'Salon Owner / Director' };
  }
  if (norm === 'MANAGER' || norm.includes('MANAGER') || norm === 'ADMIN') {
    return { smavRole: 'ADMIN', edgeRoleHint: 'MANAGER', displayTitle: rawRole || 'Salon Branch Manager' };
  }
  if (norm.includes('STYLIST') || norm.includes('ARTIST') || norm.includes('BEAUTICIAN')) {
    return { smavRole: 'STAFF', edgeRoleHint: 'STYLIST', displayTitle: rawRole || 'Salon Stylist' };
  }
  return { smavRole: 'STAFF', edgeRoleHint: 'RECEPTIONIST', displayTitle: rawRole || 'Salon Receptionist / Cashier' };
}

async function fetchEnrichedCentralStaff(supabaseJwt: string, outletCode?: string) {
  const edgeRes = await invokeEdgeAdminFunction('list-staff', outletCode ? { outletCode } : {}, supabaseJwt);
  if (!edgeRes.success || !Array.isArray(edgeRes.staff)) {
    return {
      success: false,
      status: edgeRes.status || 403,
      error: edgeRes.error || 'Failed to fetch staff list from Central SMAV',
      staff: [] as any[]
    };
  }

  const edgeRows = edgeRes.staff;
  const userIds = Array.from(
    new Set(
      edgeRows
        .map((r: any) => String(r.userId || r.id || '').trim())
        .filter((id: string) => /^[0-9a-f-]{36}$/i.test(id))
    )
  );

  // Hydrate full identity, profile, and role metadata using the caller's RLS-enforced Central JWT
  const profileMap = new Map<string, any>();
  const identityByUserMap = new Map<string, any[]>();
  const outletRolesByUserMap = new Map<string, any[]>();
  const authUserMap = new Map<string, any>();

  const authedClient = getCentralSupabaseClient(supabaseJwt);
  if (authedClient && userIds.length > 0) {
    const [profilesRes, identitiesRes, rolesRes] = await Promise.all([
      authedClient
        .from('smav_profiles')
        .select('id, full_name, platform_role, is_active, created_at')
        .in('id', userIds),
      authedClient
        .from('smav_external_identities')
        .select('source, external_id, auth_user_id, username, email, created_at')
        .in('auth_user_id', userIds),
      authedClient
        .from('smav_user_outlet_roles')
        .select('id, user_id, outlet_id, role, is_active, created_at, smav_outlets(id, outlet_code, outlet_name, business_type, is_active)')
        .in('user_id', userIds)
    ]);

    for (const p of profilesRes.data || []) {
      profileMap.set(String(p.id), p);
    }
    for (const ident of identitiesRes.data || []) {
      const uid = String(ident.auth_user_id);
      const list = identityByUserMap.get(uid) || [];
      list.push(ident);
      identityByUserMap.set(uid, list);
    }
    for (const rr of rolesRes.data || []) {
      const uid = String(rr.user_id);
      const list = outletRolesByUserMap.get(uid) || [];
      list.push(rr);
      outletRolesByUserMap.set(uid, list);
    }
  }

  // If SMAV_SERVICE_ROLE_KEY is configured server-side, enrich authoritative Auth state
  if (process.env.SMAV_SERVICE_ROLE_KEY && centralSupabaseConfig.projectUrl) {
    try {
      const authListRes = await fetch(`${centralSupabaseConfig.projectUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
        headers: {
          apikey: process.env.SMAV_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SMAV_SERVICE_ROLE_KEY}`
        },
        signal: AbortSignal.timeout(3500)
      });
      if (authListRes.ok) {
        const payload = await authListRes.json();
        for (const u of payload?.users || []) {
          authUserMap.set(String(u.id), u);
        }
      }
    } catch (_e) {
      // Non-fatal; RLS hydration remains active
    }
  }

  // Group rows by Central Auth UUID (userId) so multi-outlet users render cleanly without losing outlet roles
  const grouped = new Map<string, any>();

  for (const r of edgeRows) {
    const uid = String(r.userId || r.id || '').trim();
    if (!uid) continue;

    const profile = profileMap.get(uid);
    const identities = identityByUserMap.get(uid) || [];
    const authUser = authUserMap.get(uid);
    const rlsRoles = outletRolesByUserMap.get(uid) || [];

    const primaryIdent =
      identities.find((i: any) => String(i.source || '').toLowerCase() === String(r.outletCode || '').toLowerCase()) ||
      identities[0];

    const resolvedEmail = String(
      authUser?.email ||
      r.email ||
      primaryIdent?.email ||
      ''
    ).trim();

    const resolvedUsername = String(
      r.username ||
      primaryIdent?.username ||
      authUser?.user_metadata?.username ||
      ''
    ).trim();

    const resolvedPlatformRole = String(
      r.platformRole ||
      profile?.platform_role ||
      'USER'
    ).toUpperCase();

    const rawOutletRole = String(r.role || 'STAFF').toUpperCase();
    const outletEntry = {
      outletId: r.outletId,
      outletCode: r.outletCode,
      outletName: r.outletName || r.outletCode,
      category: r.outletCategory || 'other',
      role: rawOutletRole,
      displayRole: rawOutletRole === 'ADMIN' ? 'ADMIN' : 'POS_BILLING',
      isActive: r.isActive !== false
    };

    if (!grouped.has(uid)) {
      const emailCheck = assessEmailQuality(resolvedEmail);
      const isProfileActive = profile ? profile.is_active !== false : r.isActive !== false;
      const isBanned = Boolean(authUser?.banned_until && new Date(authUser.banned_until).getTime() > Date.now());
      const effectiveActive = isProfileActive && r.isActive !== false && !isBanned;
      const emailConfirmed = authUser ? Boolean(authUser.email_confirmed_at) : Boolean(r.emailConfirmed);
      const hasSignedIn = authUser ? Boolean(authUser.last_sign_in_at) : Boolean(r.hasSignedIn);
      const mustChangePassword = Boolean(authUser?.user_metadata?.must_change_password === true || r.mustChangePassword);

      grouped.set(uid, {
        id: uid,
        userId: uid,
        email: resolvedEmail || null,
        emailStatus: emailCheck.status,
        emailWarning: emailCheck.reason || null,
        username: resolvedUsername || null,
        externalStaffId: primaryIdent?.external_id || r.externalStaffId || null,
        fullName: profile?.full_name || r.fullName || resolvedUsername || resolvedEmail || uid,
        phone: r.phone || authUser?.user_metadata?.phone || '',
        platformRole: resolvedPlatformRole,
        role: rawOutletRole === 'ADMIN' ? 'admin' : 'staff',
        outletRole: rawOutletRole,
        displayRole: rawOutletRole === 'ADMIN' ? 'ADMIN' : 'POS_BILLING',
        outletId: outletEntry.outletId,
        outletCode: outletEntry.outletCode,
        outletName: outletEntry.outletName,
        outletCategory: outletEntry.category,
        outlets: [outletEntry],
        isActive: effectiveActive,
        emailConfirmed,
        hasSignedIn,
        mustChangePassword,
        lastSignInAt: authUser?.last_sign_in_at || r.lastSignInAt || null,
        lastSyncedAt: r.lastSyncedAt || primaryIdent?.created_at || null,
        syncOrigin: r.syncOrigin || 'central_smav',
        syncVersion: Number(r.syncVersion || 1),
        syncStatus: effectiveActive ? 'synced' : 'disabled',
        syncNote: !effectiveActive
          ? 'Disabled across outlet & Central Auth'
          : mustChangePassword
            ? 'Temporary password active — user must change password on first login'
            : 'Synced & Ready'
      });
    } else {
      const existing = grouped.get(uid);
      if (!existing.outlets.some((o: any) => o.outletId === outletEntry.outletId)) {
        existing.outlets.push(outletEntry);
      }
      if (rawOutletRole === 'ADMIN') {
        existing.role = 'admin';
        existing.outletRole = 'ADMIN';
        existing.displayRole = 'ADMIN';
      }
    }

    // Add any extra RLS-visible roles not yet listed
    const entry = grouped.get(uid);
    for (const rr of rlsRoles) {
      if (outletCode && String(rr.smav_outlets?.outlet_code || '').toLowerCase() !== outletCode.toLowerCase()) {
        continue;
      }
      if (!entry.outlets.some((o: any) => o.outletId === rr.outlet_id)) {
        const rrRole = String(rr.role || 'STAFF').toUpperCase();
        entry.outlets.push({
          outletId: rr.outlet_id,
          outletCode: rr.smav_outlets?.outlet_code || rr.outlet_id,
          outletName: rr.smav_outlets?.outlet_name || rr.smav_outlets?.outlet_code || rr.outlet_id,
          category: String(rr.smav_outlets?.business_type || 'other').toLowerCase(),
          role: rrRole,
          displayRole: rrRole === 'ADMIN' ? 'ADMIN' : 'POS_BILLING',
          isActive: rr.is_active !== false
        });
        if (rrRole === 'ADMIN') {
          entry.role = 'admin';
          entry.outletRole = 'ADMIN';
          entry.displayRole = 'ADMIN';
        }
      }
    }
  }

  return {
    success: true,
    status: 200,
    staff: Array.from(grouped.values())
  };
}

// 3. Password Reset Request Endpoint (Server-Authorized, UUID-First, Never Returns Plaintext Passwords)
app.post('/api/central-auth/staff/reset-password', async (req, res) => {
  const gatewaySecret = req.headers['x-smav-gateway-secret'] || req.headers['x-integration-key'];
  const bearerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : '';
  if (!bearerToken && !gatewaySecret) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Bearer token or integration key is required' });
  }

  let effectiveTokenOrKey = (gatewaySecret as string) || bearerToken;
  let actorId: string | undefined;
  let actorEmail: string | undefined;

  if (bearerToken && bearerToken.startsWith('smav_jwt')) {
    const session = await smavGateway.validateSession(bearerToken);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    if (session.role !== 'superadmin' && session.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: SUPERADMIN or outlet ADMIN privileges required.' });
    }
    if (!session.supabaseToken) {
      return res.status(401).json({ success: false, message: 'Central Supabase JWT missing on session. Sign in again.' });
    }
    effectiveTokenOrKey = session.supabaseToken;
    actorId = session.userId;
    actorEmail = session.email;
  }

  const cleanUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const cleanEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const cleanOutletCode = typeof req.body?.outletCode === 'string' ? req.body.outletCode.trim() : undefined;
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!cleanUserId && !cleanEmail) {
    return res.status(400).json({
      success: false,
      message: 'Target Central Auth UUID (userId) or email is required to reset password.'
    });
  }

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'newPassword (minimum 8 characters) is required for server-side password reset.'
    });
  }

  const edgeResult = await invokeEdgeAdminFunction(
    'reset-password',
    {
      ...(cleanUserId ? { userId: cleanUserId } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
      ...(cleanOutletCode ? { outletCode: cleanOutletCode } : {}),
      newPassword
    },
    effectiveTokenOrKey,
    Boolean(gatewaySecret && !bearerToken)
  );

  auditLogger.log({
    eventType: edgeResult.success ? 'CENTRAL_STAFF_PASSWORD_RESET' : 'CENTRAL_STAFF_PASSWORD_RESET_FAILED',
    actorId,
    actorEmail,
    details: {
      targetUserId: cleanUserId || null,
      targetEmail: cleanEmail || null,
      outletCode: cleanOutletCode || null,
      mustChangePassword: true,
      success: Boolean(edgeResult.success)
    }
  });

  if (edgeResult.success) {
    await writeTrustedServerAuditLog({
      userId: actorId || 'system',
      userEmail: actorEmail || 'system@smav.local',
      action: 'STAFF_PASSWORD_RESET_DIRECT',
      entityType: 'USER',
      entityId: edgeResult.userId || cleanUserId || cleanEmail,
      details: { outletCode: cleanOutletCode || null, mustChangePassword: true }
    });
  }

  res.status(edgeResult.success ? 200 : (edgeResult.status || 400)).json({
    success: Boolean(edgeResult.success),
    userId: edgeResult.userId || cleanUserId || undefined,
    email: edgeResult.email || cleanEmail || undefined,
    mustChangePassword: Boolean(edgeResult.mustChangePassword ?? true),
    message: edgeResult.message || edgeResult.error || 'Password reset failed.'
  });
});

// 4. Staff List for Portal Verification (Enriched with UUID, Email, Username, Roles, Outlets, Sync Status)
app.get('/api/central-auth/staff/list', async (req, res) => {
  const outletCode = req.query.outlet_code as string | undefined;
  const bearerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : '';
  if (!bearerToken) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Bearer token is required', staff: [] });
  }

  if (!centralSupabaseConfig.isConfigured) {
    return res.status(503).json({ success: false, message: 'Central SMAV Supabase Auth is not configured', staff: [] });
  }

  let supabaseJwt = bearerToken;
  if (bearerToken.startsWith('smav_jwt')) {
    const session = await smavGateway.validateSession(bearerToken);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.', staff: [] });
    }
    if (session.role !== 'superadmin' && session.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: SUPERADMIN or outlet ADMIN privileges required.', staff: [], });
    }
    if (!session.supabaseToken) {
      return res.status(401).json({ success: false, message: 'Central Supabase JWT missing on session.', staff: [] });
    }
    supabaseJwt = session.supabaseToken;
  }

  const enriched = await fetchEnrichedCentralStaff(supabaseJwt, outletCode);
  if (!enriched.success) {
    return res.status(enriched.status || 403).json({
      success: false,
      message: enriched.error || 'Failed to fetch staff list',
      staff: []
    });
  }

  res.json({
    success: true,
    count: enriched.staff.length,
    staff: enriched.staff
  });
});

// 5. Edge Function Health / Diagnostics
app.get('/api/central-auth/edge/status', async (_req, res) => {
  try {
    const edgeResult = await invokeEdgeAdminFunction('get-info', {});
    res.json({
      success: true,
      edgeUrl: SMAV_EDGE_FUNCTION_URL,
      connected: edgeResult.success ?? false,
      details: edgeResult
    });
  } catch (err: any) {
    res.status(503).json({ success: false, edgeUrl: SMAV_EDGE_FUNCTION_URL, error: err.message });
  }
});

// =================================================================================================
// Unified Bidirectional Multi-Outlet User Sync Coordinator & Outbox APIs
// =================================================================================================
async function resolveOutletTargetDescriptor(codeOrId: string, callerJwt?: string): Promise<OutletTargetDescriptor | null> {
  const target = String(codeOrId || '').trim().toLowerCase();
  if (!target) return null;

  const serviceClient = getCentralSupabaseServiceClient();
  const db = callerJwt ? getCentralSupabaseClient(callerJwt) : serviceClient;
  if (db) {
    try {
      const { data } = await db
        .from('smav_outlets')
        .select('*')
        .or(`outlet_code.ilike.${target},id.eq.${target}`)
        .limit(1);
      if (data && data[0]) {
        const mapped = outletFromRow(data[0]);
        return {
          id: mapped.id,
          code: mapped.code,
          name: mapped.name,
          providerType: mapped.providerType,
          supabaseUrl: mapped.supabaseUrl,
          syncWebhookUrl: mapped.syncWebhookUrl
        };
      }
    } catch (_e) {}
  }

  const fallback =
    (await centralOutletRepo.getOutletByCode(target)) ||
    (await centralOutletRepo.getOutletById(target));
  if (fallback) {
    return {
      id: fallback.id,
      code: fallback.code,
      name: fallback.name,
      providerType: fallback.providerType,
      supabaseUrl: fallback.supabaseUrl,
      syncWebhookUrl: fallback.syncWebhookUrl
    };
  }
  return null;
}

export const outletSyncCoordinator = new OutletUserSyncCoordinator({
  invokeEdge: invokeEdgeAdminFunction,
  getCentralUrl: () => centralSupabaseConfig.projectUrl,
  resolveOutlet: (codeOrId) => resolveOutletTargetDescriptor(codeOrId),
  logAudit: (entry) => auditLogger.log(entry)
});

function resolveScopedOutletForCaller(session: UserSession, requestedOutletCode?: string): {
  allowed: boolean;
  outletCode: string;
  error?: string;
} {
  const cleanRequested = String(requestedOutletCode || '').trim().toLowerCase();
  if (session.role === 'superadmin') {
    const code = cleanRequested || session.activeOutlet?.code?.toLowerCase() || '';
    return { allowed: Boolean(code), outletCode: code, error: code ? undefined : 'outletCode is required.' };
  }

  const activeCode = session.activeOutlet?.code?.toLowerCase() || '';
  if (!cleanRequested || cleanRequested === activeCode) {
    return { allowed: Boolean(activeCode), outletCode: activeCode };
  }

  const assignedMatch = (session.assignedOutlets || []).find(
    o => o.outletCode.toLowerCase() === cleanRequested && o.role === 'admin'
  );
  if (assignedMatch) {
    return { allowed: true, outletCode: assignedMatch.outletCode.toLowerCase() };
  }

  return {
    allowed: false,
    outletCode: cleanRequested,
    error: `Forbidden: Outlet ADMIN cannot manage users for unassigned outlet "${cleanRequested}".`
  };
}

// 1. Unified Outlet Users List (RBAC-enforced + Outbox overlay)
app.get('/api/outlet-users', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.', users: [] });
  }

  const requestedCode = typeof req.query.outletCode === 'string' ? req.query.outletCode.trim() : undefined;
  let filterCode: string | undefined;

  if (session.role === 'superadmin') {
    filterCode = requestedCode && requestedCode !== 'all' ? requestedCode : undefined;
  } else {
    const scope = resolveScopedOutletForCaller(session, requestedCode);
    if (!scope.allowed) {
      return res.status(403).json({ success: false, message: scope.error, users: [] });
    }
    filterCode = scope.outletCode;
  }

  const enriched = await fetchEnrichedCentralStaff(session.supabaseToken, filterCode);
  if (!enriched.success) {
    return res.status(enriched.status || 403).json({
      success: false,
      message: enriched.error || 'Failed to list outlet users',
      users: []
    });
  }

  const outboxItems = await outletSyncCoordinator.listOutbox({
    outletCode: filterCode,
    allowedOutletCodes: session.role === 'superadmin'
      ? undefined
      : (session.assignedOutlets || []).map(o => o.outletCode),
    callerSupabaseJwt: session.supabaseToken,
    limit: 100
  });

  const latestOutboxByUser = new Map<string, any>();
  for (const item of outboxItems) {
    if (item.targetUserId && !latestOutboxByUser.has(item.targetUserId)) {
      latestOutboxByUser.set(item.targetUserId, item);
    }
  }

  const users = enriched.staff.map((u: any) => {
    const outbox = latestOutboxByUser.get(u.userId);
    const derivedSyncStatus =
      !u.isActive
        ? 'disabled'
        : outbox?.status === 'CONFLICT'
          ? 'conflict'
          : outbox && outbox.status !== 'SYNCED'
            ? 'pending_outlet_sync'
            : 'synced';
    return {
      ...u,
      syncStatus: derivedSyncStatus,
      outboxStatus: outbox?.status || null,
      outboxLastError: outbox?.lastError || null,
      outboxId: outbox?.id || null
    };
  });

  res.json({ success: true, count: users.length, users });
});

// 2. Unified Create / Upsert Outlet User (name, username, email, role, initialPassword)
app.post('/api/outlet-users', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const { userId, externalStaffId, fullName, username, email, phone, role, outletCode, initialPassword, isActive, idempotencyKey } = req.body || {};
  const scope = resolveScopedOutletForCaller(session, outletCode);
  if (!scope.allowed) {
    return res.status(403).json({ success: false, message: scope.error });
  }

  const outlet = await resolveOutletTargetDescriptor(scope.outletCode, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Active outlet "${scope.outletCode}" not found.` });
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(fullName || '').trim();
  const requestedRole = String(role || 'STAFF').trim().toUpperCase();

  if (requestedRole === 'SUPERADMIN') {
    return res.status(403).json({ success: false, message: 'Forbidden: SUPERADMIN role cannot be assigned through user management.' });
  }
  const normalizedRole: 'ADMIN' | 'STAFF' = requestedRole === 'ADMIN' || requestedRole === 'OWNER' || requestedRole === 'MANAGER' ? 'ADMIN' : 'STAFF';
  if (normalizedRole === 'ADMIN' && session.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Only SUPERADMIN can assign ADMIN roles.' });
  }

  const emailCheck = assessEmailQuality(cleanEmail);
  if (emailCheck.status !== 'valid') {
    return res.status(400).json({ success: false, message: `A valid email address is required (${emailCheck.reason || 'invalid'}).` });
  }
  if (!cleanName) {
    return res.status(400).json({ success: false, message: 'Full Name is required.' });
  }
  if (!userId && (!initialPassword || String(initialPassword).length < 8)) {
    return res.status(400).json({ success: false, message: 'Initial temporary password (min. 8 characters) is required when creating a user.' });
  }

  const result = await outletSyncCoordinator.dispatchSync({
    idempotencyKey,
    syncOrigin: 'smav_portal',
    action: userId ? 'update_user' : 'upsert_user',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    transientPassword: initialPassword ? String(initialPassword) : undefined,
    payload: {
      ...(userId ? { userId: String(userId).trim() } : {}),
      ...(externalStaffId ? { externalStaffId: String(externalStaffId).trim() } : {}),
      fullName: cleanName,
      username: username ? String(username).trim().toLowerCase() : cleanEmail.split('@')[0],
      email: cleanEmail,
      phone: phone ? String(phone).trim() : '',
      role: normalizedRole,
      isActive: isActive !== false
    }
  });

  return res.status(result.httpStatus).json(result);
});

// 3. Edit Existing Outlet User (UUID-preserving, never duplicates or overwrites password)
app.put('/api/outlet-users/:userId', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const targetUserId = String(req.params.userId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return res.status(400).json({ success: false, message: 'Valid Central Auth UUID is required.' });
  }

  const { externalStaffId, fullName, username, email, phone, role, outletCode, isActive, idempotencyKey } = req.body || {};
  const scope = resolveScopedOutletForCaller(session, outletCode);
  if (!scope.allowed) {
    return res.status(403).json({ success: false, message: scope.error });
  }

  const outlet = await resolveOutletTargetDescriptor(scope.outletCode, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Outlet "${scope.outletCode}" not found.` });
  }

  const cleanEmail = email ? String(email).trim().toLowerCase() : undefined;
  if (cleanEmail) {
    const emailCheck = assessEmailQuality(cleanEmail);
    if (emailCheck.status !== 'valid') {
      return res.status(400).json({ success: false, message: `Please provide a valid email address (${emailCheck.reason || 'invalid'}).` });
    }
  }

  let normalizedRole: 'ADMIN' | 'STAFF' | undefined;
  if (role !== undefined) {
    const rUpper = String(role).trim().toUpperCase();
    if (rUpper === 'SUPERADMIN') {
      return res.status(403).json({ success: false, message: 'Forbidden: SUPERADMIN role cannot be modified here.' });
    }
    normalizedRole = rUpper === 'ADMIN' || rUpper === 'OWNER' || rUpper === 'MANAGER' ? 'ADMIN' : 'STAFF';
    if (normalizedRole === 'ADMIN' && session.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Only SUPERADMIN can assign ADMIN roles.' });
    }
  }

  const result = await outletSyncCoordinator.dispatchSync({
    idempotencyKey,
    syncOrigin: 'smav_portal',
    action: 'update_user',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    payload: {
      userId: targetUserId,
      ...(externalStaffId ? { externalStaffId: String(externalStaffId).trim() } : {}),
      ...(fullName ? { fullName: String(fullName).trim() } : {}),
      ...(username ? { username: String(username).trim().toLowerCase() } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
      ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
      ...(normalizedRole ? { role: normalizedRole } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {})
    }
  });

  return res.status(result.httpStatus).json(result);
});

// 4. Direct Server-Side Password Reset (sets temporary password + must_change_password = true + audit log)
app.post('/api/outlet-users/:userId/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const targetUserId = String(req.params.userId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return res.status(400).json({ success: false, message: 'Valid Central Auth UUID is required.' });
  }

  const { newPassword, email, outletCode, idempotencyKey } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Temporary password must be at least 8 characters.' });
  }

  const scope = resolveScopedOutletForCaller(session, outletCode);
  if (!scope.allowed) {
    return res.status(403).json({ success: false, message: scope.error });
  }

  const outlet = await resolveOutletTargetDescriptor(scope.outletCode, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Outlet "${scope.outletCode}" not found.` });
  }

  const result = await outletSyncCoordinator.dispatchSync({
    idempotencyKey,
    syncOrigin: 'smav_portal',
    action: 'reset_password',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    transientPassword: String(newPassword),
    payload: {
      userId: targetUserId,
      ...(email ? { email: String(email).trim().toLowerCase() } : {}),
      mustChangePassword: true
    }
  });

  await writeTrustedServerAuditLog({
    userId: session.userId,
    userEmail: session.email,
    outletId: outlet.id,
    action: result.success ? 'ADMIN_PASSWORD_RESET_ISSUED' : 'ADMIN_PASSWORD_RESET_FAILED',
    entityType: 'USER',
    entityId: targetUserId,
    details: { outletCode: outlet.code, mustChangePassword: true, syncStatus: result.syncStatus }
  });

  return res.status(result.httpStatus).json(result);
});

// 5. Disable / Enable Outlet User Across Central & Outlet
app.post('/api/outlet-users/:userId/status', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const targetUserId = String(req.params.userId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return res.status(400).json({ success: false, message: 'Valid Central Auth UUID is required.' });
  }

  const { isActive, email, outletCode, idempotencyKey } = req.body || {};
  const scope = resolveScopedOutletForCaller(session, outletCode);
  if (!scope.allowed) {
    return res.status(403).json({ success: false, message: scope.error });
  }

  const outlet = await resolveOutletTargetDescriptor(scope.outletCode, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Outlet "${scope.outletCode}" not found.` });
  }

  const result = await outletSyncCoordinator.dispatchSync({
    idempotencyKey,
    syncOrigin: 'smav_portal',
    action: 'set_status',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    payload: {
      userId: targetUserId,
      ...(email ? { email: String(email).trim().toLowerCase() } : {}),
      isActive: Boolean(isActive)
    }
  });

  return res.status(result.httpStatus).json(result);
});

// 6. Sync Outbox Inspection & Manual Retry Endpoints
app.get('/api/sync/outbox', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  const requestedOutlet = typeof req.query.outletCode === 'string' && req.query.outletCode !== 'all'
    ? req.query.outletCode.trim().toLowerCase()
    : undefined;

  const allowedCodes = session.role === 'superadmin'
    ? undefined
    : Array.from(new Set([
        session.activeOutlet?.code?.toLowerCase(),
        ...(session.assignedOutlets || []).map(o => o.outletCode.toLowerCase())
      ].filter(Boolean) as string[]));

  if (requestedOutlet && allowedCodes && !allowedCodes.includes(requestedOutlet)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Access restricted to assigned outlets.', items: [] });
  }

  const items = await outletSyncCoordinator.listOutbox({
    outletCode: requestedOutlet,
    allowedOutletCodes: allowedCodes,
    callerSupabaseJwt: session.supabaseToken,
    limit: 100
  });

  res.json({ success: true, items });
});

app.post('/api/sync/outbox/:id/retry', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  const all = await outletSyncCoordinator.listOutbox({
    allowedOutletCodes: session.role === 'superadmin'
      ? undefined
      : (session.assignedOutlets || []).map(o => o.outletCode.toLowerCase()),
    callerSupabaseJwt: session.supabaseToken,
    limit: 100
  });
  const target = all.find(i => i.id === req.params.id);
  if (!target) {
    return res.status(404).json({ success: false, message: 'Outbox item not found or not accessible.' });
  }

  const retryRes = await outletSyncCoordinator.retryOutboxItem(req.params.id);
  return res.status(retryRes.success ? 200 : 400).json(retryRes);
});

// 7. Generic Bidirectional Outlet -> SMAV User Sync API (Works for Glossy Looks, MOZZ, and any future outlet)
async function handleOutletIncomingUserSync(req: express.Request, res: express.Response, forcedOutletCode?: string) {
  const cleanOutletCode = String(forcedOutletCode || req.params.outletCode || req.body?.outletCode || '').trim().toLowerCase();
  if (!cleanOutletCode) {
    return res.status(400).json({ success: false, message: 'outletCode is required.' });
  }

  const rawOrigin = String(req.headers['x-smav-sync-origin'] || req.body?.syncOrigin || 'outlet_admin').trim().toLowerCase();
  if (rawOrigin === 'smav_portal') {
    return res.json({
      success: true,
      skipped: true,
      message: 'Loop prevention: skipped echo of smav_portal event.'
    });
  }

  const providedKey = String(req.headers['x-integration-key'] || req.headers['x-smav-gateway-secret'] || '').trim();
  const bearerToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : '';
  const configuredKey = outletSyncCoordinator.getOutletIntegrationKey(cleanOutletCode);

  let centralAuthToken = '';
  let isBusinessKey = false;
  let actorUserId: string | undefined;

  if (providedKey && configuredKey && providedKey === configuredKey) {
    centralAuthToken = configuredKey;
    isBusinessKey = true;
  } else if (bearerToken) {
    if (bearerToken.startsWith('smav_jwt')) {
      const sess = await smavGateway.validateSession(bearerToken);
      if (!sess || (sess.role !== 'superadmin' && sess.role !== 'admin')) {
        return res.status(403).json({ success: false, message: 'Forbidden: SUPERADMIN or assigned outlet ADMIN required.' });
      }
      if (sess.role !== 'superadmin') {
        const hasAccess =
          sess.activeOutlet?.code?.toLowerCase() === cleanOutletCode ||
          (sess.assignedOutlets || []).some(o => o.outletCode.toLowerCase() === cleanOutletCode && o.role === 'admin');
        if (!hasAccess) {
          return res.status(403).json({ success: false, message: `Forbidden: Not authorized for outlet "${cleanOutletCode}".` });
        }
      }
      centralAuthToken = sess.supabaseToken || '';
      actorUserId = sess.userId;
    } else {
      centralAuthToken = bearerToken;
    }
  }

  if (!centralAuthToken) {
    return res.status(401).json({
      success: false,
      message: `Unauthorized: Valid X-Integration-Key for "${cleanOutletCode}" or Admin JWT is required.`
    });
  }

  const outlet = await resolveOutletTargetDescriptor(cleanOutletCode, isBusinessKey ? undefined : centralAuthToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Outlet "${cleanOutletCode}" is not registered in SMAV.` });
  }

  const rawAction = String(req.body?.action || 'upsert_user').trim().toLowerCase();
  const mappedAction: 'upsert_user' | 'update_user' | 'reset_password' | 'set_status' =
    rawAction.includes('reset') ? 'reset_password'
      : rawAction.includes('status') || rawAction.includes('deactivat') ? 'set_status'
      : rawAction.includes('update') ? 'update_user'
      : 'upsert_user';

  const idempotencyKey = String(req.headers['x-idempotency-key'] || req.body?.idempotencyKey || '').trim() || undefined;
  const rawRole = String(req.body?.role || 'STAFF').trim().toUpperCase();
  const normalizedRole: 'ADMIN' | 'STAFF' = ['ADMIN', 'OWNER', 'MANAGER'].includes(rawRole) ? 'ADMIN' : 'STAFF';

  const result = await outletSyncCoordinator.dispatchSync({
    idempotencyKey,
    syncOrigin: 'outlet_admin',
    action: mappedAction,
    outlet,
    actorUserId,
    centralAuthToken,
    isBusinessKey,
    transientPassword: req.body?.newPassword || req.body?.initialPassword,
    payload: {
      userId: req.body?.userId,
      externalStaffId: req.body?.externalStaffId || req.body?.staffId || req.body?.id,
      fullName: req.body?.fullName || req.body?.name,
      username: req.body?.username,
      email: req.body?.email,
      phone: req.body?.phone,
      role: normalizedRole,
      isActive: rawAction.includes('deactivat') ? false : req.body?.isActive
    }
  });

  return res.status(result.httpStatus).json(result);
}

app.post('/api/integrations/outlets/:outletCode/users/sync', (req, res) =>
  handleOutletIncomingUserSync(req, res)
);

app.post('/api/integrations/glossylooks/webhook', (req, res) =>
  handleOutletIncomingUserSync(req, res, 'glossylooks')
);

app.post('/api/integrations/mozz/webhook', (req, res) =>
  handleOutletIncomingUserSync(req, res, 'mozz')
);

// -------------------------------------------------------------------------------------------------
// Central SMAV Supabase Project Status & Diagnostic Endpoints (Requirement 1, 12, 13)
// -------------------------------------------------------------------------------------------------
app.get('/api/central-supabase/status', async (_req, res) => {
  const isConfigured = centralSupabaseConfig.isConfigured;
  let connectionTest: any = { tested: false };

  if (isConfigured) {
    const supabase = getCentralSupabaseClient();
    if (supabase) {
      try {
        const [outletsRes, profilesRes, rolesRes, devicesRes, logsRes] = await Promise.allSettled([
          supabase.from('smav_outlets').select('id', { count: 'exact', head: true }),
          supabase.from('smav_profiles').select('id', { count: 'exact', head: true }),
          supabase.from('smav_user_outlet_roles').select('id', { count: 'exact', head: true }),
          supabase.from('smav_devices').select('id', { count: 'exact', head: true }),
          supabase.from('smav_audit_logs').select('id', { count: 'exact', head: true })
        ]);

        connectionTest = {
          tested: true,
          connected: true,
          tables: {
            smav_outlets: outletsRes.status === 'fulfilled' && !outletsRes.value.error,
            smav_profiles: profilesRes.status === 'fulfilled' && !profilesRes.value.error,
            smav_user_outlet_roles: rolesRes.status === 'fulfilled' && !rolesRes.value.error,
            smav_devices: devicesRes.status === 'fulfilled' && !devicesRes.value.error,
            smav_audit_logs: logsRes.status === 'fulfilled' && !logsRes.value.error
          }
        };
      } catch (err: any) {
        connectionTest = {
          tested: true,
          connected: false,
          error: err.message
        };
      }
    }
  }

  res.json({
    success: true,
    isConfigured,
    projectUrl: centralSupabaseConfig.projectUrl,
    hasPublishableKey: Boolean(centralSupabaseConfig.publishableKey),
    publishableKeyPreview: centralSupabaseConfig.publishableKey ? centralSupabaseConfig.publishableKey.substring(0, 10) + '...' : '',
    connectionTest
  });
});

app.post('/api/central-supabase/config', async (req, res) => {
  const { projectUrl, publishableKey } = req.body;
  if (!projectUrl || !publishableKey) {
    return res.status(400).json({ success: false, message: 'projectUrl and publishableKey are required' });
  }

  updateCentralSupabaseConfig(projectUrl, publishableKey);

  // Update .env file if writable
  try {
    const envPath = path.join(process.cwd(), '.env');
    const content = `# Central SMAV Supabase Project Configuration\nSMAV_SUPABASE_URL=${projectUrl.trim()}\nSMAV_SUPABASE_ANON_KEY=${publishableKey.trim()}\nVITE_SMAV_SUPABASE_URL=${projectUrl.trim()}\nVITE_SMAV_SUPABASE_ANON_KEY=${publishableKey.trim()}\n`;
    fs.writeFileSync(envPath, content, 'utf8');
  } catch (_e) {}

  // Test live connection to verify project validity
  const supabase = getCentralSupabaseClient();
  let testResult: any = { connected: false };
  if (supabase) {
    try {
      const { error: profileErr } = await supabase.from('smav_profiles').select('id').limit(1);
      testResult = {
        connected: !profileErr || profileErr.code === 'PGRST116' || profileErr.message.includes('row-level security'),
        error: profileErr ? profileErr.message : null
      };
    } catch (err: any) {
      testResult = { connected: false, error: err.message };
    }
  }

  auditLogger.log({
    eventType: 'CENTRAL_SUPABASE_CONFIGURED',
    details: { projectUrl: projectUrl.trim(), connected: testResult.connected }
  });

  res.json({
    success: true,
    message: 'Central SMAV Supabase configuration updated successfully',
    testResult
  });
});

// -------------------------------------------------------------------------------------------------
// Requirement 13: Verify a real login against the Central SMAV Supabase Project
// -------------------------------------------------------------------------------------------------
app.post('/api/central-supabase/verify-login', async (req, res) => {
  const { email, password, projectUrl, publishableKey } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'email and password are required' });
  }

  if (projectUrl && publishableKey) {
    updateCentralSupabaseConfig(projectUrl, publishableKey);
  }

  if (!centralSupabaseConfig.isConfigured) {
    return res.status(400).json({
      success: false,
      message: 'Central SMAV Supabase project is not configured. Please set SMAV_SUPABASE_URL and SMAV_SUPABASE_ANON_KEY in environment or via setup.'
    });
  }

  const supabase = getCentralSupabaseClient();
  if (!supabase) {
    return res.status(500).json({ success: false, message: 'Could not create Supabase client' });
  }

  const diagnostics: Record<string, any> = {
    step1_auth: null,
    step2_profile: null,
    step3_role_check: null,
    step4_active_check: null,
    step5_redirection: null
  };

  try {
    // 1. Authenticate using Supabase Auth signInWithPassword (Requirement 2)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });

    if (authError || !authData?.user || !authData?.session) {
      diagnostics.step1_auth = {
        status: 'FAILED',
        error: authError?.message || 'Authentication failed'
      };
      return res.status(401).json({
        success: false,
        message: `Supabase Auth failed: ${authError?.message || 'Invalid credentials'}`,
        diagnostics
      });
    }

    diagnostics.step1_auth = {
      status: 'PASSED',
      userId: authData.user.id,
      email: authData.user.email,
      tokenIssued: Boolean(authData.session.access_token)
    };

    // 2. Retrieve authenticated user's profile with their access token (testing RLS: read only their own profile) (Requirement 3 & 6)
    const authedSupabase = getCentralSupabaseClient(authData.session.access_token);
    const { data: profile, error: profileErr } = await authedSupabase!
      .from('smav_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileErr || !profile) {
      diagnostics.step2_profile = {
        status: 'FAILED',
        error: profileErr?.message || 'Record not found in smav_profiles'
      };
      return res.status(404).json({
        success: false,
        message: `Profile record not found in public.smav_profiles for user ID ${authData.user.id}. Error: ${profileErr?.message || 'Record missing'}`,
        diagnostics
      });
    }

    diagnostics.step2_profile = {
      status: 'PASSED',
      profile: {
        id: profile.id,
        email: authData.user.email,
        full_name: profile.full_name,
        platform_role: profile.platform_role,
        is_active: profile.is_active
      }
    };

    // 3. Verify platform_role = SUPERADMIN (Requirement 4)
    const platformRole = (profile.platform_role || profile.role || '').toUpperCase();
    if (platformRole === 'SUPERADMIN') {
      diagnostics.step3_role_check = {
        status: 'PASSED',
        platform_role: platformRole,
        isSuperadmin: true
      };
    } else {
      diagnostics.step3_role_check = {
        status: 'FAILED',
        platform_role: platformRole,
        isSuperadmin: false
      };
      return res.status(403).json({
        success: false,
        message: `User is not a SUPERADMIN. Found platform_role: "${platformRole}"`,
        diagnostics
      });
    }

    // 4. Verify is_active = true (Requirement 4)
    const isActive = profile.is_active === true || profile.isActive === true;
    if (isActive) {
      diagnostics.step4_active_check = {
        status: 'PASSED',
        is_active: true
      };
    } else {
      diagnostics.step4_active_check = {
        status: 'FAILED',
        is_active: false
      };
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated (is_active = false).',
        diagnostics
      });
    }

    // 5. Redirection resolution (Requirement 5)
    diagnostics.step5_redirection = {
      status: 'PASSED',
      redirectTo: '/superadmin/outlets',
      dashboard: 'All Outlets Dashboard'
    };

    // Generate authenticated session
    const authResult = await smavGateway.authenticate({
      emailOrId: email.trim(),
      password,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1'
    });

    res.json({
      success: true,
      message: 'Central SMAV Supabase real Superadmin login verified successfully!',
      diagnostics,
      session: authResult.session,
      redirectTo: '/superadmin/outlets'
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Verification exception: ' + err.message,
      diagnostics
    });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization!.split(' ')[1];
  await smavGateway.revokeSession(token);
  res.json({ success: true, message: 'Session revoked successfully' });
});

app.post('/api/auth/request-password-reset', async (req, res) => {
  const { email, outletCode } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

  const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const result = await smavGateway.requestPasswordReset(email, outletCode, ipAddress);
  res.json(result);
});

app.post('/api/auth/confirm-password-reset', async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword) {
    return res.status(400).json({ success: false, message: 'resetToken and newPassword are required' });
  }

  const result = await smavGateway.confirmPasswordReset(resetToken, newPassword);
  res.json(result);
});

app.post('/api/auth/complete-first-login-password', async (req, res) => {
  const { passwordChangeToken, newPassword, outletCode, device_id } = req.body || {};
  if (!passwordChangeToken || !newPassword) {
    return res.status(400).json({ success: false, message: 'passwordChangeToken and newPassword are required.' });
  }

  const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
  const changeResult = await smavGateway.completeFirstLoginPasswordChange(
    String(passwordChangeToken),
    String(newPassword),
    ipAddress
  );

  if (!changeResult.success || !changeResult.email) {
    return res.status(400).json(changeResult);
  }

  // Immediately sign in with the newly confirmed personal password
  const authResult = await smavGateway.authenticate({
    emailOrId: changeResult.email,
    password: String(newPassword),
    outletCode,
    deviceId: device_id,
    ipAddress
  });

  if (!authResult.success) {
    return res.status(401).json(authResult);
  }

  return res.json(authResult);
});

// Central registry: Supabase is authoritative. Do not silently fall back to demo records.
function centralClientForRequest(req: express.Request) {
  const session: UserSession = (req as any).userSession;
  const client = getCentralSupabaseClient(session?.supabaseToken);
  if (!client || !session?.supabaseToken) throw new Error('Central Supabase session is unavailable; sign in again.');
  return client;
}
function outletFromRow(row: any): Outlet {
  const metadata = row.metadata || {};
  return {
    id: row.id, code: row.outlet_code, name: row.outlet_name,
    category: String(row.business_type).toLowerCase() as BusinessCategory,
    address: metadata.address || '', phone: metadata.phone || '', gstin: metadata.gstin || '',
    receiptHeader: metadata.receiptHeader || row.outlet_name,
    receiptFooter: metadata.receiptFooter || '',
    providerType: metadata.providerType || 'custom_outlet',
    supabaseUrl: metadata.supabaseUrl || undefined,
    syncWebhookUrl: metadata.syncWebhookUrl || undefined,
    isActive: row.is_active, createdAt: row.created_at,
    updatedAt: metadata.updatedAt || row.created_at
  };
}
async function getRegisteredOutlets(req: express.Request): Promise<Outlet[]> {
  const { data, error } = await centralClientForRequest(req).from('smav_outlets').select('*').order('created_at');
  if (error) throw new Error(`Central outlet registry unavailable: ${error.message}`);
  return (data || []).map(outletFromRow);
}
async function getRegisteredOutlet(req: express.Request, id: string): Promise<Outlet | null> {
  const { data, error } = await centralClientForRequest(req).from('smav_outlets').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Central outlet lookup failed: ${error.message}`);
  return data ? outletFromRow(data) : null;
}
function outletMetadata(body: any) {
  // Only store public business metadata. Never accept secrets or service-role keys.
  const { address, phone, gstin, receiptHeader, receiptFooter, providerType, supabaseUrl, syncWebhookUrl } = body;
  return { address: address || '', phone: phone || '', gstin: gstin || '',
    receiptHeader: receiptHeader || '', receiptFooter: receiptFooter || '',
    providerType: providerType || 'custom_outlet', supabaseUrl: supabaseUrl || '',
    syncWebhookUrl: syncWebhookUrl || '',
    updatedAt: new Date().toISOString() };
}

// -------------------------------------------------------------------------------------------------
// 2. Superadmin Dashboard Endpoints
// -------------------------------------------------------------------------------------------------
// Phase 2 additive, read-only registry endpoints. Existing POS and integrations are untouched.
app.get('/api/pos/templates', requireAuth, async (req, res) => {
  try {
    const templates = await listPosTemplates(centralClientForRequest(req));
    res.json({ success: true, templates });
  } catch (error: any) {
    res.status(503).json({ success: false, message: error.message });
  }
});

// Phase 2: SUPERADMIN-only read-only comparison of live POS cache vs central catalog.
// This does not import, delete, or change billing/catalog data.
// Phase 2 generic catalog source registry: legacy adapters are registered once.
registerCatalogSource('glossylooks', glossyLooksSource);
registerCatalogSource('mozz', async () => ({
  source: 'mozz-pos-cache', fresh: false,
  items: restaurantMenu.map(m => ({ external_item_id: String(m.id), item_type: 'menu_item' as const,
    name: m.name, category: m.category, subcategory: '', price: m.basePrice,
    is_active: m.isAvailable, is_deleted: m.isDeleted, is_veg: m.isVeg, variants: m.variants }))
}));

// Read-only generic preflight for any outlet with a registered source adapter.
app.get('/api/superadmin/outlets/:id/catalog-import-preview', requireAuth, requireSuperadmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) return res.status(401).json({ success: false, message: 'Central session required' });
  try {
    const db = centralClientForRequest(req);
    const config = await loadOutletRuntimeConfig(db, req.params.id);
    const source = await resolveCatalogSource(config);
    const comparison = await previewCatalogImport(db, config.outletId, source.items);
    res.json({ success: true, outletCode: config.outletCode, source: source.source,
      freshSource: source.fresh, comparison, writePerformed: false });
  } catch (error: any) {
    console.warn('[Catalog preflight]', error?.message || 'unknown');
    res.status(503).json({ success: false, message: 'Catalog source or comparison unavailable' });
  }
});

// Generic import route; rollout allowlist deliberately limits writes to the approved pilot.
app.post('/api/superadmin/outlets/:id/catalog-import', requireAuth, requireSuperadmin, async (req, res) => {
  // Package A: imports are retired; the business source remains authoritative.
  return res.status(410).json({ success: false, message: 'Central catalog import disabled: use outlet source catalog' });
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) return res.status(401).json({ success: false, message: 'Central session required' });
  if (req.body?.confirmation !== 'IMPORT_INITIAL_CATALOG' || !Number.isSafeInteger(req.body?.expectedSourceCount)) {
    return res.status(400).json({ success: false, message: 'Explicit confirmation and expectedSourceCount required' });
  }
  try {
    const db = centralClientForRequest(req);
    const config = await loadOutletRuntimeConfig(db, req.params.id);
    // This restriction must be expanded only after a source adapter and import permissions are verified.
    if (config.outletCode !== 'glossylooks') return res.status(403).json({ success: false, message: 'Initial import not enabled for this outlet' });
    const source = await resolveCatalogSource(config);
    if (!source.fresh) return res.status(409).json({ success: false, message: 'Fresh source required for import' });
    if (source.items.length !== req.body.expectedSourceCount) return res.status(409).json({ success: false, message: 'Source count changed; rerun preflight' });
    const result = await importMissingCatalogItems(db, config.outletId, source.items, req.body.expectedSourceCount);
    res.status(result.failed ? 207 : 200).json({ success: result.failed === 0, result });
  } catch (error: any) {
    console.warn('[Catalog import]', error?.message || 'unknown');
    res.status(503).json({ success: false, message: 'Catalog import unavailable; check partial results before retrying' });
  }
});

// Backwards-compatible pilot endpoint. Existing clients may continue to use it.
app.post('/api/superadmin/outlets/:id/catalog-import-glossylooks', requireAuth, requireSuperadmin, async (req, res) => {
  // Package A: imports are retired; the business source remains authoritative.
  return res.status(410).json({ success: false, message: 'Central catalog import disabled: use outlet source catalog' });
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) return res.status(401).json({ success: false, message: 'Central session required' });
  if (req.body?.confirmation !== 'IMPORT_GLOSSYLOOKS_INITIAL_CATALOG' || !Number.isSafeInteger(req.body?.expectedSourceCount)) {
    return res.status(400).json({ success: false, message: 'Explicit confirmation and expectedSourceCount required' });
  }
  try {
    const db = centralClientForRequest(req);
    const config = await loadOutletRuntimeConfig(db, req.params.id);
    if (config.outletCode !== 'glossylooks') return res.status(403).json({ success: false, message: 'Only Glossy Looks approved' });
    const source = await resolveCatalogSource(config);
    if (!source.fresh || source.items.length !== req.body.expectedSourceCount) return res.status(409).json({ success: false, message: 'Source count changed; rerun preflight' });
    const result = await importMissingCatalogItems(db, config.outletId, source.items, req.body.expectedSourceCount);
    res.status(result.failed ? 207 : 200).json({ success: result.failed === 0, result });
  } catch (error: any) {
    console.warn('[Glossy Looks import]', error?.message || 'unknown');
    res.status(503).json({ success: false, message: 'Catalog import unavailable; check partial results before retrying' });
  }
});

// Package A: lightweight outlet-only catalog. No central catalog copy or import.
// The authenticated outlet UUID is checked before reading a source adapter.
app.get('/api/pos/outlets/:id/source-catalog', requireAuth, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  const outletId = req.params.id;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Central session required' });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId)) {
    return res.status(400).json({ success: false, message: 'Invalid outlet ID' });
  }
  // Staff can only read the active outlet; admins can read assigned outlets.
  const allowed = session.role === 'superadmin' || session.activeOutlet?.id === outletId ||
    (session.role === 'admin' && (session.assignedOutlets || []).some(o => o.outletId === outletId && o.role === 'admin'));
  if (!allowed) return res.status(403).json({ success: false, message: 'Outlet access denied' });
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return res.status(400).json({ success: false, message: 'Invalid pagination' });
  }
  try {
    const config = await loadOutletRuntimeConfig(centralClientForRequest(req), outletId);
    // Adapter registry is explicit; no arbitrary URL supplied by a client is fetched.
    const source = await resolveCatalogSource(config);
    const items = source.items.filter(item => item.is_active !== false && item.is_deleted !== true);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ success: true, outletId: config.outletId, outletCode: config.outletCode,
      source: source.source, fresh: source.fresh, total: items.length,
      items: items.slice(offset, offset + limit),
      nextOffset: offset + limit < items.length ? offset + limit : null,
      fetchedAt: new Date().toISOString() });
  } catch (error: any) {
    console.warn('[Outlet source catalog]', error?.message || 'unknown');
    return res.status(503).json({ success: false, message: 'Outlet catalog source unavailable' });
  }
});

// Phase 2: read-only, tenant-scoped central catalog adapter. No legacy POS route changes.
app.get('/api/pos/outlets/:id/catalog-preview', requireAuth, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Central Supabase session required' });
  }
  const outletId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId)) {
    return res.status(400).json({ success: false, message: 'Invalid outlet ID' });
  }
  try {
    const db = centralClientForRequest(req);
    const config = await loadOutletRuntimeConfig(db, outletId);
    const allowed = session.role === 'superadmin' ||
      (session.activeOutlet?.id === outletId) ||
      (session.assignedOutlets || []).some(o => o.outletId === outletId);
    if (!allowed) return res.status(403).json({ success: false, message: 'Outlet access denied' });
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
      return res.status(400).json({ success: false, message: 'Invalid pagination' });
    }
    const page = await loadCentralOutletCatalog(db, config.outletId, limit, offset);
    res.json({ success: true, catalog: page });
  } catch (error: any) {
    // Do not expose internal DB errors or connection information.
    console.warn('[Catalog preview] Failed:', error?.message || 'unknown');
    res.status(503).json({ success: false, message: 'Catalog preview unavailable or not configured' });
  }
});

// Phase 2: incremental catalog feed. Read-only and outlet-scoped; includes inactive/deleted rows.
app.get('/api/pos/outlets/:id/catalog-changes', requireAuth, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Central Supabase session required' });
  }
  const outletId = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(outletId)) {
    return res.status(400).json({ success: false, message: 'Invalid outlet ID' });
  }
  const allowed = session.role === 'superadmin' ||
    session.activeOutlet?.id === outletId ||
    (session.assignedOutlets || []).some(o => o.outletId === outletId);
  if (!allowed) return res.status(403).json({ success: false, message: 'Outlet access denied' });
  const sinceRevision = req.query.sinceRevision === undefined ? 0 : Number(req.query.sinceRevision);
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isSafeInteger(sinceRevision) || sinceRevision < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return res.status(400).json({ success: false, message: 'Invalid catalog change pagination' });
  }
  try {
    const changes = await loadCentralCatalogChanges(centralClientForRequest(req), outletId, sinceRevision, limit, offset);
    res.json({ success: true, catalog: changes });
  } catch (error: any) {
    console.warn('[Catalog changes] Failed:', error?.message || 'unknown');
    res.status(503).json({ success: false, message: 'Catalog changes unavailable or not configured' });
  }
});

app.get('/api/superadmin/outlets/:id/runtime-config', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const config = await loadOutletRuntimeConfig(centralClientForRequest(req), req.params.id);
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(404).json({ success: false, message: error.message });
  }
});

app.get('/api/superadmin/outlets', requireAuth, requireSuperadmin, async (req, res) => {
  try { res.json({ success: true, outlets: await getRegisteredOutlets(req) }); }
  catch (e: any) { res.status(503).json({ success: false, message: e.message }); }
});

app.post('/api/superadmin/outlets', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const { name, code, category } = req.body;
    if (!name?.trim() || !code?.trim() || !['salon','restaurant','retail','other'].includes(category))
      return res.status(400).json({ success: false, message: 'Valid name, outlet code and category required' });
    const { data, error } = await centralClientForRequest(req).from('smav_outlets').insert({
      outlet_name: name.trim(), outlet_code: code.trim().toLowerCase(),
      business_name: name.trim(), business_type: category.toUpperCase(),
      is_active: true, metadata: outletMetadata(req.body)
    }).select('*').single();
    if (error) throw error;
    res.json({ success: true, outlet: outletFromRow(data) });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
});

app.put('/api/superadmin/outlets/:id', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    const existing = await getRegisteredOutlet(req, req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Outlet not found' });
    const { name, code, category } = req.body;
    if (category && !['salon','restaurant','retail','other'].includes(category))
      return res.status(400).json({ success: false, message: 'Invalid category' });
    const merged = { ...existing, ...req.body };
    const { data, error } = await centralClientForRequest(req).from('smav_outlets').update({
      outlet_name: name || existing.name, outlet_code: code || existing.code,
      business_name: name || existing.name,
      business_type: (category || existing.category).toUpperCase(),
      metadata: outletMetadata(merged)
    }).eq('id', req.params.id).select('*').single();
    if (error) throw error;
    res.json({ success: true, outlet: outletFromRow(data) });
  } catch (e: any) { res.status(400).json({ success: false, message: e.message }); }
});

app.post('/api/superadmin/outlets/:id/status', requireAuth, requireSuperadmin, async (req, res) => {
  try {
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ success: false, message: 'isActive must be boolean' });
    const { data, error } = await centralClientForRequest(req).from('smav_outlets')
      .update({ is_active: req.body.isActive }).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Outlet not found' });
    res.json({ success: true });
  } catch (e: any) { res.status(503).json({ success: false, message: e.message }); }
});

app.get('/api/superadmin/admins', requireAuth, requireSuperadmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase SUPERADMIN session required.', admins: [] });
  }

  const enriched = await fetchEnrichedCentralStaff(session.supabaseToken);
  if (!enriched.success) {
    return res.status(enriched.status || 403).json({
      success: false,
      message: enriched.error || 'Failed to fetch outlet administrators',
      admins: []
    });
  }

  const admins = enriched.staff
    .filter((u: any) => u.outletRole === 'ADMIN' || u.outlets?.some((o: any) => o.role === 'ADMIN'))
    .map((u: any) => ({
      ...u,
      id: u.userId,
      role: 'admin',
      displayRole: 'ADMIN',
      memberships: (u.outlets || []).filter((o: any) => o.role === 'ADMIN')
    }));

  return res.json({ success: true, admins });
});

app.post('/api/superadmin/admins', requireAuth, requireSuperadmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase SUPERADMIN session required.' });
  }

  const { email, fullName, phone, outletId, outletCode, username, initialPassword } = req.body || {};
  const targetOutletCode = String(outletCode || outletId || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !targetOutletCode) {
    return res.status(400).json({ success: false, message: 'email and outletId/outletCode are required' });
  }
  if (!initialPassword || String(initialPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Initial temporary password (min. 8 characters) is required.' });
  }

  const emailCheck = assessEmailQuality(cleanEmail);
  if (emailCheck.status !== 'valid') {
    return res.status(400).json({
      success: false,
      message: `A valid email address is required (${emailCheck.reason || 'invalid'}).`
    });
  }

  const outlet = await resolveOutletTargetDescriptor(targetOutletCode, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Outlet "${targetOutletCode}" not found.` });
  }

  const syncRes = await outletSyncCoordinator.dispatchSync({
    syncOrigin: 'smav_portal',
    action: 'upsert_user',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    transientPassword: String(initialPassword),
    payload: {
      email: cleanEmail,
      fullName: String(fullName || '').trim() || cleanEmail.split('@')[0],
      username: username ? String(username).trim().toLowerCase() : cleanEmail.split('@')[0],
      phone: phone ? String(phone).trim() : '',
      role: 'ADMIN',
      isActive: true
    }
  });

  return res.status(syncRes.httpStatus).json({
    success: syncRes.success,
    userId: syncRes.userId,
    isNewUser: Boolean(syncRes.isNewUser),
    mustChangePassword: syncRes.mustChangePassword,
    syncStatus: syncRes.syncStatus,
    message: syncRes.message
  });
});

app.post('/api/superadmin/admins/:id/reset-password', requireAuth, requireSuperadmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase SUPERADMIN session required.' });
  }

  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(String(id || '').trim())) {
    return res.status(400).json({ success: false, message: 'Valid Central Auth UUID is required.' });
  }

  const { email, outletCode, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Temporary password must be at least 8 characters.' });
  }

  const targetCode = String(outletCode || session.activeOutlet?.code || 'glossylooks').trim().toLowerCase();
  const outlet = await resolveOutletTargetDescriptor(targetCode, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: `Outlet "${targetCode}" not found.` });
  }

  const syncRes = await outletSyncCoordinator.dispatchSync({
    syncOrigin: 'smav_portal',
    action: 'reset_password',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    transientPassword: String(newPassword),
    payload: {
      userId: id,
      ...(email ? { email: String(email).trim().toLowerCase() } : {}),
      mustChangePassword: true
    }
  });

  return res.status(syncRes.httpStatus).json(syncRes);
});

app.get('/api/superadmin/reports', requireAuth, requireSuperadmin, async (req, res) => {
  const outlets = await getRegisteredOutlets(req);
  const salonBills = syncedBills;
  const restOrders = syncedOrders;

  const totalSalonRevenue = salonBills.reduce((acc, b) => acc + (b.grand_total || 0), 0);
  const totalRestRevenue = restOrders.reduce((acc, o) => acc + (o.grand_total || 0), 0);

  res.json({
    success: true,
    summary: {
      totalOutlets: outlets.length,
      activeOutlets: outlets.filter(o => o.isActive).length,
      totalRevenue: totalSalonRevenue + totalRestRevenue,
      totalTransactions: salonBills.length + restOrders.length,
      pairedDevicesCount: pairedDevices.length
    },
    outletsBreakdown: outlets.map(o => {
      let revenue = 0;
      let count = 0;
      if (o.category === 'salon') {
        revenue = totalSalonRevenue;
        count = salonBills.length;
      } else if (o.category === 'restaurant') {
        revenue = totalRestRevenue;
        count = restOrders.length;
      }
      return {
        id: o.id,
        name: o.name,
        code: o.code,
        category: o.category,
        isActive: o.isActive,
        revenue,
        transactionCount: count,
        supabaseConnected: Boolean(o.supabaseUrl)
      };
    })
  });
});

app.post('/api/superadmin/launch-pos', requireAuth, requireSuperadmin, async (req, res) => {
  const { outletId } = req.body;
  const outlet = await getRegisteredOutlet(req, outletId);
  if (!outlet) return res.status(404).json({ success: false, message: 'Outlet not found' });

  const superadminSession: UserSession = (req as any).userSession;
  const temporarySession: UserSession = {
    token: superadminSession.token,
    userId: superadminSession.userId,
    email: superadminSession.email,
    fullName: `${superadminSession.fullName} (Auditor)`,
    role: 'superadmin',
    activeOutlet: outlet,
    specificTitle: 'Superadmin Auditor',
    permissions: ['*'],
    deviceId: 'SMAV-SUPERADMIN-CONSOLE',
    createdAt: new Date().toISOString(),
    expiresAt: superadminSession.expiresAt,
    supabaseToken: superadminSession.supabaseToken,
    platformRole: superadminSession.platformRole
  };

  await smavGateway.switchOutlet(superadminSession.token, outlet);

  auditLogger.log({
    eventType: 'SUPERADMIN_LAUNCHED_OUTLET_POS',
    actorId: superadminSession.userId,
    outletId: outlet.id,
    details: { outletName: outlet.name }
  });

  res.json({ success: true, session: temporarySession });
});

app.get('/api/superadmin/audit-logs', requireAuth, requireSuperadmin, (req, res) => {
  const logs = auditLogger.getRecentLogs(100);
  res.json({ success: true, logs });
});

// -------------------------------------------------------------------------------------------------
// 3. Outlet Admin Dashboard Endpoints
// -------------------------------------------------------------------------------------------------
app.get('/api/admin/outlet-details', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (session.supabaseToken && centralSupabaseConfig.isConfigured) {
    try {
      const outlet = await getRegisteredOutlet(req, session.activeOutlet.id);
      if (outlet) return res.json({ success: true, outlet });
    } catch (_e) {}
  }
  res.json({ success: true, outlet: session.activeOutlet });
});

app.get('/api/admin/staff', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.', staff: [] });
  }

  const enriched = await fetchEnrichedCentralStaff(session.supabaseToken, session.activeOutlet.code);
  if (!enriched.success) {
    return res.status(enriched.status || 403).json({
      success: false,
      message: enriched.error || 'Unable to list outlet users',
      staff: []
    });
  }

  return res.json({
    success: true,
    staff: enriched.staff
  });
});

app.post('/api/admin/staff', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const { email, fullName, phone, role, username, initialPassword } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(fullName || '').trim();

  if (!cleanEmail || !cleanName) {
    return res.status(400).json({ success: false, message: 'email and fullName are required' });
  }
  if (!initialPassword || String(initialPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Initial temporary password (min. 8 characters) is required.' });
  }

  const emailCheck = assessEmailQuality(cleanEmail);
  if (emailCheck.status !== 'valid') {
    return res.status(400).json({
      success: false,
      message: `Please provide a valid email address (${emailCheck.reason || 'invalid'}).`
    });
  }

  const requestedRole = String(role || 'staff').toLowerCase();
  if (requestedRole === 'admin' && session.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Only SUPERADMIN can grant ADMIN roles.' });
  }

  const outlet = await resolveOutletTargetDescriptor(session.activeOutlet.code, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: 'Active outlet not found in registry.' });
  }

  const syncRes = await outletSyncCoordinator.dispatchSync({
    syncOrigin: 'smav_portal',
    action: 'upsert_user',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    transientPassword: String(initialPassword),
    payload: {
      email: cleanEmail,
      fullName: cleanName,
      username: username ? String(username).trim().toLowerCase() : cleanEmail.split('@')[0],
      phone: phone ? String(phone).trim() : '',
      role: requestedRole === 'admin' && session.role === 'superadmin' ? 'ADMIN' : 'STAFF',
      isActive: true
    }
  });

  return res.status(syncRes.httpStatus).json(syncRes);
});

app.post('/api/admin/staff/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(String(id || '').trim())) {
    return res.status(400).json({ success: false, message: 'Valid Central Auth UUID is required.' });
  }

  const outlet = await resolveOutletTargetDescriptor(session.activeOutlet.code, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: 'Active outlet not found.' });
  }

  const syncRes = await outletSyncCoordinator.dispatchSync({
    syncOrigin: 'smav_portal',
    action: 'set_status',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    payload: {
      userId: id,
      isActive: Boolean(req.body?.isActive)
    }
  });
  return res.status(syncRes.httpStatus).json(syncRes);
});

app.delete('/api/admin/staff/:id', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const { id } = req.params;
  const email = (req.body?.email || req.query.email) as string | undefined;
  const edgeRes = await invokeEdgeAdminFunction(
    'remove-staff',
    { userId: id, email, outletCode: session.activeOutlet.code },
    session.supabaseToken
  );
  return res.status(edgeRes.success ? 200 : (edgeRes.status || 403)).json(edgeRes);
});

app.post('/api/admin/staff/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (!session.supabaseToken || !centralSupabaseConfig.isConfigured) {
    return res.status(401).json({ success: false, message: 'Authenticated Central Supabase session required.' });
  }

  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(String(id || '').trim())) {
    return res.status(400).json({ success: false, message: 'Valid Central Auth UUID is required.' });
  }

  const { email, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Temporary password (min. 8 characters) is required.' });
  }

  const outlet = await resolveOutletTargetDescriptor(session.activeOutlet.code, session.supabaseToken);
  if (!outlet) {
    return res.status(404).json({ success: false, message: 'Active outlet not found.' });
  }

  const syncRes = await outletSyncCoordinator.dispatchSync({
    syncOrigin: 'smav_portal',
    action: 'reset_password',
    outlet,
    actorUserId: session.userId,
    centralAuthToken: session.supabaseToken,
    transientPassword: String(newPassword),
    payload: {
      userId: id,
      ...(email ? { email: String(email).trim().toLowerCase() } : {}),
      mustChangePassword: true
    }
  });
  return res.status(syncRes.httpStatus).json(syncRes);
});

app.get('/api/admin/reports', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  const outletId = session.activeOutlet.id;
  const category = session.activeOutlet.category;

  if (category === 'salon') {
    let bills = syncedBills.filter(b => b.outlet_id === outletId);
    if (session.supabaseToken && centralSupabaseConfig.isConfigured) {
      try {
        const db = getCentralSupabaseClient(session.supabaseToken);
        if (db) {
          const { data: dbBills, error } = await db
            .from('smav_salon_bills')
            .select('*')
            .eq('outlet_id', outletId)
            .order('created_at', { ascending: false })
            .limit(50);
          if (!error && Array.isArray(dbBills)) {
            bills = dbBills;
          }
        }
      } catch (_e) {}
    }
    const totalSales = bills.reduce((acc, b) => acc + (Number(b.grand_total) || 0), 0);
    const totalTax = bills.reduce((acc, b) => acc + (Number(b.total_tax) || 0), 0);
    res.json({
      success: true,
      outletName: session.activeOutlet.name,
      totalSales,
      totalTax,
      totalTransactions: bills.length,
      recentBills: bills.slice(0, 20)
    });
  } else if (category === 'restaurant') {
    const orders = syncedOrders.filter(o => o.outlet_id === outletId);
    const totalSales = orders.reduce((acc, o) => acc + (o.grand_total || 0), 0);
    const totalTax = orders.reduce((acc, o) => acc + (o.total_tax || 0), 0);
    res.json({
      success: true,
      outletName: session.activeOutlet.name,
      totalSales,
      totalTax,
      totalTransactions: orders.length,
      recentOrders: orders.slice(0, 20)
    });
  } else {
    res.json({
      success: true,
      outletName: session.activeOutlet.name,
      totalSales: 0,
      totalTax: 0,
      totalTransactions: 0,
      recentBills: []
    });
  }
});

// -------------------------------------------------------------------------------------------------
// 4. POS Catalog & Synchronization APIs
// -------------------------------------------------------------------------------------------------
app.get('/api/pos/init', requireAuth, async (req, res) => {
  if (!salonServices.length || !restaurantMenu.length) await syncLiveSupabaseCatalogs();
  const session: UserSession = (req as any).userSession;
  const outlet = session.activeOutlet;
  if (session.role === 'superadmin') {
    try {
      const registered = await getRegisteredOutlet(req, outlet.id);
      if (!registered || !registered.isActive) return res.status(403).json({ success: false, message: 'Outlet is not registered or active' });
    } catch (e: any) { return res.status(503).json({ success: false, message: e.message }); }
  }

  if (outlet.category === 'salon') {
    const activeServices = salonServices.filter(s => !s.isDeleted && s.isActive);
    res.json({
      success: true,
      outlet,
      category: 'salon',
      revision: salonCatalogRevision,
      services: activeServices,
      stylists: stylists.filter(st => st.isAvailable && (!st.branchId || st.branchId === outlet.id || st.branchId === outlet.code)),
      stylistError: stylists.length ? null : 'No active staff returned by the upstream Glossy Looks API. Verify /api/staff and access permissions.',
      appointments: salonAppointments
    });
  } else if (outlet.category === 'restaurant') {
    const activeMenu = restaurantMenu.filter(m => !m.isDeleted && m.isAvailable);
    res.json({
      success: true,
      outlet,
      category: 'restaurant',
      revision: restaurantCatalogRevision,
      menu: activeMenu,
      tables: restaurantTables,
      pendingOrders: pendingRestaurantOrders
    });
  } else {
    const catalog = await retailCatalogRepo.getCatalog(outlet.id);
    res.json({
      success: true,
      outlet,
      category: 'retail',
      revision: catalog.currentRevision,
      products: catalog.items
    });
  }
});

app.get('/api/catalog/sync', (req, res) => {
  const businessId = (req.query.business_id as string) || (req.query.outlet_id as string) || 'the_glossy_looks';
  const sinceRevision = parseInt((req.query.since_revision as string) || '0', 10);

  if (businessId.includes('glossy') || businessId === 'the_glossy_looks') {
    const currentRevision = salonCatalogRevision;
    const changes = sinceRevision === 0
      ? salonServices.filter(s => !s.isDeleted && s.isActive)
      : salonServices.filter(s => s.revision > sinceRevision);

    return res.json({
      success: true,
      business_id: businessId,
      current_revision: currentRevision,
      since_revision: sinceRevision,
      is_delta: sinceRevision > 0,
      changes,
      total_active_items: salonServices.filter(s => !s.isDeleted && s.isActive).length,
      last_updated: salonCatalogLastUpdated,
      server_timestamp: Date.now()
    });
  } else if (businessId.includes('mozz') || businessId === 'mozz_starters4u') {
    const currentRevision = restaurantCatalogRevision;
    const changes = sinceRevision === 0
      ? restaurantMenu.filter(m => !m.isDeleted && m.isAvailable)
      : restaurantMenu.filter(m => m.revision > sinceRevision);

    return res.json({
      success: true,
      business_id: businessId,
      current_revision: currentRevision,
      since_revision: sinceRevision,
      is_delta: sinceRevision > 0,
      changes,
      total_active_items: restaurantMenu.filter(m => !m.isDeleted && m.isAvailable).length,
      last_updated: restaurantCatalogLastUpdated,
      server_timestamp: Date.now()
    });
  }

  retailCatalogRepo.getCatalog(businessId, sinceRevision).then(c => {
    res.json({
      success: true,
      business_id: businessId,
      current_revision: c.currentRevision,
      since_revision: sinceRevision,
      is_delta: c.isDelta,
      changes: c.items,
      server_timestamp: Date.now()
    });
  });
});

app.post('/api/admin/catalog/service', requireAuth, requireAdmin, (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (session.role !== 'superadmin' && session.activeOutlet.category !== 'salon') {
    return res.status(403).json({ success: false, message: 'Forbidden: Salon catalog management is restricted to assigned salon outlets.' });
  }
  const payload = req.body.service || req.body;
  const { id, name, category, subcategory, price, gstPercent, isDiscountEligible, isActive } = payload;

  salonCatalogRevision += 1;
  salonCatalogLastUpdated = new Date().toISOString();

  let service = salonServices.find(s => s.id === id);
  let action = 'UPDATED';

  if (service) {
    service.name = name || service.name;
    service.category = category || service.category;
    service.subcategory = subcategory || service.subcategory;
    service.price = parseFloat(price);
    service.gstPercent = gstPercent !== undefined ? parseFloat(gstPercent) : service.gstPercent;
    service.isDiscountEligible = isDiscountEligible !== undefined ? isDiscountEligible : service.isDiscountEligible;
    service.isActive = isActive !== undefined ? isActive : service.isActive;
    service.revision = salonCatalogRevision;
    service.updatedAt = salonCatalogLastUpdated;
  } else {
    action = 'CREATED';
    service = {
      id: id || 'srv_' + Math.random().toString(36).substring(2, 7),
      businessId: 'the_glossy_looks',
      name,
      category: category || 'General',
      subcategory: subcategory || '',
      price: parseFloat(price),
      gstPercent: gstPercent !== undefined ? parseFloat(gstPercent) : 18.0,
      durationMinutes: 30,
      isDiscountEligible: isDiscountEligible !== undefined ? isDiscountEligible : true,
      isActive: isActive !== undefined ? isActive : true,
      isDeleted: false,
      revision: salonCatalogRevision,
      updatedAt: salonCatalogLastUpdated
    };
    salonServices.push(service);
  }

  broadcastCatalogUpdate('outlet_glossy_gach', {
    type: 'CATALOG_REVISION_UPDATED',
    business_id: 'the_glossy_looks',
    current_revision: salonCatalogRevision,
    action,
    item_id: service.id,
    item_name: service.name,
    new_price: service.price,
    timestamp: Date.now()
  });

  res.json({ success: true, revision: salonCatalogRevision, service });
});

app.post('/api/admin/catalog/menu-item', requireAuth, requireAdmin, (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (session.role !== 'superadmin' && session.activeOutlet.category !== 'restaurant') {
    return res.status(403).json({ success: false, message: 'Forbidden: Restaurant menu management is restricted to assigned restaurant outlets.' });
  }
  const payload = req.body.item || req.body;
  const { id, name, category, basePrice, isVeg, variants, isAvailable } = payload;

  restaurantCatalogRevision += 1;
  restaurantCatalogLastUpdated = new Date().toISOString();

  let item = restaurantMenu.find(m => m.id === id);
  let action = 'UPDATED';

  if (item) {
    item.name = name || item.name;
    item.category = category || item.category;
    item.basePrice = parseFloat(basePrice);
    item.isVeg = isVeg !== undefined ? isVeg : item.isVeg;
    if (variants) item.variants = variants;
    item.isAvailable = isAvailable !== undefined ? isAvailable : item.isAvailable;
    item.revision = restaurantCatalogRevision;
    item.updatedAt = restaurantCatalogLastUpdated;
  } else {
    action = 'CREATED';
    item = {
      id: id || 'rst_' + Math.random().toString(36).substring(2, 7),
      businessId: 'mozz_starters4u',
      name,
      category: category || 'Starters',
      basePrice: parseFloat(basePrice),
      isVeg: isVeg !== undefined ? isVeg : false,
      variants: variants || [],
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      isDeleted: false,
      revision: restaurantCatalogRevision,
      updatedAt: restaurantCatalogLastUpdated
    };
    restaurantMenu.push(item);
  }

  broadcastCatalogUpdate('outlet_mozz_gach', {
    type: 'CATALOG_REVISION_UPDATED',
    business_id: 'mozz_starters4u',
    current_revision: restaurantCatalogRevision,
    action,
    item_id: item.id,
    item_name: item.name,
    new_price: item.basePrice,
    timestamp: Date.now()
  });

  res.json({ success: true, revision: restaurantCatalogRevision, item });
});

app.post('/api/admin/catalog/retail-product', requireAuth, requireAdmin, async (req, res) => {
  const session: UserSession = (req as any).userSession;
  if (session.role !== 'superadmin' && session.activeOutlet.category !== 'retail' && session.activeOutlet.category !== 'other') {
    return res.status(403).json({ success: false, message: 'Forbidden: Retail catalog management is restricted to assigned retail outlets.' });
  }
  const outletId = session.activeOutlet.id || 'outlet_trends_threads';
  const item = await retailCatalogRepo.saveItem(outletId, req.body);
  const rev = await retailCatalogRepo.getRevision(outletId);
  broadcastCatalogUpdate(outletId, {
    type: 'CATALOG_REVISION_UPDATED',
    current_revision: rev,
    item_id: item.id,
    item_name: item.name
  });
  res.json({ success: true, revision: rev, item });
});

// -------------------------------------------------------------------------------------------------
// 5. Offline Sync APIs (Bills & Orders)
// -------------------------------------------------------------------------------------------------
app.post('/api/mobile/sync/bills', requireAuth, async (req, res) => {
  try {
    const session: UserSession = (req as any).userSession;
    const { bills } = req.body;
    if (!Array.isArray(bills) || bills.length === 0) return res.status(400).json({ success: false, message: 'Bills required' });
    if (!session.supabaseToken) return res.status(401).json({ success: false, message: 'Central Supabase session required to persist bills' });
    const db = getCentralSupabaseClient(session.supabaseToken);
    if (!db) return res.status(503).json({ success: false, message: 'Central Supabase unavailable' });
    const syncedIds: string[] = [];
    for (const entry of bills) {
      const { bill, items, idempotency_key } = entry || {};
      if (!bill || !Array.isArray(items) || !items.length || !idempotency_key || bill.outletId !== session.activeOutlet.id)
        return res.status(400).json({ success: false, message: 'Invalid bill or outlet assignment' });
      if (items.some((item: any) => !item.stylistId || !item.serviceId))
        return res.status(400).json({ success: false, message: 'Every salon service must have a selected stylist and service ID' });
      const { error } = await db.from('smav_salon_bills').upsert({
        outlet_id: session.activeOutlet.id,
        created_by: session.userId,
        bill_number: bill.billNumber,
        idempotency_key,
        customer_name: bill.customerName,
        customer_phone: bill.customerPhone,
        payment_mode: bill.paymentMode,
        grand_total: bill.grandTotal,
        items: items.map((item: any) => ({
          service_id: item.serviceId, service_name: item.name,
          stylist_id: item.stylistId, stylist_name: item.stylist,
          quantity: item.quantity, unit_price: item.price
        }))
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      syncedIds.push(bill.billNumber);
    }
    res.json({ success: true, synced_ids: syncedIds, server_timestamp: Date.now() });
  } catch (error: any) {
    res.status(503).json({ success: false, message: `Database save failed: ${error.message}` });
  }
});

app.post('/api/mobile/sync/orders', requireAuth, (req, res) => {
  const session: UserSession = (req as any).userSession;
  const { orders } = req.body;
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.json({ success: true, synced_ids: [], server_timestamp: Date.now() });
  }

  const syncedIds: string[] = [];

  for (const item of orders) {
    const { order, items, idempotency_key } = item;
    if (!order || !idempotency_key) continue;
    if (order.outletId && order.outletId !== session.activeOutlet.id && session.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Order outlet does not match active outlet session.' });
    }

    const existing = syncedOrders.find(o => o.idempotency_key === idempotency_key || o.order_number === order.orderNumber);
    if (existing) {
      syncedIds.push(order.id);
      continue;
    }

    const record = {
      id: order.id,
      order_number: order.orderNumber,
      token_number: order.tokenNumber,
      outlet_id: session.activeOutlet.id,
      business_id: session.activeOutlet.code || 'mozz_starters4u',
      branch_code: order.branchCode || session.activeOutlet.code || 'GACH',
      table_or_counter: order.tableOrCounter,
      order_type: order.orderType,
      grand_total: order.grandTotal,
      catalog_revision_at_sale: order.catalogRevisionAtSale || restaurantCatalogRevision,
      idempotency_key,
      items: items || [],
      created_at_server: new Date().toISOString()
    };

    syncedOrders.unshift(record);
    syncedIds.push(order.id);
  }

  res.json({ success: true, synced_ids: syncedIds, server_timestamp: Date.now() });
});

app.get('/api/salon/services', requireAuth, (req, res) => {
  res.json({ business_id: 'the_glossy_looks', current_revision: salonCatalogRevision, services: salonServices.filter(s => !s.isDeleted && s.isActive) });
});

app.get('/api/salon/stylists', requireAuth, (req, res) => {
  res.json({ business_id: 'the_glossy_looks', stylists });
});

app.get('/api/salon/appointments', requireAuth, (req, res) => {
  res.json({ business_id: 'the_glossy_looks', appointments: salonAppointments });
});

app.get('/api/restaurant/menu', requireAuth, (req, res) => {
  res.json({ business_id: 'mozz_starters4u', current_revision: restaurantCatalogRevision, menu: restaurantMenu.filter(m => !m.isDeleted && m.isAvailable) });
});

app.get('/api/restaurant/tables', requireAuth, (req, res) => {
  res.json({ business_id: 'mozz_starters4u', tables: restaurantTables });
});

app.get('/api/restaurant/orders/pending', requireAuth, (req, res) => {
  res.json({ business_id: 'mozz_starters4u', pending_orders: pendingRestaurantOrders });
});

app.get('/api/admin/devices', requireAuth, requireAdmin, (req, res) => {
  const session: UserSession = (req as any).userSession;
  const devices = session.role === 'superadmin'
    ? pairedDevices
    : pairedDevices.filter(d => d.outlet_id === session.activeOutlet.id || d.outlet_code === session.activeOutlet.code);
  res.json({ devices });
});

app.get('/api/admin/bills', requireAuth, requireAdmin, (req, res) => {
  const session: UserSession = (req as any).userSession;
  const bills = session.role === 'superadmin'
    ? syncedBills
    : syncedBills.filter(b => b.outlet_id === session.activeOutlet.id);
  res.json({ bills });
});

app.get('/api/admin/orders', requireAuth, requireAdmin, (req, res) => {
  const session: UserSession = (req as any).userSession;
  const orders = session.role === 'superadmin'
    ? syncedOrders
    : syncedOrders.filter(o => o.outlet_id === session.activeOutlet.id);
  res.json({ orders });
});

app.get('/api/admin/whatsapp-queue', requireAuth, requireAdmin, (req, res) => {
  res.json({ queue: whatsappQueue });
});

app.get('/api/admin/sync-status', requireAuth, requireAdmin, (req, res) => {
  res.json({
    supabase_configured: true,
    last_supabase_sync: lastSupabaseSyncTimestamp,
    salon: {
      business_id: 'the_glossy_looks',
      supabase_project_url: SUPABASE_CONFIG.the_glossy_looks.project_url,
      current_revision: salonCatalogRevision,
      last_updated: salonCatalogLastUpdated,
      total_items: salonServices.filter(s => !s.isDeleted && s.isActive).length,
      stylists_count: stylists.length,
      synced_bills: syncedBills.length
    },
    restaurant: {
      business_id: 'mozz_starters4u',
      supabase_project_url: SUPABASE_CONFIG.mozz_starters4u.project_url,
      current_revision: restaurantCatalogRevision,
      last_updated: restaurantCatalogLastUpdated,
      total_items: restaurantMenu.filter(m => !m.isDeleted && m.isAvailable).length,
      synced_orders: syncedOrders.length
    },
    realtime_active_subscribers: realtimeClients.length
  });
});

app.get('/api/supabase/status', (req, res) => {
  res.json({
    success: true,
    last_sync: lastSupabaseSyncTimestamp,
    the_glossy_looks: {
      business_name: 'The Glossy Looks Salon & Spa',
      supabase_project_url: SUPABASE_CONFIG.the_glossy_looks.project_url,
      services_count: salonServices.filter(s => !s.isDeleted && s.isActive).length,
      stylists_count: stylists.length,
      revision: salonCatalogRevision,
      status: lastSupabaseSyncTimestamp ? 'LAST_PULL_RECORDED' : 'NOT_VERIFIED'
    },
    mozz_starters4u: {
      business_name: 'MOZZ / Starters4U Restaurant',
      supabase_project_url: SUPABASE_CONFIG.mozz_starters4u.project_url,
      menu_items_count: restaurantMenu.filter(m => !m.isDeleted && m.isAvailable).length,
      revision: restaurantCatalogRevision,
      status: lastSupabaseSyncTimestamp ? 'LAST_PULL_RECORDED' : 'NOT_VERIFIED'
    }
  });
});

app.post('/api/supabase/sync', async (req, res) => {
  try {
    const syncResult = await syncLiveSupabaseCatalogs();
    res.json(syncResult);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Downloadable Zip Generator for Android Project
app.get('/api/download/android-project.zip', async (req, res) => {
  try {
    const zip = new JSZip();
    const androidDir = path.join(__dirname, 'agents', 'android');
    const databaseDir = path.join(__dirname, 'database');

    function addDirectoryToZip(dirPath: string, zipFolder: JSZip) {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const subFolder = zipFolder.folder(file);
          if (subFolder) addDirectoryToZip(fullPath, subFolder);
        } else {
          const content = fs.readFileSync(fullPath);
          zipFolder.file(file, content);
        }
      }
    }

    const smavProjectFolder = zip.folder('SMAV-Print-Agent-Android');
    if (smavProjectFolder) {
      addDirectoryToZip(androidDir, smavProjectFolder);
      if (fs.existsSync(databaseDir)) {
        const dbFolder = smavProjectFolder.folder('database');
        if (dbFolder) addDirectoryToZip(databaseDir, dbFolder);
      }
      if (fs.existsSync(path.join(__dirname, 'README.md'))) {
        smavProjectFolder.file('README.md', fs.readFileSync(path.join(__dirname, 'README.md'), 'utf-8'));
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="SMAV-Print-Agent-Android.zip"');
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate Android project zip: ' + err.message });
  }
});

function validateStartupEnvironment() {
  const missingRequired: string[] = [];
  if (!centralSupabaseConfig.projectUrl) {
    missingRequired.push('SMAV_SUPABASE_URL');
  }
  if (!centralSupabaseConfig.publishableKey) {
    missingRequired.push('SMAV_SUPABASE_ANON_KEY');
  }

  const missingRecommended: string[] = [];
  if (!process.env.SMAV_SERVICE_ROLE_KEY?.trim()) {
    missingRecommended.push('SMAV_SERVICE_ROLE_KEY');
  }
  if (!process.env.SMAV_EDGE_FUNCTION_URL?.trim()) {
    missingRecommended.push('SMAV_EDGE_FUNCTION_URL (using default project URL)');
  }
  if (!process.env.GLOSSYLOOKS_INTEGRATION_KEY?.trim()) {
    missingRecommended.push('GLOSSYLOOKS_INTEGRATION_KEY');
  }
  if (!process.env.MOZZ_INTEGRATION_KEY?.trim()) {
    missingRecommended.push('MOZZ_INTEGRATION_KEY');
  }

  console.log(
    `[Startup Env] mode=${isProductionMode ? 'production' : 'development'} host=${HOST} port=${PORT} centralSupabase=${centralSupabaseConfig.isConfigured ? 'configured' : 'missing'} serviceRole=${process.env.SMAV_SERVICE_ROLE_KEY?.trim() ? 'configured' : 'missing'}`
  );

  if (missingRequired.length > 0) {
    console.warn(`[Startup Env Warn] Missing required environment variable(s): ${missingRequired.join(', ')}`);
  }
  if (missingRecommended.length > 0) {
    console.warn(`[Startup Env Info] Optional/integration variable(s) not set: ${missingRecommended.join(', ')}`);
  }
}

// Vite / Production Static Integration
async function startServer() {
  validateStartupEnvironment();

  const distDir = path.join(__dirname, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');

  if (!isProductionMode) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API route not found' });
      }
      if (!fs.existsSync(distIndexPath)) {
        return res.status(503).json({
          success: false,
          message: 'Frontend build (dist/index.html) not found. Run npm run build.'
        });
      }
      return res.sendFile(distIndexPath);
    });
  }

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`SMAV Print Agent Enterprise Gateway running on http://${HOST}:${PORT}`);

    // Run upstream catalog sync & retry worker asynchronously after port binds
    // so Cloud Run / container startup probes pass immediately.
    void syncLiveSupabaseCatalogs()
      .then((res) => {
        if (!res?.success) {
          console.warn('[Startup Catalog Sync]', res?.error || 'Deferred');
        }
      })
      .catch((err) => {
        console.error('[Startup Supabase Sync Warn]', err);
      });

    try {
      outletSyncCoordinator.startRetryWorker();
    } catch (err) {
      console.error('[Startup Outbox Worker Warn]', err);
    }
  });

  httpServer.on('error', (err) => {
    console.error('[Server Listen Error]', err);
    process.exit(1);
  });
}

startServer();
