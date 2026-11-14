# Central SMAV Supabase Edge Function & Authentication Integration Guide

This guide documents the deployment and integration of the **`smav-identity-admin`** Supabase Edge Function, the database migration for external identity federation, and the backend adapters for **The Glossy Looks** and **MOZZ / Starters4U**.

---

## 1. Edge Function Overview

* **Function Name**: `smav-identity-admin`
* **Source Location**: `supabase/functions/smav-identity-admin/index.ts`
* **Target Project**: Central SMAV Supabase (`https://qykdwswatopylzvqhgog.supabase.co`)
* **Endpoint URL**: `https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin`
* **Security Model**:
  * Utilizes `SUPABASE_SERVICE_ROLE_KEY` inside Deno runtime only.
  * Validates caller's Supabase JWT Bearer token and server-side RBAC:
    * `SUPERADMIN`: Full administrative control across all registered outlets.
    * `ADMIN`: Strictly authorized only for their assigned outlet(s).
    * `STAFF`: Blocked from privileged administrative actions (403 Forbidden).
  * Validates `X-Integration-Key` + `X-Business-Source` for trusted backend-to-backend synchronization from Glossy Looks and MOZZ backends.

---

## 2. Supabase Edge Function Deployment Steps

### Step 2.1: Login with Supabase CLI
```bash
# Login to your Supabase account
supabase login
```

### Step 2.2: Link to Central SMAV Project
```bash
supabase link --project-ref qykdwswatopylzvqhgog
```

### Step 2.3: Set Edge Function Secrets
Set the required server-side secrets in the Central SMAV Supabase project:
```bash
supabase secrets set \
  GLOSSYLOOKS_INTEGRATION_KEY="your-glossylooks-backend-secret-key" \
  MOZZ_INTEGRATION_KEY="your-mozz-backend-secret-key" \
  SMAV_GATEWAY_SECRET="your-smav-gateway-secret"
```
*(Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by Supabase into Edge Function environments).*

### Step 2.4: Deploy the Function
```bash
supabase functions deploy smav-identity-admin --no-verify-jwt
```
*(Note: JWT verification is handled inside the function logic to support both user JWTs and server-to-server integration keys with proper CORS headers).*

---

## 3. Database Migration Deployment

Open your **Central SMAV Supabase Dashboard → SQL Editor** (`https://qykdwswatopylzvqhgog.supabase.co`) and run the additive Phase 1 migration:

* **File**: `database/migrations/011_phase1_central_login_roles_rls.sql`

This migration enforces:
1. Non-recursive `SECURITY DEFINER` RLS helper functions across `smav_profiles`, `smav_outlets`, `smav_user_outlet_roles`, `smav_devices`, `smav_audit_logs`, `smav_salon_bills`, and `smav_external_identities`.
2. Strict `STAFF`-only management by outlet `ADMIN`s (`SUPERADMIN`-exclusive `ADMIN` grant/revoke).
3. Trusted `service_role`-only writes to `smav_audit_logs`.
*(Obsolete unapplied scripts `004_central_smav_auth_gateway.sql` and `010_central_edge_identity_and_sync.sql` have been moved to `database/migrations/archive/`.)*

---

## 4. Glossy Looks Admin Portal Integration (`glossylooks.in`)

Copy the adapter to The Glossy Looks codebase:
* **File**: `integrations/glossylooks/glossylooks_smav_auth_adapter.ts`

### Usage in Glossy Looks Backend (`glossylooks.in/admin/settings/users`):
```typescript
import { GlossyLooksSmavAuthAdapter } from './glossylooks_smav_auth_adapter';

const smavAdapter = new GlossyLooksSmavAuthAdapter({
  edgeFunctionUrl: 'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin',
  integrationKey: process.env.GLOSSYLOOKS_INTEGRATION_KEY, // Server-side secret only
  outletCode: 'glossylooks'
});

// When an owner creates or updates a staff member:
export async function onStaffCreatedOrUpdated(staffMember: any) {
  const syncResult = await smavAdapter.syncStaffMember({
    externalStaffId: staffMember.id,
    email: staffMember.email,
    fullName: staffMember.name,
    phone: staffMember.phone,
    role: staffMember.role, // 'OWNER' | 'MANAGER' | 'STYLIST' | 'RECEPTIONIST'
    username: staffMember.username,
    isActive: staffMember.status === 'active'
  });

  if (!syncResult.success) {
    console.error('Failed to sync staff with SMAV:', syncResult.message);
  }
}
```

---

## 5. MOZZ / Starters4U Admin Portal Integration (`starters4u.in`)

Copy the adapter to the MOZZ / Starters4U codebase:
* **File**: `integrations/mozz/mozz_smav_auth_adapter.ts`

