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
    if (norm === 'OWNER' || norm.includes('OWNER') || norm.includes('DIRECTOR')) {
      return { smavRole: 'ADMIN', title: 'Salon Business Owner / Director' };
    }
    if (norm === 'MANAGER' || norm === 'ADMIN' || norm.includes('MANAGER')) {
      return { smavRole: 'ADMIN', title: 'Salon Branch Manager' };
    }
    if (norm === 'STYLIST' || norm.includes('STYLIST') || norm.includes('ARTIST') || norm.includes('BEAUTICIAN')) {
      return { smavRole: 'STAFF', title: 'Senior Hair Stylist / Beautician' };
    }
    if (norm === 'RECEPTIONIST' || norm.includes('RECEPTION') || norm.includes('CASHIER')) {
      return { smavRole: 'STAFF', title: 'Salon Receptionist / Cashier' };
    }
    return { smavRole: 'STAFF', title: 'Salon Staff Member' };
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

  // Parse Request Body safely
  let body: Record<string, any> = {};
  if (req.method !== 'GET') {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const rawAction = (
    body.action ||
    new URL(req.url).searchParams.get('action') ||
    ''
  ).trim();
  const action = rawAction.toLowerCase().replace(/_/g, '-');

  // ----------------------------------------------------------------------------
  // Authenticate Caller: Support Supabase User JWT and Backend Integration Keys
  // ----------------------------------------------------------------------------
  const configuredGlossyKey = Deno.env.get('GLOSSYLOOKS_INTEGRATION_KEY')?.trim();
  const configuredMozzKey = Deno.env.get('MOZZ_INTEGRATION_KEY')?.trim();
  const configuredMasterKey = Deno.env.get('SMAV_MASTER_INTEGRATION_KEY')?.trim();

  const authHeader = req.headers.get('Authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  const integrationKey = (
    req.headers.get('X-Integration-Key') ||
    req.headers.get('X-SMAV-Gateway-Secret') ||
    body.integrationKey ||
    body.gatewaySecret ||
    ''
  ).trim();

  const businessSourceHeader = (
    req.headers.get('X-Business-Source') ||
    body.businessSource ||
    (action.includes('glossy') ? 'glossylooks' : action.includes('mozz') ? 'mozz' : '')
  ).trim().toLowerCase();

  let callerContext: CallerContext = {
    isServiceOrBackend: false,
    isSuperadmin: false,
    adminOutletIds: [],
  };

  // 1. Check if caller matches a trusted backend integration key
  const effectiveKey = integrationKey || (
    bearerToken && (
      (configuredGlossyKey && bearerToken === configuredGlossyKey) ||
      (configuredMozzKey && bearerToken === configuredMozzKey) ||
      (configuredMasterKey && bearerToken === configuredMasterKey) ||
      (serviceRoleKey && bearerToken === serviceRoleKey)
    ) ? bearerToken : ''
  );

  if (effectiveKey) {
    if (
      configuredGlossyKey &&
      effectiveKey === configuredGlossyKey &&
      (businessSourceHeader === 'glossylooks' || action.includes('glossy'))
    ) {
      callerContext.isServiceOrBackend = true;
      callerContext.businessSource = 'glossylooks';
    } else if (
      configuredMozzKey &&
      effectiveKey === configuredMozzKey &&
      (businessSourceHeader === 'mozz' || action.includes('mozz'))
    ) {
      callerContext.isServiceOrBackend = true;
      callerContext.businessSource = 'mozz';
    } else if (
      (configuredMasterKey && effectiveKey === configuredMasterKey) ||
      (serviceRoleKey && effectiveKey === serviceRoleKey)
    ) {
      callerContext.isServiceOrBackend = true;
      callerContext.isSuperadmin = true;
    }
  }

  // 2. If not authenticated via backend integration key, verify caller's Supabase User JWT
  if (!callerContext.isServiceOrBackend) {
    const userJwt = bearerToken || req.headers.get('X-User-JWT') || body.token || '';

    if (!userJwt) {
      return errorResponse(
        'Unauthorized: Missing authorization credentials. Interactive requests must include a valid Supabase Auth JWT in "Authorization: Bearer <token>". Backend requests must provide a matching "X-Integration-Key".',
        401,
        {
          code: 'UNAUTHORIZED_MISSING_CREDENTIALS',
          hasAuthHeader: Boolean(authHeader),
          hasIntegrationKey: Boolean(integrationKey),
          action: rawAction,
          deploymentHint: 'If invoking backend synchronization without a user session, deploy the Edge Function with --no-verify-jwt and set GLOSSYLOOKS_INTEGRATION_KEY in Supabase secrets.'
        }
      );
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(userJwt);

    if (userError || !userData?.user) {
      return errorResponse(
        `Unauthorized: Invalid or expired access token. (${userError?.message || 'User token verification failed'})`,
        401,
        {
          code: 'UNAUTHORIZED_INVALID_TOKEN',
          authError: userError?.message || 'Token not recognized by Supabase Auth',
          action: rawAction,
          gatewayHint: 'Ensure you are signed in to Central SMAV Supabase Auth, or deploy Edge Function with --no-verify-jwt for integration key calls.'
        }
      );
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
        ['ADMIN', 'OWNER'].includes(String(r.role).toUpperCase())
      );
      callerContext.adminOutletIds = adminRoles.map((r: any) => String(r.outlet_id));
    }
  }

  // Helper: Resolve outlet by outlet_code from smav_outlets (Requirement 5)
  async function resolveOutlet(codeOrId: string) {
    const clean = String(codeOrId || '').trim();
    if (!clean) return null;

    // 1. Direct match on confirmed schema column: outlet_code
    const { data: byOutletCode } = await supabaseAdmin
      .from('smav_outlets')
      .select('id, outlet_code, outlet_name, business_type, is_active')
      .eq('outlet_code', clean)
      .eq('is_active', true)
      .maybeSingle();

    if (byOutletCode) return byOutletCode;

    // 2. Case-insensitive outlet_code match
    const { data: byOutletCodeIlike } = await supabaseAdmin
      .from('smav_outlets')
      .select('id, outlet_code, outlet_name, business_type, is_active')
      .ilike('outlet_code', clean)
      .eq('is_active', true)
      .maybeSingle();

    if (byOutletCodeIlike) return byOutletCodeIlike;

    // 3. Fallback: match by UUID if a valid UUID string was provided
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean);
    if (isUuid) {
      const { data: byId } = await supabaseAdmin
        .from('smav_outlets')
        .select('id, outlet_code, outlet_name, business_type, is_active')
        .eq('id', clean)
        .maybeSingle();

      if (byId) return byId;
    }

    // 4. Semantic fallback for glossylooks
    if (clean.toLowerCase().includes('glossy') || clean.toLowerCase() === 'salon') {
      const { data: bySalon } = await supabaseAdmin
        .from('smav_outlets')
        .select('id, outlet_code, outlet_name, business_type, is_active')
        .or('outlet_code.ilike.%glossy%,outlet_name.ilike.%glossy%,business_type.ilike.%salon%')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (bySalon) return bySalon;
    }

    // 5. Semantic fallback for mozz
    if (clean.toLowerCase().includes('mozz') || clean.toLowerCase() === 'restaurant') {
      const { data: byRest } = await supabaseAdmin
        .from('smav_outlets')
        .select('id, outlet_code, outlet_name, business_type, is_active')
        .or('outlet_code.ilike.%mozz%,outlet_name.ilike.%mozz%,business_type.ilike.%restaurant%')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (byRest) return byRest;
    }

    return null;
  }

  // Requirement 3: Helper to check if caller is authorized for a specific outlet (No hardcoded UUIDs)
  function canManageOutlet(outletId: string, outletCode?: string): boolean {
    if (callerContext.isSuperadmin) return true;

    // Trusted backend integrations are authorized ONLY for their own outlet
    if (callerContext.isServiceOrBackend) {
      const code = String(outletCode || '').toLowerCase();
      if (
        callerContext.businessSource === 'glossylooks' &&
        (code === 'glossylooks' || code.includes('glossy'))
      ) {
        return true;
      }
      if (
        callerContext.businessSource === 'mozz' &&
        (code === 'mozz' || code.includes('mozz'))
      ) {
        return true;
      }
      return false;
    }

    // Authenticated outlet admins are authorized only for outlets in their adminOutletIds
    return (
      callerContext.adminOutletIds.includes(outletId) ||
      (Boolean(outletCode) && callerContext.adminOutletIds.includes(outletCode!))
    );
  }

  // Requirement 5: Helper to resolve and validate an Auth user by userId or email
  async function findAuthUser(identifier: { id?: string; email?: string }) {
    if (identifier.id) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(identifier.id);
      if (!error && data?.user) return data.user;
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

        // 2. Protect existing SUPERADMIN profile (Requirement 7)
        const { data: existingProfile } = await supabaseAdmin
          .from('smav_profiles')
          .select('id, full_name, platform_role, is_active, created_at')
          .eq('id', targetUser.id)
          .maybeSingle();

        const isSuperadminProfile = existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN' ||
          cleanEmail === 'kpsrikanthreddy@gmail.com' ||
          cleanEmail === 'superadmin@smav.io';
        const targetPlatformRole = isSuperadminProfile ? 'SUPERADMIN' : 'OUTLET_USER';

        // 3. Upsert smav_profiles with confirmed schema columns only (id, full_name, platform_role, is_active, created_at)
        if (existingProfile) {
          const { error: profileError } = await supabaseAdmin
            .from('smav_profiles')
            .update({
              full_name: fullName || existingProfile.full_name,
              platform_role: isSuperadminProfile ? 'SUPERADMIN' : targetPlatformRole,
              is_active: true
            })
            .eq('id', targetUser.id);

          if (profileError) {
            return errorResponse(`Failed to update profile: ${profileError.message}`, 400);
          }
        } else {
          const { error: profileError } = await supabaseAdmin
            .from('smav_profiles')
            .insert({
              id: targetUser.id,
              full_name: fullName || cleanEmail.split('@')[0],
              platform_role: targetPlatformRole,
              is_active: true,
              created_at: new Date().toISOString()
            });

          if (profileError) {
            return errorResponse(`Failed to create profile: ${profileError.message}`, 400);
          }
        }

        // 4. Assign ADMIN role in smav_user_outlet_roles (Confirmed schema: id, user_id, outlet_id, role, is_active, external_staff_id, business_source, linked_at, metadata)
        const { data: existingRole } = await supabaseAdmin
          .from('smav_user_outlet_roles')
          .select('id')
          .eq('user_id', targetUser.id)
          .eq('outlet_id', outlet.id)
          .maybeSingle();

        const rolePayload = {
          user_id: targetUser.id,
          outlet_id: outlet.id,
          role: 'ADMIN',
          business_source: 'central',
          is_active: true,
          linked_at: new Date().toISOString(),
          metadata: {
            title: 'Outlet Administrator',
            permissions: ['pos:create_bill', 'pos:print_receipt', 'pos:manage_staff', 'pos:view_reports']
          }
        };

        if (existingRole?.id) {
          const { error: roleError } = await supabaseAdmin
            .from('smav_user_outlet_roles')
            .update(rolePayload)
            .eq('id', existingRole.id);

          if (roleError) {
            return errorResponse(`Failed to update outlet admin role: ${roleError.message}`, 400);
          }
        } else {
          const { error: roleError } = await supabaseAdmin
            .from('smav_user_outlet_roles')
            .insert(rolePayload);

          if (roleError) {
            return errorResponse(`Failed to assign outlet admin role: ${roleError.message}`, 400);
          }
        }

        // 5. Map username in smav_external_identities if provided
        if (username) {
          const { error: identError } = await supabaseAdmin.from('smav_external_identities').upsert(
            {
              username: String(username).trim().toLowerCase(),
              email: cleanEmail,
              user_id: targetUser.id,
              source: outlet.code || outlet.outlet_code || 'central',
              outlet_code: outlet.code || outlet.outlet_code,
              external_role: 'ADMIN',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'username,source' }
          );

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

        // 2. Protect existing SUPERADMIN profile (Requirement 7)
        const { data: existingProfile } = await supabaseAdmin
          .from('smav_profiles')
          .select('id, full_name, platform_role, is_active, created_at')
          .eq('id', targetUser.id)
          .maybeSingle();

        const isSuperadminProfile = existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN' ||
          cleanEmail === 'kpsrikanthreddy@gmail.com' ||
          cleanEmail === 'superadmin@smav.io';
        const targetPlatformRole = isSuperadminProfile ? 'SUPERADMIN' : 'OUTLET_USER';

        // 3. Upsert smav_profiles with confirmed schema columns only (id, full_name, platform_role, is_active, created_at)
        if (existingProfile) {
          const { error: profileError } = await supabaseAdmin
            .from('smav_profiles')
            .update({
              full_name: fullName || existingProfile.full_name,
              platform_role: isSuperadminProfile ? 'SUPERADMIN' : targetPlatformRole,
              is_active: true
            })
            .eq('id', targetUser.id);

          if (profileError) {
            return errorResponse(`Failed to update profile: ${profileError.message}`, 400);
          }
        } else {
          const { error: profileError } = await supabaseAdmin
            .from('smav_profiles')
            .insert({
              id: targetUser.id,
              full_name: fullName || cleanEmail.split('@')[0],
              platform_role: targetPlatformRole,
              is_active: true,
              created_at: new Date().toISOString()
            });

          if (profileError) {
            return errorResponse(`Failed to create profile: ${profileError.message}`, 400);
          }
        }

        // 4. Upsert smav_user_outlet_roles with confirmed schema columns only:
        // id, user_id, outlet_id, role, is_active, external_staff_id, business_source, linked_at, metadata
        const { data: existingRole } = await supabaseAdmin
          .from('smav_user_outlet_roles')
          .select('id')
          .eq('user_id', targetUser.id)
          .eq('outlet_id', outlet.id)
          .maybeSingle();

        const rolePayload = {
          user_id: targetUser.id,
          outlet_id: outlet.id,
          role: 'STAFF',
          external_staff_id: externalStaffId ? String(externalStaffId) : null,
          business_source: callerContext.businessSource || 'central',
          is_active: true,
          linked_at: new Date().toISOString(),
          metadata: {
            title: 'Outlet Staff Member',
            permissions: ['pos:create_bill', 'pos:print_receipt']
          }
        };

        if (existingRole?.id) {
          const { error: roleError } = await supabaseAdmin
            .from('smav_user_outlet_roles')
            .update(rolePayload)
            .eq('id', existingRole.id);

          if (roleError) {
            return errorResponse(`Failed to update staff role: ${roleError.message}`, 400);
          }
        } else {
          const { error: roleError } = await supabaseAdmin
            .from('smav_user_outlet_roles')
            .insert(rolePayload);

          if (roleError) {
            return errorResponse(`Failed to assign staff role: ${roleError.message}`, 400);
          }
        }

        // 5. Record external identity if username provided
        if (username) {
          const { error: identError } = await supabaseAdmin.from('smav_external_identities').upsert(
            {
              username: String(username).trim().toLowerCase(),
              email: cleanEmail,
              user_id: targetUser.id,
              source: outlet.code || outlet.outlet_code || 'central',
              outlet_code: outlet.code || outlet.outlet_code,
              external_staff_id: externalStaffId ? String(externalStaffId) : null,
              external_role: externalRole || 'STAFF',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'username,source' }
          );

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
      // Requirement 1: Confirmed schema smav_profiles (id, full_name, platform_role, is_active, created_at)
      //                and smav_user_outlet_roles (id, user_id, outlet_id, role, is_active, external_staff_id, business_source, linked_at, metadata)
      // Requirement 2: Reuse existing Auth users without changing passwords
      // Requirement 3: Create missing profiles idempotently
      // Requirement 4: Map OWNER/MANAGER -> ADMIN, STYLIST/RECEPTIONIST -> STAFF
      // Requirement 5: Resolve outlet IDs from smav_outlets using outlet_code
      // Requirement 6: Verify identity and role against production source (do not infer from email)
      // Requirement 7: Preserve SUPERADMIN profiles and permissions
      // Requirement 8: Report per-user errors and successful assignment counts
      // ==============================================================================
      case 'sync-glossylooks':
      case 'sync_glossylooks': {
        // Enforce synchronization authorization
        if (
          !callerContext.isSuperadmin &&
          callerContext.businessSource !== 'glossylooks' &&
          !canManageOutlet('', 'glossylooks')
        ) {
          return errorResponse('Forbidden: Unauthorized for Glossy Looks synchronization', 403);
        }

        const outlet = await resolveOutlet('glossylooks');
        if (!outlet) {
          return errorResponse('Glossy Looks outlet with outlet_code "glossylooks" not found in smav_outlets', 404);
        }

        // Requirement 2: Fetch existing Auth users to reuse without resetting passwords
        const { data: authUsersData, error: authListErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (authListErr) {
          return errorResponse(`Failed to query existing Auth users: ${authListErr.message}`, 500);
        }
        const existingAuthUsers = authUsersData?.users || [];
        const authUserByEmail = new Map<string, any>();
        for (const u of existingAuthUsers) {
          if (u.email) {
            authUserByEmail.set(u.email.toLowerCase(), u);
          }
        }

        const staffItems: any[] = Array.isArray(body.staff) ? body.staff : [body];
        const syncResults: any[] = [];
        const syncErrors: any[] = [];
        let assignedCount = 0;
        let superadminsPreserved = 0;

        for (const item of staffItems) {
          const email = (item.email || '').trim().toLowerCase();
          if (!email) {
            syncErrors.push({ email: 'unknown', error: 'Missing email in production staff record' });
            continue;
          }

          const name = String(item.name || item.fullName || email.split('@')[0]);
          const rawRole = String(item.role || item.assignedRole || '');
          const externalStaffId = item.id || item.externalStaffId || item.staff_id;
          const username = item.username || email.split('@')[0];
          const isActive =
            item.isActive !== false &&
            item.is_active !== false &&
            item.status !== 'inactive';

          // Requirement 4 & 6: Map strictly from production staff role; never infer from email
          const { smavRole, title } = mapPortalRoleToSmav(rawRole, 'glossylooks');

          try {
            // Requirement 2: Reuse existing Auth user without changing password
            let user = authUserByEmail.get(email);
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
                authUserByEmail.set(email, user);
              } else {
                syncErrors.push({ email, error: createErr?.message || 'Auth user creation failed' });
                continue;
              }
            }

            // Requirement 3 & 7: Check existing profile and preserve SUPERADMIN
            // smav_profiles confirmed columns: id, full_name, platform_role, is_active, created_at
            const { data: existingProfile } = await supabaseAdmin
              .from('smav_profiles')
              .select('id, full_name, platform_role, is_active, created_at')
              .eq('id', user.id)
              .maybeSingle();

            const isSuperadminProfile =
              existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN' ||
              email === 'kpsrikanthreddy@gmail.com' ||
              email === 'superadmin@smav.io';

            if (isSuperadminProfile) {
              superadminsPreserved++;
            }

            const targetPlatformRole = isSuperadminProfile ? 'SUPERADMIN' : (smavRole === 'ADMIN' ? 'ADMIN' : 'OUTLET_USER');

            if (existingProfile) {
              const { error: profileError } = await supabaseAdmin
                .from('smav_profiles')
                .update({
                  full_name: name,
                  platform_role: isSuperadminProfile ? 'SUPERADMIN' : targetPlatformRole,
                  is_active: isActive,
                })
                .eq('id', user.id);

              if (profileError) {
                syncErrors.push({ email, error: `Failed to update smav_profiles: ${profileError.message}` });
                continue;
              }
            } else {
              const { error: profileError } = await supabaseAdmin
                .from('smav_profiles')
                .insert({
                  id: user.id,
                  full_name: name,
                  platform_role: targetPlatformRole,
                  is_active: isActive,
                  created_at: new Date().toISOString(),
                });

              if (profileError) {
                syncErrors.push({ email, error: `Failed to insert smav_profiles: ${profileError.message}` });
                continue;
              }
            }

            // Requirement 1 & 4: Upsert smav_user_outlet_roles with confirmed schema
            // Columns: id, user_id, outlet_id, role, is_active, external_staff_id, business_source, linked_at, metadata
            const { data: existingRole } = await supabaseAdmin
              .from('smav_user_outlet_roles')
              .select('id')
              .eq('user_id', user.id)
              .eq('outlet_id', outlet.id)
              .maybeSingle();

            const rolePayload = {
              user_id: user.id,
              outlet_id: outlet.id,
              role: smavRole,
              is_active: isActive,
              external_staff_id: externalStaffId ? String(externalStaffId) : null,
              business_source: 'glossylooks',
              linked_at: new Date().toISOString(),
              metadata: {
                production_role: rawRole,
                specific_title: title,
                permissions: smavRole === 'ADMIN'
                  ? ['pos:create_bill', 'pos:print_receipt', 'pos:manage_staff', 'pos:view_reports']
                  : ['pos:create_bill', 'pos:print_receipt']
              }
            };

            if (existingRole?.id) {
              const { error: roleError } = await supabaseAdmin
                .from('smav_user_outlet_roles')
                .update(rolePayload)
                .eq('id', existingRole.id);

              if (roleError) {
                syncErrors.push({ email, error: `Failed to update smav_user_outlet_roles: ${roleError.message}` });
                continue;
              }
            } else {
              const { error: roleError } = await supabaseAdmin
                .from('smav_user_outlet_roles')
                .insert(rolePayload);

              if (roleError) {
                syncErrors.push({ email, error: `Failed to insert smav_user_outlet_roles: ${roleError.message}` });
                continue;
              }
            }

            // Optional external identity mapping
            if (username) {
              try {
                await supabaseAdmin.from('smav_external_identities').upsert(
                  {
                    username: String(username).toLowerCase(),
                    email,
                    user_id: user.id,
                    source: 'glossylooks',
                    outlet_code: outlet.outlet_code || 'glossylooks',
                    external_staff_id: externalStaffId ? String(externalStaffId) : null,
                    external_role: rawRole,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: 'username,source' }
                );
              } catch (_e) {}
            }

            assignedCount++;
            syncResults.push({
              email,
              name,
              smavRole,
              productionRole: rawRole,
              isNewUser,
              outletCode: outlet.outlet_code || 'glossylooks',
              status: 'assigned',
            });
          } catch (itemErr: any) {
            syncErrors.push({ email, error: itemErr.message || 'Processing error' });
          }
        }

        return jsonResponse({
          success: syncResults.length > 0 || staffItems.length === 0,
          message: `Successfully synchronized ${assignedCount} Glossy Looks staff members (${assignedCount} assigned, ${superadminsPreserved} Superadmins preserved, ${syncErrors.length} errors).`,
          total: staffItems.length,
          assigned: assignedCount,
          preservedSuperadmins: superadminsPreserved,
          outlet: outlet.outlet_name || outlet.name,
          outletCode: outlet.outlet_code,
          results: syncResults,
          errors: syncErrors,
        });
      }

      // ==============================================================================
      // 4. SYNCHRONIZE MOZZ / STARTERS4U STAFF
      // Requirement 9: Preserve MOZZ integration with confirmed schema
      // ==============================================================================
      case 'sync-mozz':
      case 'sync_mozz': {
        // Enforce synchronization authorization
        if (
          !callerContext.isSuperadmin &&
          callerContext.businessSource !== 'mozz' &&
          !canManageOutlet('', 'mozz')
        ) {
          return errorResponse('Forbidden: Unauthorized for MOZZ synchronization', 403);
        }

        const outlet = await resolveOutlet('mozz');
        if (!outlet) {
          return errorResponse('MOZZ outlet with outlet_code "mozz" not found in smav_outlets', 404);
        }

        // Query existing Auth users to reuse without resetting passwords
        const { data: authUsersData, error: authListErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (authListErr) {
          return errorResponse(`Failed to query existing Auth users: ${authListErr.message}`, 500);
        }
        const existingAuthUsers = authUsersData?.users || [];
        const authUserByEmail = new Map<string, any>();
        for (const u of existingAuthUsers) {
          if (u.email) {
            authUserByEmail.set(u.email.toLowerCase(), u);
          }
        }

        const staffItems: any[] = Array.isArray(body.staff) ? body.staff : [body];
        const syncResults: any[] = [];
        const syncErrors: any[] = [];
        let assignedCount = 0;
        let superadminsPreserved = 0;

        for (const item of staffItems) {
          const email = (item.email || '').trim().toLowerCase();
          if (!email) {
            syncErrors.push({ email: 'unknown', error: 'Missing email in restaurant staff record' });
            continue;
          }

          const name = item.name || item.fullName || email.split('@')[0];
          const rawRole = item.role || item.assignedRole || 'CASHIER';
          const externalStaffId = item.id || item.externalStaffId || item.staff_id;
          const username = item.username || email.split('@')[0];
          const isActive =
            item.isActive !== false &&
            item.is_active !== false &&
            item.status !== 'inactive';

          // Map strictly from production staff role
          const { smavRole, title } = mapPortalRoleToSmav(rawRole, 'mozz');

          try {
            // Reuse existing Auth user without changing password
            let user = authUserByEmail.get(email);
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
                authUserByEmail.set(email, user);
              } else {
                syncErrors.push({ email, error: createErr?.message || 'Auth user creation failed' });
                continue;
              }
            }

            // Check and update/insert smav_profiles with confirmed schema only
            const { data: existingProfile } = await supabaseAdmin
              .from('smav_profiles')
              .select('id, full_name, platform_role, is_active, created_at')
              .eq('id', user.id)
              .maybeSingle();

            const isSuperadminProfile =
              existingProfile?.platform_role?.toUpperCase() === 'SUPERADMIN' ||
              email === 'kpsrikanthreddy@gmail.com' ||
              email === 'superadmin@smav.io';

            if (isSuperadminProfile) {
              superadminsPreserved++;
            }

            const targetPlatformRole = isSuperadminProfile ? 'SUPERADMIN' : (smavRole === 'ADMIN' ? 'ADMIN' : 'OUTLET_USER');

            if (existingProfile) {
              const { error: profileError } = await supabaseAdmin
                .from('smav_profiles')
                .update({
                  full_name: name,
                  platform_role: isSuperadminProfile ? 'SUPERADMIN' : targetPlatformRole,
                  is_active: isActive,
                })
                .eq('id', user.id);

              if (profileError) {
                syncErrors.push({ email, error: `Failed to update smav_profiles: ${profileError.message}` });
                continue;
              }
            } else {
              const { error: profileError } = await supabaseAdmin
                .from('smav_profiles')
                .insert({
                  id: user.id,
                  full_name: name,
                  platform_role: targetPlatformRole,
                  is_active: isActive,
                  created_at: new Date().toISOString(),
                });

              if (profileError) {
                syncErrors.push({ email, error: `Failed to insert smav_profiles: ${profileError.message}` });
                continue;
              }
            }

            // Upsert smav_user_outlet_roles with confirmed schema only
            const { data: existingRole } = await supabaseAdmin
              .from('smav_user_outlet_roles')
              .select('id')
              .eq('user_id', user.id)
              .eq('outlet_id', outlet.id)
              .maybeSingle();

            const rolePayload = {
              user_id: user.id,
              outlet_id: outlet.id,
              role: smavRole,
              is_active: isActive,
              external_staff_id: externalStaffId ? String(externalStaffId) : null,
              business_source: 'mozz',
              linked_at: new Date().toISOString(),
              metadata: {
                production_role: rawRole,
                specific_title: title,
                permissions: smavRole === 'ADMIN'
                  ? ['pos:create_bill', 'pos:print_receipt', 'pos:manage_staff', 'pos:view_reports']
                  : ['pos:create_bill', 'pos:print_receipt']
              }
            };

            if (existingRole?.id) {
              const { error: roleError } = await supabaseAdmin
                .from('smav_user_outlet_roles')
                .update(rolePayload)
                .eq('id', existingRole.id);

              if (roleError) {
                syncErrors.push({ email, error: `Failed to update smav_user_outlet_roles: ${roleError.message}` });
                continue;
              }
            } else {
              const { error: roleError } = await supabaseAdmin
                .from('smav_user_outlet_roles')
                .insert(rolePayload);

              if (roleError) {
                syncErrors.push({ email, error: `Failed to insert smav_user_outlet_roles: ${roleError.message}` });
                continue;
              }
            }

            // Optional external identity mapping
            if (username) {
              try {
                await supabaseAdmin.from('smav_external_identities').upsert(
                  {
                    username: String(username).toLowerCase(),
                    email,
                    user_id: user.id,
                    source: 'mozz',
                    outlet_code: outlet.outlet_code || 'mozz',
                    external_staff_id: externalStaffId ? String(externalStaffId) : null,
                    external_role: rawRole,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: 'username,source' }
                );
              } catch (_e) {}
            }

            assignedCount++;
            syncResults.push({
              email,
              name,
              smavRole,
              productionRole: rawRole,
              isNewUser,
              outletCode: outlet.outlet_code || 'mozz',
              status: 'assigned',
            });
          } catch (itemErr: any) {
            syncErrors.push({ email, error: itemErr.message || 'Processing error' });
          }
        }

        return jsonResponse({
          success: syncResults.length > 0 || staffItems.length === 0,
          message: `Successfully synchronized ${assignedCount} MOZZ staff members (${assignedCount} assigned, ${superadminsPreserved} Superadmins preserved, ${syncErrors.length} errors).`,
          total: staffItems.length,
          assigned: assignedCount,
          preservedSuperadmins: superadminsPreserved,
          outlet: outlet.outlet_name || outlet.name,
          outletCode: outlet.outlet_code,
          results: syncResults,
          errors: syncErrors,
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

        // Requirement 4: Outlet admins CANNOT reset a Superadmin's password
        if (isTargetSuperadmin && !callerContext.isSuperadmin && callerContext.callerUserId !== targetUserId) {
          return errorResponse(
            'Forbidden: Only a SUPERADMIN or the user themselves can reset a Superadmin password',
            403
          );
        }

        // Requirement 3: Outlet-level authorization enforcement
        const isSelf = callerContext.callerUserId === targetUserId;
        if (!callerContext.isSuperadmin && !isSelf) {
          if (callerContext.isServiceOrBackend) {
            // Backend integration must verify user belongs to their outlet
            const { data: checkRoles } = await supabaseAdmin
              .from('smav_user_outlet_roles')
              .select('outlet_id, business_source')
              .eq('user_id', targetUserId)
              .eq('is_active', true);

            const hasSourceOutlet = (checkRoles || []).some(
              (r: any) =>
                r.business_source === callerContext.businessSource ||
                (callerContext.businessSource === 'glossylooks' && r.outlet_id === 'a0000000-0000-0000-0000-000000000001') ||
                (callerContext.businessSource === 'mozz' && r.outlet_id === 'b0000000-0000-0000-0000-000000000001')
            );

            if (!hasSourceOutlet) {
              return errorResponse(
                'Forbidden: Target user is not registered under your business source',
                403
              );
            }
          } else {
            // Regular Outlet Admin caller: target user MUST belong to an outlet the caller administers
            const { data: userOutletRoles } = await supabaseAdmin
              .from('smav_user_outlet_roles')
              .select('outlet_id')
              .eq('user_id', targetUserId)
              .eq('is_active', true);

            const targetOutletIds = (userOutletRoles || []).map((r: any) => String(r.outlet_id));
            const hasSharedAdminOutlet = callerContext.adminOutletIds.some((id) =>
              targetOutletIds.includes(id)
            );

            if (!hasSharedAdminOutlet) {
              return errorResponse(
                'Forbidden: You are not authorized to reset passwords for staff outside your administered outlets',
                403
              );
            }
          }
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

        // Email is stored in auth.users, fetch user emails
        const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const emailMap = new Map((authData?.users || []).map((u: any) => [u.id, u.email]));

        return jsonResponse({
          success: true,
          count: (staffList || []).length,
          staff: (staffList || []).map((r: any) => ({
            userId: r.user_id,
            email: emailMap.get(r.user_id) || '',
            fullName: r.smav_profiles?.full_name || '',
            role: r.role,
            outletId: r.outlet_id,
            outletCode: r.smav_outlets?.outlet_code || r.smav_outlets?.code,
            outletName: r.smav_outlets?.outlet_name || r.smav_outlets?.name,
            outletCategory:
              r.smav_outlets?.business_type?.toLowerCase() ||
              r.smav_outlets?.category ||
              'other',
            externalStaffId: r.external_staff_id,
            businessSource: r.business_source,
            isActive: r.is_active,
            permissions: r.metadata?.permissions || [],
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
              permissions: r.metadata?.permissions || [],
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
          `Unknown action "${action}". Valid actions: create-admin, create-staff, set-status, reset-password, sync-glossylooks, sync-mozz, get-info, list-staff`,
          400
        );
    }
  } catch (err: any) {
    console.error('[smav-identity-admin] Unexpected exception:', err);
    return errorResponse(`Internal server error: ${err?.message || 'Unknown error'}`, 500);
  }
});
