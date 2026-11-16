# SMAV Multi-Outlet Unified User Management Integration Guide

This guide covers bidirectional, loop-safe user synchronization between:
- **Central SMAV Supabase (`qykdwswatopylzvqhgog`)** — Authoritative Auth (`auth.users`), profiles, outlet roles, identity mappings, and `smav_sync_outbox`.
- **The Glossy Looks (`onswigwiwuvkvoduuhxr`)**
- **MOZZ / Starters4U (`uyqdnqbadfysnbzbncyj`)**
- **Future Outlets** (Salons, Restaurants, Retail Stores, or custom outlets)
- **SMAV Print Agent** (`server.ts` + React Admin/Superadmin UI)

---

## 1. Architecture Rules

1. **Single-Source Admin Onboarding**:
   An authorized admin adds a user with **Full Name, Username, Email, Role (`ADMIN` or `STAFF`), and Initial Password** directly via the server-side API. Activation-link / email-invite workflows are removed from standard onboarding.
2. **Mandatory Password Change on First Sign-In**:
   Admin-assigned initial or reset passwords set `user_metadata.must_change_password = true` in Central Supabase Auth. When the user signs in for the first time, SMAV prompts them to set a personal password before issuing a POS/Admin session.
3. **Zero Plaintext Password Persistence**:
   Passwords exist only transiently inside the HTTPS request body forwarded to Supabase Auth Admin APIs and are **never** written to `smav_sync_outbox`, `smav_audit_logs`, `smav_profiles`, or outlet tables.
4. **Deterministic Identity Matching (No Duplicates)**:
   Edits update the existing Central Auth UUID resolved in order:
   1. `userId` (Central Auth UUID)
   2. `smav_external_identities (source, external_id)`
   3. Exact email match in `auth.users` (fails closed with HTTP `409 Conflict` if ambiguous)
5. **Bidirectional Sync Without Loops**:
   - **Outlet Admin → SMAV**: Sends `X-SMAV-Sync-Origin: outlet_admin` and `X-Idempotency-Key` to `POST /api/integrations/outlets/:outletCode/users/sync`. SMAV updates Central Supabase, confirms both sides (`outletConfirmed = true`), and skips echoing back to that outlet.
   - **SMAV UI → Outlet**: Sends `X-SMAV-Sync-Origin: smav_portal` and pushes metadata/status to the outlet's configured webhook URL or direct outlet Supabase service-role client. If the outlet does not confirm, `smav_sync_outbox` records `PARTIAL_CENTRAL_ONLY` and schedules automatic retries.
6. **Strict Outlet Isolation & RBAC**:
   - `SUPERADMIN`: manages all outlets, can grant `ADMIN` or `STAFF`, never auto-promotes outlet owners to `SUPERADMIN`.
   - Outlet `ADMIN`: manages only users within assigned active outlets (`STAFF` only).
   - `STAFF` (`POS_BILLING`): billing & receipt printing only; no user-management permissions.

---

## 2. Reusable Outlet Portal Code (`integrations/shared/smav_outlet_user_adapter.ts`)

Use `GlossyLooksSmavAuthAdapter`, `MozzSmavAuthAdapter`, or `new SmavOutletUserAdapter({ outletCode: 'your_outlet', integrationKey, gatewayUrl })`:

```ts
import { SmavOutletUserAdapter } from './integrations/shared/smav_outlet_user_adapter';

const adapter = new SmavOutletUserAdapter({
  outletCode: 'my_retail_store',
  integrationKey: process.env.MY_RETAIL_INTEGRATION_KEY,
  gatewayUrl: process.env.SMAV_GATEWAY_URL, // e.g. SMAV Print Agent backend URL
});

// Create user cleanly from Outlet Admin page
const res = await adapter.upsertUser({
  externalStaffId: localUser.id,
  fullName: localUser.name,
  username: localUser.username,
  email: localUser.email,
  role: 'STAFF',
  initialPassword: formPassword,
});
```

### Handling Updates Pushed FROM SMAV Portal (`verifyIncomingSmavWebhook`)

```ts
app.post('/api/smav-sync-webhook', async (req, res) => {
  const check = adapter.verifyIncomingSmavWebhook(req.headers, req.body);
  if (!check.authorized) return res.status(401).json({ success: false, message: check.skipReason });
  if (!check.shouldApply) return res.json({ success: true, skipped: true, reason: check.skipReason });

  // Update local outlet DB row using central_auth_id = req.body.userId
  return res.json({ success: true, externalStaffId: updatedRow.id });
});
```

---

## 3. Separate Deployment Order

1. **Central SMAV Supabase (`qykdwswatopylzvqhgog`)**: Apply `database/migrations/012_unified_user_sync_and_outbox.sql` and deploy updated `supabase/functions/smav-identity-admin/index.ts`.
2. **The Glossy Looks (`onswigwiwuvkvoduuhxr`)**: Apply `database/migrations/glossylooks_central_auth_link.sql` and wire `GlossyLooksSmavAuthAdapter` + env `GLOSSYLOOKS_INTEGRATION_KEY`.
3. **MOZZ / Starters4U (`uyqdnqbadfysnbzbncyj`)**: Apply `database/migrations/mozz_central_auth_link.sql` and wire `MozzSmavAuthAdapter` + env `MOZZ_INTEGRATION_KEY`.
4. **Future Outlets**: Apply `database/migrations/template_outlet_central_auth_link.sql`, register outlet in SMAV Superadmin UI (`outlet_code` + optional `syncWebhookUrl`), and configure `OUTLET_<CODE>_INTEGRATION_KEY`.
5. **SMAV Print Agent**: Configure `.env` keys (`SMAV_SUPABASE_URL`, `SMAV_SUPABASE_ANON_KEY`, `SMAV_SERVICE_ROLE_KEY`, outlet integration keys/webhooks or Supabase service keys) and restart server.
