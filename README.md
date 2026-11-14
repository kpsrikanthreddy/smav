# SMAV Print Agent – Unified Enterprise Login & Multi-Supabase Architecture

### Enterprise Central Authentication Gateway, Multi-Tenant POS & ESC/POS Thermal Printing System

Unified production platform supporting:
1. **The Glossy Looks Salon & Spa** (Supabase: `https://onswigwiwuvkvoduuhxr.supabase.co`)
2. **MOZZ / Starters4U Restaurant** (Supabase: `https://uyqdnqbadfysnbzbncyj.supabase.co`)
3. **Trends & Threads Lifestyle & Retail** (Modular Outlet Provider)
4. **Future Registered Outlets** (Dynamic Central Registry)

---

## 🚀 Key Deliverables & System Capabilities

### 1. Unified Enterprise Login Screen
- Pixel-accurate to the Starters4U Restaurant Admin Portal design (`/public/assets/aistudio/image_30ae1713.png`).
- Dark navy/purple background (`#0B0E1B`), centered rounded card (`#121629`), squircle icon container with pink printer icon (`#FF3B80`).
- Fields:
  - `Email Address / User ID`
  - `Password / PIN` with show/hide control
  - `Outlet Code (optional)` with helper text
- Pink-to-orange glowing perimeter gradient `Sign In` button.
- Clean `Forgot Password? Contact your outlet administrator.` flow with secure time-limited token generation.
- **Zero manual role selection**: Client never chooses SUPERADMIN, ADMIN, or STAFF roles manually.
- **Zero demo credentials or quick-fill buttons** on the production login screen.
- Fully responsive on desktop browsers, Android tablets, and mobile devices.

### 2. Central SMAV Authentication Gateway
- Secure backend gateway in `server/authGateway.ts` and `server.ts`.
- **Smart Provider Resolution**:
  - When `outletCode` is provided (e.g. `glossylooks`, `mozz`, `retail1`), routes credentials directly to that outlet's configured adapter.
  - When no outlet code is provided, resolves identity via central identity mapping.
  - Never tries credentials randomly across every registered Supabase instance.
  - PBKDF2/SHA-512 password hashing with cryptographically secure random salt.
  - Rate limiting (maximum 5 failed attempts per IP/user within 5 minutes, 10-minute block).
  - Central security audit trail logging all authentication, deactivation, and reset events.
  - Never exposes Supabase service-role keys to browser or Android application.

### 3. Role-Based Redirection Matrix
After server-side authentication:
- **SUPERADMIN**:
  - Direct server redirect to `/superadmin/outlets`
  - Shows global network of registered outlets grouped by:
    - 🍽️ Restaurants
    - 💇 Salons
    - 🛍️ Shopping & retail stores
    - 🏢 Other business types
  - Search & filter outlets, add new outlet, edit details, activate/deactivate.
  - Create and manage outlet administrators and securely reset admin passwords.
  - View authorized outlet reports and launch outlet-specific POS in auditor mode.
- **ADMIN**:
  - Direct server redirect to `/admin/dashboard` for the assigned outlet.
  - Strictly tenant-isolated: Displays ONLY assigned outlet data.
  - Staff creation, activation/deactivation, secure staff password reset.
  - Catalog and price management with monotonic revisioning.
  - Outlet-specific billing ledger, thermal printer configuration, and reports.
- **STAFF**:
  - Direct server redirect to `/pos` for the assigned outlet.
  - SALON: Services, Stylists, Appointments, Billing, Receipt printing.
  - RESTAURANT: Menu, Tables/Counter, KOT printing (NO prices), Bill receipt.
  - RETAIL: Products, SKU/Barcode, Inventory stock, Fast sales billing.
- **MULTI-OUTLET USERS**:
  - Post-login Outlet Selection Screen allowing user to choose active destination without cross-outlet leakage.

### 4. Database Independence & Repository Pattern
Abstracted backend interfaces in `server/interfaces.ts`:
- `IAuthProvider`: Authenticate, validateSession, requestPasswordReset, revokeSession
- `IUserRepository`: User queries, creation, updates, password resets
- `IOutletRepository`: Central outlet registry management
- `ICatalogRepository`: Multi-business catalog management with monotonic revisions
- `IOrderRepository`: Restaurant orders and KOT management
- `IBillingRepository`: Salon and retail bills management

---

## 📡 Backend API Documentation

### 1. Central Authentication
- `POST /api/auth/login`
  - **Body**: `{ emailOrId: string, password: string, outletCode?: string, device_id?: string }`
  - **Response**: `{ success: boolean, session?: UserSession, redirectTo?: string, multiBusiness?: boolean, availableOutlets?: OutletMembership[] }`
- `POST /api/auth/select-outlet`
  - **Body**: `{ userId: string, outletId: string, deviceId?: string }`
  - **Response**: `{ success: boolean, session: UserSession, redirectTo: string }`
- `GET /api/auth/session`
  - **Header**: `Authorization: Bearer <token>`
  - **Response**: `{ success: true, session: UserSession }`
- `POST /api/auth/logout`
  - **Header**: `Authorization: Bearer <token>`
  - **Response**: `{ success: true, message: "Session revoked successfully" }`
- `POST /api/auth/request-password-reset`
  - **Body**: `{ email: string, outletCode?: string }`
  - **Response**: `{ success: true, resetToken?: string, message: string }`
- `POST /api/auth/confirm-password-reset`
  - **Body**: `{ resetToken: string, newPassword: string }`
  - **Response**: `{ success: true, message: string }`