### Usage in MOZZ Backend:
```typescript
import { MozzSmavAuthAdapter } from './mozz_smav_auth_adapter';

const smavAdapter = new MozzSmavAuthAdapter({
  edgeFunctionUrl: 'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin',
  integrationKey: process.env.MOZZ_INTEGRATION_KEY, // Server-side secret only
  outletCode: 'mozz'
});

// When a manager creates or updates a restaurant staff member:
export async function onRestaurantStaffCreated(staffMember: any) {
  const syncResult = await smavAdapter.syncStaffMember({
    externalStaffId: staffMember.id,
    email: staffMember.email,
    fullName: staffMember.name,
    phone: staffMember.phone,
    role: staffMember.role, // 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER'
    username: staffMember.username,
    isActive: staffMember.is_active !== false
  });

  if (!syncResult.success) {
    console.error('Failed to sync restaurant staff with SMAV:', syncResult.message);
  }
}
```

---

## 6. Environment Variable Checklist

| Environment Variable | Where Configured | Purpose | Sensitive? |
|---|---|---|---|
| `VITE_SMAV_SUPABASE_URL` | Frontend & Applet | Central Supabase Project URL (`https://qykdwswatopylzvqhgog.supabase.co`) | No (Public) |
| `VITE_SMAV_SUPABASE_ANON_KEY` | Frontend & Applet | Supabase publishable anonymous key | No (Publishable) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function Secret & Server | Admin privileges for Auth user management | **YES (Secret)** |
| `GLOSSYLOOKS_INTEGRATION_KEY`| Edge Function Secret & Glossy Backend | Trust token for Glossy Looks staff sync | **YES (Secret)** |
| `MOZZ_INTEGRATION_KEY` | Edge Function Secret & MOZZ Backend | Trust token for MOZZ restaurant staff sync | **YES (Secret)** |

---

## 7. End-to-End Acceptance Verification

1. **Superadmin Login**:
   * Log in with `superadmin@smav.io` (or your central Superadmin account).
   * Verified redirected to `/superadmin/outlets`.
2. **Outlet Admin Creation via Edge Function**:
   * In Superadmin Dashboard → Administrators, click **+ Add Administrator**.
   * Creates the user in Supabase Auth via Edge Function without exposing service-role keys.
3. **Staff Creation via Edge Function**:
   * Log in as an Outlet Admin (e.g. `ramesh@glossylooks.com` or `manager@starters4u.in`).
   * In Admin Dashboard → Staff, click **+ Add Staff Member**.
   * Created staff is immediately visible in the active staff directory.
4. **Portal Synchronization**:
   * Navigate to **Superadmin Dashboard → Multi-Portal Shared Auth & Testing**.
   * Test simulated provisioning for Glossy Looks and MOZZ.
   * Verify shared identity federation for multi-business accounts.
5. **POS Tenant Boundary Isolation**:
   * Salon staff access ONLY Salon POS (Services, Stylists, Appointments).
   * Restaurant staff access ONLY Restaurant POS (Menu, Orders, KOT, Tables).

---

## 8. Troubleshooting HTTP 401 Unauthorized Errors in Staff Synchronization

If staff synchronization returns HTTP 401, identify the origin using the diagnostic guidelines below:

### Origin A: Supabase API Gateway (Kong) HTTP 401
* **Symptom**: `UNAUTHORIZED_NO_AUTH_HEADER` or `sb-error-code: UNAUTHORIZED_NO_AUTH_HEADER` with message *"Missing authorization header"*.
* **Cause**: By default, Supabase Kong gateway enforces JWT validation on all edge functions and rejects requests lacking a signed Supabase user JWT before the Edge Function code runs.
* **Resolution**:
  Deploy the Edge Function with the `--no-verify-jwt` flag so Kong forwards the request directly to the function code:
  ```bash
  npx supabase functions deploy smav-identity-admin --no-verify-jwt --project-ref qykdwswatopylzvqhgog
  ```
  Additionally, ensure request headers include `apikey: <central_anon_key>`.

### Origin B: Edge Function Authorization Logic HTTP 401
* **Symptom**: Response contains `code: "UNAUTHORIZED_MISSING_CREDENTIALS"` or `code: "UNAUTHORIZED_INVALID_TOKEN"`.
* **Cause**:
  1. For interactive SMAV requests: The user is not authenticated or their JWT expired. Ensure the user is signed in so `Authorization: Bearer <user_jwt>` is attached.
  2. For backend synchronization (`glossylooks` / `mozz`): `X-Integration-Key` header does not match the secret in Supabase environment secrets.
* **Resolution**:
  Configure the integration secret in Supabase:
  ```bash
  npx supabase secrets set \
    GLOSSYLOOKS_INTEGRATION_KEY="your-glossylooks-backend-secret" \
    MOZZ_INTEGRATION_KEY="your-mozz-backend-secret" \
    --project-ref qykdwswatopylzvqhgog
  ```
