# SMAV Central Enterprise Authentication Integration Guide

This guide documents how **The Glossy Looks Admin Portal** (`https://www.glossylooks.in`) and the **MOZZ / Starters4U Admin Portal** (`https://www.starters4u.in`) connect to the **Central SMAV Supabase Auth Gateway**.

---

## 1. Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │        CENTRAL SMAV SUPABASE AUTH            │
                      │  - auth.users (Single authoritative ID)      │
                      │  - public.smav_profiles                      │
                      │  - public.smav_user_outlet_roles             │
                      │  - public.smav_outlets                       │
                      └──────────────────────┬───────────────────────┘
                                             │
                       Central Auth REST API Gateway
                                             │
       ┌─────────────────────────────────────┼─────────────────────────────────────┐
       │                                     │                                     │
       ▼                                     ▼                                     ▼
┌─────────────────────────┐       ┌─────────────────────────┐       ┌─────────────────────────┐
│   SMAV PRINT AGENT      │       │   THE GLOSSY LOOKS      │       │     MOZZ / STARTERS4U   │
│   (POS & Gateway)       │       │   Admin Portal          │       │     Admin Portal        │
│                         │       │                         │       │                         │
│ • Superadmin Console    │       │ • Staff Creation Hook   │       │ • Staff Creation Hook   │
│ • Salon POS (/pos)      │       │ • Salon Catalog & Appts │       │ • Restaurant Menu & KOT │
│ • Restaurant POS (/pos) │       │ • Local DB intact       │       │ • Local DB intact       │
└─────────────────────────┘       └─────────────────────────┘       └─────────────────────────┘
```

---

## 2. Key Principles & Security Rules

1. **Single Authoritative Authentication Provider**:
   All user credentials (email + password / PIN) are managed exclusively by **Central SMAV Supabase Auth**.
2. **Zero Plaintext Password Exposure**:
   Neither portal nor SMAV ever stores or transmits plaintext passwords. Passwords are only accepted during Supabase Auth `signInWithPassword` or through standard Supabase invitation / reset token workflows.
3. **No Duplicate Identity Creation**:
   If an email already exists in Central Auth (e.g. an owner with multiple businesses or an employee switching branches), Central SMAV links that existing `user_id` to the new outlet in `smav_user_outlet_roles` instead of failing or creating duplicates.
4. **Strict Outlet Isolation**:
   - Glossy Looks staff receive role assignments for `outlet_glossy_gach` (`category: 'salon'`) and can only access the **Salon POS** (services, stylists, appointments, salon billing).
   - MOZZ staff receive role assignments for `outlet_mozz_gach` (`category: 'restaurant'`) and can only access the **Restaurant POS** (menu, tables, KOT, restaurant billing).
   - Superadmin accounts access all outlets.
5. **Zero-Downtime Migration**:
   Existing operations in Glossy Looks and Starters4U continue uninterrupted. Each portal continues using its existing database for appointments, services, orders, and tables. Only staff authentication and POS linkage federate with SMAV.

---

## 3. Database Migrations

### A. Central SMAV Supabase
Run `database/migrations/009_shared_portal_authentication_and_linking.sql` in the Central Supabase project.

### B. The Glossy Looks Supabase (`onswigwiwuvkvoduuhxr.supabase.co`)
Run `database/migrations/glossylooks_central_auth_link.sql` in the SQL Editor.
- Adds `central_auth_id` to `public.staff` and `public.users`.
- Keeps all existing tables (`appointments`, `services`, `categories`, `staff`, `branches`) completely intact.

### C. MOZZ / Starters4U Supabase (`uyqdnqbadfysnbzbncyj.supabase.co`)
Run `database/migrations/mozz_central_auth_link.sql` in the SQL Editor.
- Adds `central_auth_id` to restaurant `staff` / `users`.
- Keeps all existing tables (`menu_items`, `orders`, `tables`, `branches`) completely intact.

---

## 4. Portal Code Integration

### The Glossy Looks Admin Portal
Copy `integrations/glossylooks/glossylooks_smav_auth_adapter.ts` to your portal's server or API directory.
When creating staff in `POST /api/admin/staff`:
```typescript
import { GlossyLooksSmavAuthAdapter } from './glossylooks_smav_auth_adapter';

const smavAdapter = new GlossyLooksSmavAuthAdapter({
  centralGatewayUrl: process.env.SMAV_GATEWAY_URL,
  gatewaySecret: process.env.SMAV_GATEWAY_SECRET
});

// Inside your create staff route:
const linkResult = await smavAdapter.provisionOrLinkStaff({
  externalStaffId: localStaffRecord.id,
  email: localStaffRecord.email,
  fullName: localStaffRecord.name,
  phone: localStaffRecord.phone,
  role: 'staff' // or 'admin'
});

// Update local record with central_auth_id
if (linkResult.success && linkResult.centralUserId) {
  await supabase
    .from('staff')
    .update({ 
      central_auth_id: linkResult.centralUserId,
      central_auth_status: 'ACTIVE',
      central_auth_linked_at: new Date().toISOString()
    })
    .eq('id', localStaffRecord.id);
}
```

### MOZZ / Starters4U Admin Portal
Copy `integrations/mozz/mozz_smav_auth_adapter.ts` to your restaurant portal's server or API directory.
```typescript
import { MozzSmavAuthAdapter } from './mozz_smav_auth_adapter';

const smavAdapter = new MozzSmavAuthAdapter({
  centralGatewayUrl: process.env.SMAV_GATEWAY_URL,
  gatewaySecret: process.env.SMAV_GATEWAY_SECRET
});

// Inside restaurant staff creation route:
const linkResult = await smavAdapter.provisionOrLinkStaff({
  externalStaffId: restaurantStaffRecord.id,
  email: restaurantStaffRecord.email,
  fullName: restaurantStaffRecord.name,
  phone: restaurantStaffRecord.phone,
  role: 'staff'
});
```

---

## 5. Verification Checklist

1. **Staff Provisioning Test**:
   Create a new staff member in Glossy Looks portal -> Verify central user exists in `smav_profiles` and has an active entry in `smav_user_outlet_roles` for `outlet_glossy_gach`.
2. **Duplicate Prevention Test**:
   Provision the same email for MOZZ portal -> Central gateway links the existing central user ID without creating duplicate `auth.users` records.
3. **Login & POS Enforcement Test**:
   Log into SMAV Print Agent with Glossy Looks staff credentials -> Verify redirected to `/pos` with Salon services and stylists. Verify restaurant menu is inaccessible.
4. **Restaurant POS Test**:
   Log into SMAV with MOZZ staff credentials -> Verify redirected to `/pos` with Restaurant menu and tables. Verify salon services are inaccessible.