### 2. Superadmin APIs (Role: `superadmin`)
- `GET /api/superadmin/outlets`: List all outlets from central registry
- `POST /api/superadmin/outlets`: Register a new outlet
- `PUT /api/superadmin/outlets/:id`: Update outlet configuration
- `POST /api/superadmin/outlets/:id/status`: Toggle active/inactive status
- `GET /api/superadmin/admins`: List registered outlet administrators
- `POST /api/superadmin/admins`: Create an outlet administrator
- `POST /api/superadmin/admins/:id/reset-password`: Securely reset admin credentials
- `GET /api/superadmin/reports`: Aggregated network volume, transactions, hardware devices
- `POST /api/superadmin/launch-pos`: Generate temporary auditor session for an outlet POS
- `GET /api/superadmin/audit-logs`: View central security audit events

### 3. Outlet Admin APIs (Role: `admin`)
- `GET /api/admin/outlet-details`: Get assigned outlet profile
- `GET /api/admin/staff`: List staff belonging to assigned outlet
- `POST /api/admin/staff`: Create a new staff member for assigned outlet
- `POST /api/admin/staff/:id/status`: Activate or deactivate a staff member
- `POST /api/admin/staff/:id/reset-password`: Securely reset staff password
- `GET /api/admin/reports`: Outlet sales volume, tax collected, recent transactions

### 4. POS & Synchronization APIs
- `GET /api/pos/init`: Returns catalog, categories, stylists/tables for assigned outlet
- `GET /api/catalog/sync?business_id=...&since_revision=...`: Delta sync cursor endpoint
- `POST /api/mobile/sync/bills`: Offline bill synchronization with idempotency checks
- `POST /api/mobile/sync/orders`: Offline order synchronization with idempotency checks
- `GET /api/realtime/catalog-events`: Server-Sent Events stream for instant invalidation

## 🗃️ Database SQL Migrations

Active migrations located in `database/migrations/`:
- `001`–`009`, `glossylooks_central_auth_link.sql`, `mozz_central_auth_link.sql`: Core POS, multi-tenant auth, catalog sync, RBAC, and portal links.
- `011_phase1_central_login_roles_rls.sql`: Phase 1 Central Login, 3 visible roles (`SUPERADMIN`, `ADMIN`, `POS_BILLING`), non-recursive RLS, and `smav_external_identities` access policies.
- `archive/`: Archived unapplied scripts (`004_central_smav_auth_gateway.sql`, `010_central_edge_identity_and_sync.sql`).

---

## 📱 Print Agents Integration

The native Android app under `agents/android/app/` features:
- Jetpack Compose implementation of the dark navy login card.
- Role-based navigation to Superadmin, Admin, or POS screens.
- Offline Room SQLite database and WorkManager background sync.
- Bluetooth ESC/POS printer manager with 58mm and 80mm column width formatting.
- Downloadable directly from the Web UI via `Download Android App (.ZIP)`.

Windows ESC/POS agent workspace placeholder is located under `agents/windows/`.

---

## 🔑 Enterprise User Directory & Credentials

The central authentication gateway seeds the following pre-configured accounts:

| Role | Name / Title | User ID / Email | Password | Outlet Code | Destination & Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SUPERADMIN** | SMAV Platform Superadmin | `superadmin@smav.io` *(or `superadmin`)* | `SmavSuper@2026!` | *(leave empty)* | `/superadmin/outlets`<br>Full access across all outlets & categories |
| **ADMIN** | Ramesh V *(Salon Manager)* | `ramesh@glossylooks.com` *(or `ramesh_gl`)* | `manager123` | `glossylooks` *(or empty)* | `/admin/dashboard`<br>The Glossy Looks Salon & Spa (Gachibowli) |
| **ADMIN** | Kiran Kumar *(Restaurant GM)* | `manager@starters4u.in` *(or `manager_mozz`)* | `manager123` | `mozz` *(or empty)* | `/admin/dashboard`<br>MOZZ / Starters4U Restaurant & Diner |
| **ADMIN** | Pooja Sharma *(Retail Manager)* | `retailadmin@trendsthreads.com` *(or `retail_admin`)* | `retail123` | `retail1` *(or empty)* | `/admin/dashboard`<br>Trends & Threads Lifestyle & Apparel |
| **OWNER / MULTI-OUTLET** | Srikanth Reddy *(Owner/Partner)* | `kpsrikanthreddy@gmail.com` *(or `srikanth_owner`)* | `owner123` | *(leave empty)* | Multi-outlet selection screen<br>Access to both Glossy Looks & MOZZ |
| **STAFF** | Ananya Rao *(Salon Receptionist)* | `ananya@glossylooks.com` *(or `ananya_reception`)* | `salon123` | `glossylooks` *(or empty)* | `/pos`<br>Salon Services, Stylists, Appointments, Billing |
| **STAFF** | Vikram Reddy *(Restaurant Cashier)* | `vikram@starters4u.in` *(or `vikram_cashier`)* | `mozz123` | `mozz` *(or empty)* | `/pos`<br>Restaurant Menu, Tables, KOT, Bill Printing |
| **STAFF** | Aditya Sen *(Retail Cashier)* | `cashier@trendsthreads.com` *(or `retail_cashier`)* | `retail123` | `retail1` *(or empty)* | `/pos`<br>Retail Products, Barcode Scanning, Sales |

*Note: In accordance with security requirements, demo account shortcuts are removed from the production login card. All passwords are verified server-side using PBKDF2/SHA-512 with timing-safe comparisons.*

