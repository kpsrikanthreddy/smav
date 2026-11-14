// ==============================================================================
// Supabase Edge Function: smav-identity-admin
// Location: supabase/functions/smav-identity-admin/index.ts
//
// Authoritative identity and user-management gateway for Central SMAV Supabase.
// Handles staff provisioning, RBAC outlet assignment, business synchronization,
// password resets, and identity federation using the service_role key server-side.
// ==============================================================================

// Declare Deno runtime global for TypeScript environments
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Promise<Response>): void;
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Standard CORS headers for cross-origin browser and backend requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-business-source, x-integration-key, x-smav-gateway-secret',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

interface CallerContext {
  isServiceOrBackend: boolean;
  businessSource?: string;
  callerUserId?: string;
  callerEmail?: string;
  isSuperadmin: boolean;
  adminOutletIds: string[];
}

// JSON response helper with CORS headers
function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Error response helper with CORS headers
function errorResponse(message: string, status = 400, details?: unknown): Response {
  return new Response(
    JSON.stringify({ success: false, error: message, details }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

// Map external portal roles to SMAV roles and titles
function mapPortalRoleToSmav(
  externalRole: string,
  businessSource: string
): { smavRole: 'ADMIN' | 'STAFF'; title: string } {
  const norm = String(externalRole || '').trim().toUpperCase();

  if (businessSource === 'glossylooks') {
    switch (norm) {
      case 'OWNER':
        return { smavRole: 'ADMIN', title: 'Salon Business Owner' };
      case 'MANAGER':
      case 'ADMIN':
        return { smavRole: 'ADMIN', title: 'Salon Branch Manager' };
      case 'STYLIST':
        return { smavRole: 'STAFF', title: 'Senior Hair Stylist / Beautician' };
      case 'RECEPTIONIST':
      default:
        return { smavRole: 'STAFF', title: 'Salon Receptionist / Cashier' };
    }
  } else if (businessSource === 'mozz') {
    switch (norm) {
      case 'OWNER':
        return { smavRole: 'ADMIN', title: 'Restaurant Business Owner' };
      case 'MANAGER':
      case 'ADMIN':
        return { smavRole: 'ADMIN', title: 'Restaurant General Manager' };
      case 'CASHIER':
        return { smavRole: 'STAFF', title: 'Counter Cashier' };
      case 'WAITER':
      case 'STAFF':
      default:
        return { smavRole: 'STAFF', title: 'Floor Staff / Cashier' };
    }
  }

  // Default fallback for generic portals
  return norm === 'ADMIN' || norm === 'OWNER' || norm === 'MANAGER'
    ? { smavRole: 'ADMIN', title: 'Outlet Administrator' }
    : { smavRole: 'STAFF', title: 'Outlet Staff Member' };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Requirement 9: Service-role key stays exclusively inside the Edge Function
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(
      'Server misconfiguration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in Edge Function environment',
      500
    );
  }

  // Privileged admin client with service_role key
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ----------------------------------------------------------------------------
  // Requirement 1: Remove hardcoded integration secrets and require environment variables
  // ----------------------------------------------------------------------------
  const configuredGlossyKey = Deno.env.get('GLOSSYLOOKS_INTEGRATION_KEY')?.trim();
  const configuredMozzKey = Deno.env.get('MOZZ_INTEGRATION_KEY')?.trim();
  // Master integration key is deliberately not accepted for privileged user-management actions.
  // SUPERADMIN must authenticate using their own verified Supabase JWT.

  const authHeader = req.headers.get('Authorization') || '';
  const integrationKey =
    req.headers.get('X-Integration-Key') ||
    req.headers.get('X-SMAV-Gateway-Secret') ||
    '';
  const businessSourceHeader = (req.headers.get('X-Business-Source') || '').trim().toLowerCase();

  let callerContext: CallerContext = {
    isServiceOrBackend: false,
    isSuperadmin: false,
    adminOutletIds: [],
  };

  // Check trusted backend integration header if present
  // ONLY match if corresponding environment variable is actually defined and non-empty
  if (integrationKey) {
    if (
      configuredGlossyKey &&
      businessSourceHeader === 'glossylooks' &&
      integrationKey === configuredGlossyKey
    ) {
      callerContext.isServiceOrBackend = true;
      callerContext.businessSource = 'glossylooks';
    } else if (
      configuredMozzKey &&
      businessSourceHeader === 'mozz' &&
      integrationKey === configuredMozzKey
    ) {
      callerContext.isServiceOrBackend = true;
      callerContext.businessSource = 'mozz';
    }
  }

  // If not authenticated via backend secret, verify caller's Supabase JWT
  if (!callerContext.isServiceOrBackend && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      return errorResponse('Unauthorized: Invalid or expired access token', 401);
    }

    const callerId = userData.user.id;
    callerContext.callerUserId = callerId;
    callerContext.callerEmail = userData.user.email;

    // Fetch caller's profile to inspect platform_role and active status
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('smav_profiles')
      .select('platform_role, is_active')
      .eq('id', callerId)
      .maybeSingle();

    if (profileError) {
      return errorResponse(`Database error verifying caller profile: ${profileError.message}`, 500);
    }

    if (!profile || profile.is_active === false) {
      return errorResponse('Forbidden: User account is inactive or profile does not exist', 403);
    }

    if (profile.platform_role?.toUpperCase() === 'SUPERADMIN') {
      callerContext.isSuperadmin = true;
    } else {
      // Find outlets where caller is an active ADMIN or OWNER
      const { data: roles, error: rolesError } = await supabaseAdmin
        .from('smav_user_outlet_roles')
        .select('outlet_id, role, is_active')
        .eq('user_id', callerId)
        .eq('is_active', true);

      if (rolesError) {
        return errorResponse(`Database error querying caller outlet roles: ${rolesError.message}`, 500);
      }

      const adminRoles = (roles || []).filter((r: any) =>
        String(r.role).toUpperCase() === 'ADMIN'
      );
      const adminIds = adminRoles.map((r: any) => String(r.outlet_id));
      const { data: activeOutlets, error: outletError } = await supabaseAdmin
        .from('smav_outlets').select('id').in('id', adminIds.length ? adminIds : ['00000000-0000-0000-0000-000000000000'])
        .eq('is_active', true);
      if (outletError) return errorResponse('Unable to validate active outlet assignments', 500);
      callerContext.adminOutletIds = (activeOutlets || []).map((o: any) => String(o.id));
    }
  }

  // If neither valid JWT nor valid backend integration key was accepted, reject immediately
  if (!callerContext.isServiceOrBackend && !callerContext.callerUserId) {
    return errorResponse(
      'Unauthorized: Valid Bearer JWT or configured X-Integration-Key required',
      401
    );
  }

  // Parse Request Body
  let body: Record<string, any> = {};
  if (req.method !== 'GET') {
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON request body', 400);
    }
  }

  const action = (
    body.action ||
    new URL(req.url).searchParams.get('action') ||
    ''
  ).toLowerCase();

  // Helper: Resolve outlet by ID or code safely against existing schema
  async function resolveOutlet(codeOrId: string) {
    const clean = String(codeOrId || '').trim();
    if (!clean || !/^[a-zA-Z0-9_-]{1,80}$|^[0-9a-f-]{36}$/i.test(clean)) return null;

    // 1. Try matching by exact ID
    const { data: byId } = await supabaseAdmin
      .from('smav_outlets')
      .select('*')
      .eq('id', clean)
      .eq('is_active', true)
      .maybeSingle();

    if (byId) return byId;

    // 2. Try matching by outlet_code, code, or branch_code
    const { data: byCode } = await supabaseAdmin
      .from('smav_outlets')
      .select('*')
      .or(`outlet_code.ilike.${clean},code.ilike.${clean},branch_code.ilike.${clean}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    return byCode || null;
  }

  // Requirement 3: Helper to check if caller is authorized for a specific outlet
  function canManageOutlet(outletId: string, outletCode?: string): boolean {
    if (callerContext.isSuperadmin) return true;

    // Trusted backend integrations are authorized ONLY for their own outlet
    if (callerContext.isServiceOrBackend) {
      const code = String(outletCode || '').toLowerCase();
      if (
        callerContext.businessSource === 'glossylooks' &&
        code === 'glossylooks'
      ) {
        return true;
      }
      if (
        callerContext.businessSource === 'mozz' &&
        code === 'mozz'
      ) {
        return true;
      }
      return false;
    }

    // Authenticated outlet admins are authorized only for outlets in their adminOutletIds
    return (
      callerContext.adminOutletIds.includes(outletId)
    );
  }

  // Requirement 5: Helper to resolve and validate an Auth user by userId or email
  async function findAuthUser(identifier: { id?: string; email?: string }) {
    if (identifier.id) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(identifier.id);
      if (!error && data?.user) return data.user;
      return null;
    }
    if (identifier.email) {
      const cleanEmail = identifier.email.trim().toLowerCase();
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!error && data?.users) {
        const found = data.users.find((u: any) => u.email?.toLowerCase() === cleanEmail);
        if (found) return found;
      }
    }
    return null;
  }

  // Actual deployed schema: profiles(id, full_name, platform_role, is_active),
  // outlet roles(user_id, outlet_id, role, is_active), external identities
  // (source, external_id, auth_user_id, username, email, created_at).
  async function saveProfile(userId: string, name: string, active = true) {
    const { data: existing, error } = await supabaseAdmin.from('smav_profiles')
      .select('platform_role, is_active').eq('id', userId).maybeSingle();
    if (error) return error;
    // Never reactivate/deactivate an existing account during an outlet sync.
    if (existing) {
      const { error: updateError } = await supabaseAdmin.from('smav_profiles')
        .update({ full_name: name }).eq('id', userId);
      return updateError;
    }
    const { error: insertError } = await supabaseAdmin.from('smav_profiles')
      .insert({ id: userId, full_name: name, platform_role: 'USER', is_active: active });
    return insertError;
  }

  async function saveOutletRole(userId: string, outletId: string, role: 'ADMIN' | 'STAFF', active: boolean, allowAdminChange: boolean) {
    const { data: existing, error } = await supabaseAdmin.from('smav_user_outlet_roles')
      .select('id, role').eq('user_id', userId).eq('outlet_id', outletId).maybeSingle();
    if (error) return error;
    if (existing) {
      // Outlet admins and integration callers cannot downgrade/replace existing ADMIN assignments.
      if (!allowAdminChange && String(existing.role).toUpperCase() !== 'STAFF')
        return new Error('Only SUPERADMIN can change an existing ADMIN assignment');
      const { error: updateError } = await supabaseAdmin.from('smav_user_outlet_roles')
        .update({ role, is_active: active }).eq('id', existing.id);
      return updateError;
    }
    const { error: insertError } = await supabaseAdmin.from('smav_user_outlet_roles')
      .insert({ user_id: userId, outlet_id: outletId, role, is_active: active });
    return insertError;
  }

  async function saveExternalIdentity(source: string, externalId: string, userId: string, username: string, email: string) {
    const key = String(externalId || username || email).trim();
    if (!key) return null;
    const { data: existing, error } = await supabaseAdmin.from('smav_external_identities')
      .select('source, external_id, auth_user_id').eq('source', source).eq('external_id', key).maybeSingle();
    if (error) return error;
    if (existing && existing.auth_user_id !== userId)
      return new Error('External identity already belongs to a different user');
    const payload = { source, external_id: key, auth_user_id: userId, username: username || null, email };
    if (existing) {
      const { error: updateError } = await supabaseAdmin.from('smav_external_identities')
        .update({ username: payload.username, email }).eq('source', source).eq('external_id', key);
      return updateError;
    }
    const { error: insertError } = await supabaseAdmin.from('smav_external_identities').insert(payload);
    return insertError;
  }

  // Helper to record platform audit log safely respecting NOT NULL constraints
  async function recordAudit(params: {
    action: string;
    entityType: string;
    entityId: string;
    outletId?: string | null;
    details?: Record<string, unknown>;
  }) {
    try {
      await supabaseAdmin.from('smav_audit_logs').insert({
        user_id: callerContext.callerUserId || 'system',
        user_email: callerContext.callerEmail || (callerContext.businessSource ? `${callerContext.businessSource}@service` : 'system@smav.local'),
        outlet_id: params.outletId || null,
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId,
        details: params.details || {},
        timestamp: new Date().toISOString(),
      });
    } catch (auditErr) {
      console.warn('[smav-identity-admin] Audit log recording failed:', auditErr);
    }
  }

  try {
    switch (action) {
      // ==============================================================================
      // 1. CREATE OUTLET ADMINISTRATOR
      // Requirement 2: Restrict administrator creation strictly to authenticated SUPERADMIN
      // ==============================================================================
      case 'create-admin':
      case 'create_admin': {
        if (!callerContext.isSuperadmin || !callerContext.callerUserId) {
          return errorResponse(
            'Forbidden: Only authenticated SUPERADMIN users can create outlet administrators',
            403
          );
        }

        const { email, fullName, phone, outletCode, temporaryPassword, username } = body;
        if (!email || !outletCode) {
          return errorResponse('email and outletCode are required', 400);
        }

        const outlet = await resolveOutlet(outletCode);
        if (!outlet) {
          return errorResponse(`Outlet "${outletCode}" not found or inactive`, 404);
        }

        const cleanEmail = email.trim().toLowerCase();

        // 1. Find or create user in Supabase Auth
        let targetUser = await findAuthUser({ email: cleanEmail });
        let isNewUser = false;

        if (!targetUser) {
          isNewUser = true;
          const initialPassword = temporaryPassword || `Admin@${crypto.randomUUID().substring(0, 8)}!`;
          const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: cleanEmail,
            password: initialPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName, phone: phone || '' },
          });

          if (createError || !newUser?.user) {
            return errorResponse(`Failed to create Auth user: ${createError?.message || 'Unknown error'}`, 400);
          }
          targetUser = newUser.user;
        }

        // 2. Protect existing SUPERADMIN profile (Requirement 4)
        const { data: existingProfile } = await supabaseAdmin
          .from('smav_profiles')
          .select('platform_role')
          .eq('id', targetUser.id)
          .maybeSingle();

        const isSuperadminProfile = existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN';

        // 3. Upsert smav_profiles with valid schema columns only (Requirement 6)
        const profileError = await saveProfile(targetUser.id, fullName || cleanEmail.split('@')[0]);

        if (profileError) {
          return errorResponse(`Failed to update profile: ${profileError.message}`, 400);
        }

        // 4. Assign ADMIN role in smav_user_outlet_roles
        const roleError = await saveOutletRole(targetUser.id, outlet.id, 'ADMIN', true, true);

        if (roleError) {
          return errorResponse(`Failed to assign outlet admin role: ${roleError.message}`, 400);
        }

        // 5. Map username in smav_external_identities if provided
        if (username) {
          const identError = await saveExternalIdentity(outlet.code || outlet.outlet_code, String(username), targetUser.id, String(username).trim().toLowerCase(), cleanEmail);

          if (identError) {
            console.warn('[smav-identity-admin] External identity upsert failed:', identError.message);
          }
        }

        // 6. Generate activation link if new user without explicit password
        let activationLink = '';
        if (isNewUser && !temporaryPassword) {
          const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email: cleanEmail,
          });
          if (!linkErr && linkData?.properties?.action_link) {
            activationLink = linkData.properties.action_link;
          }
        }

        await recordAudit({
          action: 'CREATE_OUTLET_ADMIN',
          entityType: 'USER',
          entityId: targetUser.id,
          outletId: outlet.id,
          details: { targetEmail: cleanEmail, outletCode: outlet.code || outlet.outlet_code, isNewUser },
        });

        return jsonResponse({
          success: true,
          message: isNewUser
            ? `Admin account created for "${cleanEmail}" on ${outlet.outlet_name || outlet.name}.`
            : `Existing user "${cleanEmail}" assigned ADMIN role on ${outlet.outlet_name || outlet.name}.`,
          userId: targetUser.id,
          isNewUser,
          outletId: outlet.id,
          outletCode: outlet.code || outlet.outlet_code,
          activationLink: activationLink || undefined,
          recoveryLink: activationLink || undefined,
        });
      }

      // ==============================================================================
      // 2. CREATE OUTLET STAFF
      // Requirement 3: Enforce outlet-level authorization
      // ==============================================================================
      case 'create-staff':
      case 'create_staff': {
        const {
          email,
          fullName,
          phone,
          outletCode,
          temporaryPassword,
          username,
          externalStaffId,
          externalRole,
        } = body;

        if (!email || !outletCode) {
          return errorResponse('email and outletCode are required', 400);
        }

        const outlet = await resolveOutlet(outletCode);
        if (!outlet) {
          return errorResponse(`Outlet "${outletCode}" not found or inactive`, 404);
        }

        // Requirement 3: Verify caller authorization for this specific outlet
        if (!canManageOutlet(outlet.id, outlet.code || outlet.outlet_code)) {
          return errorResponse(
            'Forbidden: You are not authorized to create or manage staff for this outlet',
            403
          );
        }

        const cleanEmail = email.trim().toLowerCase();

        // 1. Find or create in Supabase Auth
        let targetUser = await findAuthUser({ email: cleanEmail });
        let isNewUser = false;

        if (!targetUser) {
          isNewUser = true;
          const initialPassword = temporaryPassword || `Staff@${crypto.randomUUID().substring(0, 8)}!`;
          const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: cleanEmail,
            password: initialPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName, phone: phone || '' },
          });

          if (createError || !newUser?.user) {
            return errorResponse(`Failed to create Auth user: ${createError?.message || 'Unknown error'}`, 400);
          }
          targetUser = newUser.user;
        }

        // 2. Protect existing SUPERADMIN profile (Requirement 4)
        const { data: existingProfile } = await supabaseAdmin
          .from('smav_profiles')
          .select('platform_role')
          .eq('id', targetUser.id)
          .maybeSingle();

        const isSuperadminProfile = existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN';

        // 3. Upsert smav_profiles with valid schema columns only (Requirement 6)
        const profileError = await saveProfile(targetUser.id, fullName || cleanEmail.split('@')[0]);

        if (profileError) {
          return errorResponse(`Failed to update profile: ${profileError.message}`, 400);
        }

        if (isSuperadminProfile && !callerContext.isSuperadmin) return errorResponse('Cannot assign SUPERADMIN to staff', 403);

        // 4. Upsert smav_user_outlet_roles with strictly staff POS permissions (Requirement 4)
        const roleError = await saveOutletRole(targetUser.id, outlet.id, 'STAFF', true, callerContext.isSuperadmin);

        if (roleError) {
          return errorResponse(`Failed to assign staff role: ${roleError.message}`, 400);
        }

        // 5. Record external identity if username provided
        if (username) {
          const identError = await saveExternalIdentity(outlet.code || outlet.outlet_code, String(username), targetUser.id, String(username).trim().toLowerCase(), cleanEmail);

          if (identError) {
            console.warn('[smav-identity-admin] External identity upsert failed:', identError.message);
          }
        }

        await recordAudit({
          action: 'CREATE_OUTLET_STAFF',
          entityType: 'USER',
          entityId: targetUser.id,
          outletId: outlet.id,
          details: { targetEmail: cleanEmail, outletCode: outlet.code || outlet.outlet_code, isNewUser },
        });

        return jsonResponse({
          success: true,
          message: isNewUser
            ? `Staff member "${cleanEmail}" provisioned for ${outlet.outlet_name || outlet.name}.`
            : `Existing user "${cleanEmail}" linked to ${outlet.outlet_name || outlet.name} as STAFF.`,
          userId: targetUser.id,
          isNewUser,
          outletId: outlet.id,
          outletCode: outlet.code || outlet.outlet_code,
        });
      }

      // ==============================================================================
      // 3. SYNCHRONIZE GLOSSY LOOKS STAFF
      // Requirement 4: Prevent overwriting SUPERADMIN profiles or granting unintended permissions
      // Requirement 8: Preserve Glossy Looks staff synchronization
      // ==============================================================================
      case 'sync-glossylooks':
      case 'sync_glossylooks': {
        // Enforce synchronization authorization
        if (
          !callerContext.isSuperadmin &&
          callerContext.businessSource !== 'glossylooks'
        ) {
          return errorResponse('Forbidden: Unauthorized for Glossy Looks synchronization', 403);
        }

        const outlet = await resolveOutlet('glossylooks');
        if (!outlet) {
          return errorResponse('Glossy Looks outlet ("glossylooks") not found in central database', 404);
        }

        const staffItems: any[] = Array.isArray(body.staff) ? body.staff : [body];
        const syncResults: any[] = [];

        for (const item of staffItems) {
          const email = (item.email || '').trim().toLowerCase();
          const name = item.name || item.fullName || email.split('@')[0];
          const rawRole = item.role || item.assignedRole || 'STYLIST';
          const externalStaffId = item.id || item.externalStaffId || item.staff_id;
          const phone = item.phone || '';
          const username = item.username || email.split('@')[0];
          const isActive =
            item.isActive !== false &&
            item.is_active !== false &&
            item.status !== 'inactive';

          if (!email) continue;

          const { smavRole, title } = mapPortalRoleToSmav(rawRole, 'glossylooks');

          // 1. Find or create in Auth
          let user = await findAuthUser({ email });
          let isNewUser = false;

          if (!user) {
            isNewUser = true;
            const tempPassword = `Glossy@${crypto.randomUUID().substring(0, 8)}!`;
            const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
              email,
              password: tempPassword,
              email_confirm: true,
              user_metadata: { full_name: name, external_role: rawRole, source: 'glossylooks' },
            });
            if (!createErr && created?.user) {
              user = created.user;
            } else {
              syncResults.push({ email, status: 'error', error: createErr?.message || 'Auth creation failed' });
              continue;
            }
          }

          // 2. Requirement 4: Protect existing SUPERADMIN profile from being overwritten
          const { data: existingProfile } = await supabaseAdmin
            .from('smav_profiles')
            .select('platform_role')
            .eq('id', user.id)
            .maybeSingle();

          const isSuperadminProfile = existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN';
          if (isSuperadminProfile) {
            syncResults.push({ email, status: 'skipped', reason: 'SUPERADMIN account is protected' });
            continue;
          }

          // 3. Upsert smav_profiles with valid schema columns only (Requirement 6)
          const profileError = await saveProfile(user.id, name, isActive);

          if (profileError) {
            syncResults.push({ email, status: 'error', error: profileError.message });
            continue;
          }

          // 4. Requirement 4: Role is strictly outlet-scoped (ADMIN or STAFF, never SUPERADMIN)
          const roleError = await saveOutletRole(user.id, outlet.id, smavRole, isActive, callerContext.isSuperadmin);

          if (roleError) {
            syncResults.push({ email, status: 'error', error: roleError.message });
            continue;
          }

          // 5. Upsert external identity for username resolution
          if (username) {
            const identError = await saveExternalIdentity('glossylooks', String(externalStaffId || username), user.id, String(username).trim().toLowerCase(), email);

            if (identError) {
              console.warn('[smav-identity-admin] Identity map error:', identError.message);
            }
          }

          syncResults.push({ email, name, smavRole, rawRole, isNewUser, status: 'synced' });
        }

        return jsonResponse({
          success: true,
          message: `Synchronized ${syncResults.filter((r) => r.status === 'synced').length} Glossy Looks staff members to Central SMAV`,
          outlet: outlet.name || outlet.outlet_name,
          results: syncResults,
        });
      }

      // ==============================================================================
      // 4. SYNCHRONIZE MOZZ / STARTERS4U STAFF
      // Requirement 4: Prevent overwriting SUPERADMIN profiles or granting unintended permissions
      // Requirement 8: Preserve MOZZ staff synchronization
      // ==============================================================================
      case 'sync-mozz':
      case 'sync_mozz': {
        // Enforce synchronization authorization
        if (
          !callerContext.isSuperadmin &&
          callerContext.businessSource !== 'mozz'
        ) {
          return errorResponse('Forbidden: Unauthorized for MOZZ synchronization', 403);
        }

        const outlet = await resolveOutlet('mozz');
        if (!outlet) {
          return errorResponse('MOZZ outlet ("mozz") not found in central database', 404);
        }

        const staffItems: any[] = Array.isArray(body.staff) ? body.staff : [body];
        const syncResults: any[] = [];

        for (const item of staffItems) {
          const email = (item.email || '').trim().toLowerCase();
          const name = item.name || item.fullName || email.split('@')[0];
          const rawRole = item.role || item.assignedRole || 'CASHIER';
          const externalStaffId = item.id || item.externalStaffId || item.staff_id;
          const phone = item.phone || '';
          const username = item.username || email.split('@')[0];
          const isActive =
            item.isActive !== false &&
            item.is_active !== false &&
            item.status !== 'inactive';

          if (!email) continue;

          const { smavRole, title } = mapPortalRoleToSmav(rawRole, 'mozz');

          // 1. Find or create in Auth
          let user = await findAuthUser({ email });
          let isNewUser = false;

          if (!user) {
            isNewUser = true;
            const tempPassword = `Mozz@${crypto.randomUUID().substring(0, 8)}!`;
            const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
              email,
              password: tempPassword,
              email_confirm: true,
              user_metadata: { full_name: name, external_role: rawRole, source: 'mozz' },
            });
            if (!createErr && created?.user) {
              user = created.user;
            } else {
              syncResults.push({ email, status: 'error', error: createErr?.message || 'Auth creation failed' });
              continue;
            }
          }

          // 2. Requirement 4: Protect existing SUPERADMIN profile from being overwritten
          const { data: existingProfile } = await supabaseAdmin
            .from('smav_profiles')
            .select('platform_role')
            .eq('id', user.id)
            .maybeSingle();

          const isSuperadminProfile = existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN';
          if (isSuperadminProfile) {
            syncResults.push({ email, status: 'skipped', reason: 'SUPERADMIN account is protected' });
            continue;
          }

          // 3. Upsert smav_profiles with valid schema columns only (Requirement 6)
          const profileError = await saveProfile(user.id, name, isActive);

          if (profileError) {
            syncResults.push({ email, status: 'error', error: profileError.message });
            continue;
          }

          // 4. Requirement 4: Role is strictly outlet-scoped (ADMIN or STAFF, never SUPERADMIN)
          const roleError = await saveOutletRole(user.id, outlet.id, smavRole, isActive, callerContext.isSuperadmin);

          if (roleError) {
            syncResults.push({ email, status: 'error', error: roleError.message });
            continue;
          }

          // 5. Upsert external identity for username resolution
          if (username) {
            const identError = await saveExternalIdentity('mozz', String(externalStaffId || username), user.id, String(username).trim().toLowerCase(), email);

            if (identError) {
              console.warn('[smav-identity-admin] Identity map error:', identError.message);
            }
          }

          syncResults.push({ email, name, smavRole, rawRole, isNewUser, status: 'synced' });
        }

        return jsonResponse({
          success: true,
          message: `Synchronized ${syncResults.filter((r) => r.status === 'synced').length} MOZZ staff members to Central SMAV`,
          outlet: outlet.name || outlet.outlet_name,
          results: syncResults,
        });
      }

      // ==============================================================================
      // 5. DEACTIVATE / REACTIVATE STAFF
      // Requirement 3: Enforce outlet-level authorization for status updates
      // ==============================================================================
      case 'set-status':
      case 'set_status': {
        const { userId, email, outletCode, isActive } = body;

        // Resolve target user
        const targetUser = await findAuthUser({ id: userId, email });
        if (!targetUser) {
          return errorResponse('Target user not found in Central Supabase Auth', 404);
        }

        const targetUserId = targetUser.id;

        // Requirement 4: Prevent non-superadmin from altering a Superadmin's account
        const { data: targetProfile, error: targetProfErr } = await supabaseAdmin
          .from('smav_profiles')
          .select('platform_role')
          .eq('id', targetUserId)
          .maybeSingle();

        if (targetProfErr) {
          return errorResponse(`Database error inspecting profile: ${targetProfErr.message}`, 500);
        }

        const isTargetSuperadmin = targetProfile?.platform_role?.toUpperCase() === 'SUPERADMIN';
        if (isTargetSuperadmin && !callerContext.isSuperadmin) {
          return errorResponse('Forbidden: Only a SUPERADMIN can modify a Superadmin status', 403);
        }

        if (isTargetSuperadmin && targetUserId === callerContext.callerUserId && isActive === false) {
          return errorResponse('Bad Request: You cannot deactivate your own active SUPERADMIN account', 400);
        }

        if (outletCode) {
          const outlet = await resolveOutlet(outletCode);
          if (!outlet) return errorResponse('Outlet not found or inactive', 404);

          // Requirement 3: Enforce outlet authorization
          if (!canManageOutlet(outlet.id, outlet.code || outlet.outlet_code)) {
            return errorResponse('Forbidden: You cannot modify staff status for this outlet', 403);
          }

          if (!callerContext.isSuperadmin) {
            const { data: targetRole, error: targetRoleError } = await supabaseAdmin
              .from('smav_user_outlet_roles').select('role').eq('user_id', targetUserId)
              .eq('outlet_id', outlet.id).maybeSingle();
            if (targetRoleError || !targetRole || String(targetRole.role).toUpperCase() !== 'STAFF')
              return errorResponse('Forbidden: Outlet ADMINs can only change STAFF status', 403);
          }

          // Toggle outlet-specific membership status
          const { error: updateErr } = await supabaseAdmin
            .from('smav_user_outlet_roles')
            .update({ is_active: Boolean(isActive) })
            .eq('user_id', targetUserId)
            .eq('outlet_id', outlet.id);

          if (updateErr) {
            return errorResponse(`Failed to update outlet status: ${updateErr.message}`, 400);
          }

          await recordAudit({
            action: isActive ? 'ACTIVATE_OUTLET_STAFF' : 'DEACTIVATE_OUTLET_STAFF',
            entityType: 'USER_OUTLET_ROLE',
            entityId: `${targetUserId}_${outlet.id}`,
            outletId: outlet.id,
            details: { targetUserId, isActive: Boolean(isActive) },
          });
        } else {
          // Global status toggle strictly requires authenticated SUPERADMIN
          if (!callerContext.isSuperadmin) {
            return errorResponse('Forbidden: Global status toggle requires SUPERADMIN privileges', 403);
          }

          const { error: profileErr } = await supabaseAdmin
            .from('smav_profiles')
            .update({ is_active: Boolean(isActive) })
            .eq('id', targetUserId);

          if (profileErr) {
            return errorResponse(`Failed to update profile status: ${profileErr.message}`, 400);
          }

          // Synchronize auth user ban duration
          const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
            ban_duration: isActive ? 'none' : '876000h',
          });

          if (banErr) {
            console.warn('[smav-identity-admin] Auth ban update warning:', banErr.message);
          }

          await recordAudit({
            action: isActive ? 'GLOBAL_ACTIVATE_USER' : 'GLOBAL_DEACTIVATE_USER',
            entityType: 'USER',
            entityId: targetUserId,
            details: { targetUserId, isActive: Boolean(isActive) },
          });
        }

        return jsonResponse({
          success: true,
          message: `Staff member ${isActive ? 'activated' : 'deactivated'} successfully`,
          userId: targetUserId,
          isActive: Boolean(isActive),
        });
      }

      // ==============================================================================
      // 6. SECURE PASSWORD RESET
      // Requirement 3: Enforce outlet-level authorization for resets
      // Requirement 5: Fix password reset to resolve and validate the target user's ID
      // ==============================================================================
      // UUID-preserving email update. Integration keys cannot authorize identity changes:
      // this operation requires a verified central SUPERADMIN or outlet ADMIN JWT.
      case 'update-email': {
        if (callerContext.isServiceOrBackend || !callerContext.callerUserId) {
          return errorResponse('A verified central admin session is required for email updates', 403);
        }
        const { userId, newEmail, outletCode } = body;
        if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
          return errorResponse('A valid target userId is required', 400);
        }
        if (typeof newEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim()) || newEmail.length > 254) {
          return errorResponse('A valid newEmail is required', 400);
        }
        const target = await findAuthUser({ id: userId });
        if (!target) return errorResponse('Target account not found', 404);
        const { data: profile, error: pErr } = await supabaseAdmin.from('smav_profiles')
          .select('platform_role').eq('id', userId).maybeSingle();
        if (pErr || !profile) return errorResponse('Unable to verify target profile', 403);
        if (String(profile.platform_role).toUpperCase() === 'SUPERADMIN') {
          return errorResponse('SUPERADMIN email changes require the standard recovery process', 403);
        }
        if (!callerContext.isSuperadmin) {
          if (typeof outletCode !== 'string' || !outletCode) return errorResponse('outletCode is required', 400);
          const outlet = await resolveOutlet(outletCode);
          if (!outlet || !canManageOutlet(outlet.id, outlet.code || outlet.outlet_code)) {
            return errorResponse('Caller cannot administer this outlet', 403);
          }
          const { data: targetRole, error: rErr } = await supabaseAdmin.from('smav_user_outlet_roles')
            .select('role,is_active').eq('user_id', userId).eq('outlet_id', outlet.id).maybeSingle();
          if (rErr || !targetRole || !targetRole.is_active || String(targetRole.role).toUpperCase() !== 'STAFF') {
            return errorResponse('Outlet ADMIN may only change active STAFF email addresses', 403);
          }
        }
        const cleanEmail = newEmail.trim().toLowerCase();
        if (target.email?.toLowerCase() === cleanEmail) return jsonResponse({ success: true, userId, unchanged: true });
        const { error: changeErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          email: cleanEmail, email_confirm: true,
        });
        if (changeErr) return errorResponse(`Email update failed: ${changeErr.message}`, 400);
        // Keep linked identity metadata in sync; never recreate the auth account.
        const { error: linkErr } = await supabaseAdmin.from('smav_external_identities')
          .update({ email: cleanEmail }).eq('auth_user_id', userId);
        if (linkErr) {
          console.error('Email updated in Auth but external identity metadata update failed', linkErr);
          return errorResponse('Email changed in Auth, but identity metadata sync needs administrator attention', 500);
        }
        await recordAudit({ action: 'UPDATE_EMAIL', entityType: 'USER', entityId: userId,
          details: { previousEmail: target.email || null, newEmail: cleanEmail, byCaller: callerContext.callerEmail || callerContext.callerUserId } });
        return jsonResponse({ success: true, userId, email: cleanEmail });
      }

      case 'reset-password':
      case 'reset_password': {
        const { email, userId, newPassword, outletCode } = body;

        // Requirement 5: Resolve and validate target user by ID or email
        const targetUser = await findAuthUser({ id: userId, email });
        if (!targetUser) {
          return errorResponse(
            `Target user not found in Central Supabase Auth for "${email || userId}"`,
            404
          );
        }

        const targetUserId = targetUser.id;
        const targetEmail = (targetUser.email || '').toLowerCase();

        // Inspect target user profile
        const { data: targetProfile, error: profileErr } = await supabaseAdmin
          .from('smav_profiles')
          .select('platform_role')
          .eq('id', targetUserId)
          .maybeSingle();

        if (profileErr) {
          return errorResponse(`Database error inspecting profile: ${profileErr.message}`, 500);
        }

        const isTargetSuperadmin = targetProfile?.platform_role?.toUpperCase() === 'SUPERADMIN';

        // Password changes through this privileged endpoint require SUPERADMIN
        // or an ADMIN acting on a STAFF member of a specific active outlet.
        // Self-service recovery must use Supabase Auth's standard user recovery flow.
        if (!callerContext.isSuperadmin) {
          if (isTargetSuperadmin) return errorResponse('Forbidden: Cannot reset SUPERADMIN password', 403);
          if (!outletCode) return errorResponse('outletCode is required for outlet staff password resets', 400);
          const outlet = await resolveOutlet(String(outletCode));
          if (!outlet || !canManageOutlet(outlet.id, outlet.code || outlet.outlet_code))
            return errorResponse('Forbidden: Outlet not active or not administered by caller', 403);
          const { data: targetRole, error: targetRoleError } = await supabaseAdmin
            .from('smav_user_outlet_roles').select('role, is_active')
            .eq('user_id', targetUserId).eq('outlet_id', outlet.id).maybeSingle();
          if (targetRoleError || !targetRole || !targetRole.is_active || String(targetRole.role).toUpperCase() !== 'STAFF')
            return errorResponse('Forbidden: Only active STAFF passwords may be reset by outlet admins', 403);
        }

        if (newPassword) {
          // Explicit password change
          if (String(newPassword).length < 6) {
            return errorResponse('Password must be at least 6 characters long', 400);
          }

          const { error: resetErr } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
            password: String(newPassword),
          });

          if (resetErr) {
            return errorResponse(`Password update failed: ${resetErr.message}`, 400);
          }

          await recordAudit({
            action: 'RESET_PASSWORD_DIRECT',
            entityType: 'USER',
            entityId: targetUserId,
            details: { targetEmail, byCaller: callerContext.callerEmail || 'service' },
          });

          return jsonResponse({
            success: true,
            message: `Password updated successfully for "${targetEmail}".`,
            userId: targetUserId,
          });
        } else {
          // Generate secure password recovery link
          const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email: targetEmail,
          });

          if (linkErr || !linkData?.properties?.action_link) {
            return errorResponse(
              `Failed to generate recovery link: ${linkErr?.message || 'Link generation failed'}`,
              400
            );
          }

          await recordAudit({
            action: 'GENERATE_RECOVERY_LINK',
            entityType: 'USER',
            entityId: targetUserId,
            details: { targetEmail, byCaller: callerContext.callerEmail || 'service' },
          });

          return jsonResponse({
            success: true,
            message: `Password recovery token generated for "${targetEmail}".`,
            recoveryLink: linkData.properties.action_link,
            email: targetEmail,
            userId: targetUserId,
          });
        }
      }

      // ==============================================================================
      // 7. LIST OUTLET STAFF
      // Requirement 3: Enforce outlet-level authorization for staff listing
      // ==============================================================================
      case 'list-staff':
      case 'list_staff': {
        const outletCode =
          body.outletCode || new URL(req.url).searchParams.get('outletCode') || '';

        let targetOutletId: string | null = null;

        if (outletCode) {
          const outlet = await resolveOutlet(outletCode);
          if (!outlet) {
            return errorResponse(`Outlet "${outletCode}" not found or inactive`, 404);
          }

          // Requirement 3: Enforce outlet-level authorization
          if (!canManageOutlet(outlet.id, outlet.code || outlet.outlet_code)) {
            return errorResponse(
              'Forbidden: You are not authorized to view staff for this outlet',
              403
            );
          }
          targetOutletId = outlet.id;
        } else if (!callerContext.isSuperadmin) {
          // If caller is outlet admin without specific outletCode, restrict strictly to their admin outlets
          if (callerContext.adminOutletIds.length === 0) {
            return jsonResponse({ success: true, count: 0, staff: [] });
          }
        }

        let query = supabaseAdmin
          .from('smav_user_outlet_roles')
          .select('*, smav_profiles(*), smav_outlets(*)')
          .eq('is_active', true);

        if (targetOutletId) {
          query = query.eq('outlet_id', targetOutletId);
        } else if (!callerContext.isSuperadmin) {
          query = query.in('outlet_id', callerContext.adminOutletIds);
        }

        const { data: staffList, error: listErr } = await query;
        if (listErr) {
          return errorResponse(`Database error listing staff: ${listErr.message}`, 400);
        }

        return jsonResponse({
          success: true,
          count: (staffList || []).length,
          staff: (staffList || []).map((r: any) => ({
            userId: r.user_id,
            email: r.smav_profiles?.email,
            fullName: r.smav_profiles?.full_name,
            phone: r.smav_profiles?.phone,
            role: r.role,
            outletId: r.outlet_id,
            outletCode: r.smav_outlets?.code || r.smav_outlets?.outlet_code,
            outletName: r.smav_outlets?.outlet_name || r.smav_outlets?.name,
            outletCategory:
              r.smav_outlets?.business_type?.toLowerCase() ||
              r.smav_outlets?.category ||
              'other',
            externalStaffId: r.external_staff_id,
            businessSource: r.smav_outlets?.code || r.smav_outlets?.outlet_code,
            isActive: r.is_active,
          })),
        });
      }

      // ==============================================================================
      // 8. RETRIEVE AUTHORIZED USER & OUTLET INFO
      // ==============================================================================
      case 'get-info':
      case 'get_info': {
        // Requirement 10: Never expose integration secrets in responses
        if (!callerContext.callerUserId) {
          return jsonResponse({
            success: true,
            service: 'smav-identity-admin',
            version: '2.1.0',
            caller: 'service_integration',
            businessSource: callerContext.businessSource || 'central',
          });
        }

        const { data: profile, error: profErr } = await supabaseAdmin
          .from('smav_profiles')
          .select('*')
          .eq('id', callerContext.callerUserId)
          .single();

        if (profErr) {
          return errorResponse(`Failed to retrieve profile: ${profErr.message}`, 400);
        }

        let outlets: any[] = [];
        if (callerContext.isSuperadmin) {
          const { data: allOutlets, error: outErr } = await supabaseAdmin
            .from('smav_outlets')
            .select('*')
            .eq('is_active', true);

          if (!outErr) {
            outlets = allOutlets || [];
          }
        } else {
          const { data: userRoles, error: roleErr } = await supabaseAdmin
            .from('smav_user_outlet_roles')
            .select('*, smav_outlets(*)')
            .eq('user_id', callerContext.callerUserId)
            .eq('is_active', true);

          if (!roleErr) {
            outlets = (userRoles || []).map((r: any) => ({
              ...r.smav_outlets,
              assignedRole: r.role,
              permissions: r.permissions,
            }));
          }
        }

        return jsonResponse({
          success: true,
          profile,
          isSuperadmin: callerContext.isSuperadmin,
          outlets,
        });
      }

      default:
        return errorResponse(
          `Unknown action "${action}". Valid actions: create-admin, create-staff, set-status, reset-password, update-email, sync-glossylooks, sync-mozz, get-info, list-staff`,
          400
        );
    }
  } catch (err: any) {
    console.error('[smav-identity-admin] Unexpected exception:', err);
    return errorResponse(`Internal server error: ${err?.message || 'Unknown error'}`, 500);
  }
});
