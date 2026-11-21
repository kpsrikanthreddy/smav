# GlossyLooks Admin Portal — Central Bill Numbering & Dynamic Branch Architecture Contract

This specification defines the contract between the **GlossyLooks Admin Portal** (backend + POS UI) and the **SMAV Central Billing Backend** so that **GlossyLooks Admin Portal POS**, **SMAV Web Counter POS**, and **SMAV Android Print Agent** share:
- One canonical, centrally managed branch master (`public.smav_branches`) with **zero hard-coded branch IDs, names, or codes** in runtime application code.
- One atomic, immutable bill-number sequence per `(outlet, branch, Asia/Kolkata date)`.

---

## 1. Canonical Branches & Dynamic Bill Number Format

Active branches are read dynamically from `public.smav_branches`. Migration `022_branch_standardization_and_dynamic_references.sql` standardizes the initial two active branches for The Glossy Looks and safely migrates legacy references (`tgl-gachibowli-main` → `tgl-gachi`, `brn-1793346038689` → `tgl-konda`, plus any duplicate Gachibowli/Kondapur rows):

| Canonical `id` | Display `name` / `branchName` | `branchCode` | `billPrefix` | `isActive` |
| --- | --- | --- | --- | --- |
| `tgl-gachi` | **Gachibowli** | `GACHI` | `TGL` | `true` |
| `tgl-konda` | **Kondapur** | `KONDA` | `TGL` | `true` |

### Zero-Code Future Branch Onboarding
To launch a new branch (for example `id: "tgl-madhapur"`, `name: "Madhapur"`, `branch_code: "MADHA"`, `bill_prefix: "TGL"`, `is_active: true`):
1. Insert a single active row into `public.smav_branches` for the outlet.
2. Assign staff in `public.smav_user_branch_assignments` (if staff use explicit per-branch scoping).
3. No code changes, enums, redeploys, or app releases are required — Web POS, Android Print Agent, GlossyLooks Admin Portal, central bill numbering, offline preallocation, and finalized-sale webhooks immediately support the new branch.

### Bill Number Format
```text
{BILL_PREFIX}-{BRANCH_CODE}-{YYYYMMDD}-{4_DIGIT_SEQUENCE}
```
Examples:
- `TGL-GACHI-20261120-0001`
- `TGL-KONDA-20261120-0001`
- `TGL-MADHA-20261120-0001` *(future branch, zero code changes)*

**Rules:**
1. Date (`YYYYMMDD`) is always computed server-side in **India Standard Time (`Asia/Kolkata`)**.
2. Sequence resets to `0001` per `(outlet_id, branch_code, billing_date)` using an atomic PostgreSQL transaction + advisory lock (`smav_reserve_central_bill_number`).
3. **Never** generate final bill numbers in GlossyLooks frontend code, Android local code, browser `localStorage`, or brand database triggers/sequences.
4. Once assigned, a `central_bill_number` is **immutable** (`trg_smav_central_bill_number_immutable`) and must be stored identically across SMAV, GlossyLooks `orders` / `payments`, thermal receipts, and WhatsApp receipt/feedback payloads.
5. Historical finalized bill numbers are **never modified or renumbered** during migrations; only their canonical `branch_id` / `branch_code` / `branch_name` references are standardized.

---

## 2. Authentication (Server-to-Server from GlossyLooks Backend)

Call SMAV Central API strictly from the **GlossyLooks Admin backend** (`GlossyLooks Admin backend → SMAV Billing & Sync Gateway → SMAV Print Agent`). The browser must **never** call SMAV using secrets.

For all three GlossyLooks integration endpoints:
- `GET /api/integrations/glossylooks/branches`
- `POST /api/integrations/glossylooks/bill-numbers/reserve`
- `POST /api/integrations/glossylooks/bill-numbers/finalize`

**BOTH** authentication factors are strictly required on every request (SMAV user Bearer tokens are **never** required for these server-to-server routes):

1. **Integration Key Header** (validated strictly against `GLOSSYLOOKS_INTEGRATION_KEY`):
   - `X-Integration-Key: <GLOSSYLOOKS_INTEGRATION_KEY>`
2. **HMAC-SHA256 Signature Headers** (validated separately using `SMAV_DISPATCH_SECRET`, ±5 minute window):
   - `X-SMAV-Timestamp: <unix_seconds_or_ms>`
   - `X-SMAV-Signature: <hex(HMAC_SHA256(SMAV_DISPATCH_SECRET, "${timestamp}.${rawBody}"))>`
   - For `GET` requests with no request body, `rawBody` **MUST** be the empty string `""` (NOT `"{}"`).

*(Generic SMAV Web POS / Android Print Agent endpoints `/api/pos/branches`, `/api/central/bill-numbers/reserve`, `/api/central/bill-numbers/finalize`, and `/api/central/bill-numbers/allocate-range` continue to authenticate via `Authorization: Bearer <smav_access_token>`.)*

---

## 3. Endpoints

### 3.1 List Active Permitted Branches
`GET /api/integrations/glossylooks/branches`  
*(Generic SMAV alias: `GET /api/pos/branches`)*

Returns only **active** (`is_active = true`), deduplicated branches from `public.smav_branches` in normalized shape `{ id, name, branchCode, branchName, isActive, ... }`, along with dynamic selection rules:
- **1 active permitted branch** → `autoSelectedBranch` populated, `requiresManualBranchSelection: false`, `billingBlocked: false`
- **2+ active permitted branches** → `autoSelectedBranch: null`, `requiresManualBranchSelection: true`, `billingBlocked: false`
- **0 active permitted branches** → `branches: []`, `autoSelectedBranch: null`, `billingBlocked: true`, `authorizationMessage: "..."`

**Response (`200 OK`):**
```json
{
  "success": true,
  "outletId": "39a76a12-...",
  "outletCode": "glossylooks",
  "branches": [
    {
      "id": "tgl-gachi",
      "name": "Gachibowli",
      "branchCode": "GACHI",
      "branchName": "Gachibowli",
      "isActive": true,
      "outletId": "39a76a12-...",
      "externalBranchId": "tgl-gachi",
      "billPrefix": "TGL"
    },
    {
      "id": "tgl-konda",
      "name": "Kondapur",
      "branchCode": "KONDA",
      "branchName": "Kondapur",
      "isActive": true,
      "outletId": "39a76a12-...",
      "externalBranchId": "tgl-konda",
      "billPrefix": "TGL"
    }
  ],
  "autoSelectedBranch": null,
  "requiresManualBranchSelection": true,
  "billingBlocked": false,
  "authorizationMessage": null
}
```

### 3.2 Reserve Central Bill Number (Atomic & Idempotent)
`POST /api/integrations/glossylooks/bill-numbers/reserve`  
*(Generic SMAV aliases: `POST /api/central/bill-numbers/reserve`, `POST /api/pos/salon/next-bill-number`)*

Call this immediately before saving/printing a POS bill. Reuse the **exact same `idempotencyKey`** on network retries for the same checkout attempt so SMAV returns the previously assigned bill number instead of allocating a second one.

**Request Body:**
```json
{
  "branchId": "tgl-gachi",
  "branchCode": "GACHI",
  "idempotencyKey": "GLPOS_20261120_8f4c1a2e-9b7d-4e3f-9d1a-3b6c5f2e1a90",
  "sourceSystem": "glossylooks_admin_portal",
  "actorUserId": "5d29c8a0-...",
  "actorRole": "owner",
  "assignedBranchIds": ["tgl-gachi", "tgl-konda"]
}
```
- `branchId` / `branchCode` *(at least one required)*: Resolved dynamically against active rows in `public.smav_branches`. Blank, unknown, or inactive branches return `400 BRANCH_REQUIRED`.
- `idempotencyKey` *(required for safe retries)*: Deterministic per checkout attempt (also accepted via `X-Idempotency-Key` header).
- `assignedBranchIds` / `assignedBranchCodes` *(optional)*: Staff's assigned branches; if provided and empty or excluding the selected branch, SMAV returns `403 NO_ASSIGNED_BRANCH` or `403 BRANCH_NOT_PERMITTED`.

**Response (`200 OK`):**
```json
{
  "success": true,
  "centralBillId": "7d1a4c21-...",
  "centralBillNumber": "TGL-GACHI-20261120-0001",
  "billNumber": "TGL-GACHI-20261120-0001",
  "outletId": "39a76a12-...",
  "branchId": "tgl-gachi",
  "branchCode": "GACHI",
  "branchName": "Gachibowli",
  "billingDate": "2026-11-20",
  "date": "20261120",
  "sequence": 1,
  "sourceSystem": "glossylooks_admin_portal",
  "status": "RESERVED",
  "idempotencyKey": "GLPOS_20261120_8f4c1a2e-9b7d-4e3f-9d1a-3b6c5f2e1a90",
  "generatedAt": "2026-11-20T09:15:22.410Z",
  "idempotentReplay": false,
  "storageMode": "central_rpc"
}
```

### 3.3 Finalize Central Bill Number
`POST /api/integrations/glossylooks/bill-numbers/finalize`  
*(Generic SMAV alias: `POST /api/central/bill-numbers/finalize`)*

Call immediately after GlossyLooks persists its `orders` / `payments` record so SMAV marks the central bill number `FINALIZED` and links `externalOrderId`. Idempotent if retried.

**Request Body:**
```json
{
  "centralBillNumber": "TGL-GACHI-20261120-0001",
  "idempotencyKey": "GLPOS_20261120_8f4c1a2e-9b7d-4e3f-9d1a-3b6c5f2e1a90",
  "externalOrderId": "ord_94812",
  "sourceSystem": "glossylooks_admin_portal"
}
```

**Response (`200 OK`):**
```json
{
  "success": true,
  "centralBillId": "7d1a4c21-...",
  "centralBillNumber": "TGL-GACHI-20261120-0001",
  "billNumber": "TGL-GACHI-20261120-0001",
  "outletId": "39a76a12-...",
  "branchId": "tgl-gachi",
  "branchCode": "GACHI",
  "branchName": "Gachibowli",
  "status": "FINALIZED",
  "finalizedAt": "2026-11-20T09:15:23.118Z",
  "storageMode": "central_rpc"
}
```

### 3.4 Reconciliation Report (Admin / Superadmin)
`GET /api/admin/bill-numbers/reconciliation` *(requires SMAV Admin/Superadmin Bearer token)*

Returns duplicate detections, unlinked central bills, mismatched numbers, unused reserved/preallocated counts, dynamic branch breakdown, and preserved `legacyHistoricalBillsCount`.

### 3.5 Standard Error Codes
| HTTP Status | `code` | Meaning |
| --- | --- | --- |
| `400` | `BRANCH_REQUIRED` | Missing, inactive, or unknown active branch in `public.smav_branches` |
| `400` | `CENTRAL_BILL_NUMBER_REQUIRED` | Missing `centralBillNumber` during finalize/sync |
| `401` | `UNAUTHORIZED` | Missing/invalid Bearer token, `X-Integration-Key`, or HMAC signature |
| `403` | `NO_ASSIGNED_BRANCH` | Authenticated user has 0 active assigned branches; billing is blocked |
| `403` | `BRANCH_NOT_PERMITTED` | User is not allowed to bill for the selected active branch |
| `404` | `OUTLET_NOT_FOUND` | Unknown outlet code |
| `409` | `DUPLICATE_CENTRAL_BILL_NUMBER` / `CENTRAL_BILL_VOIDED` | Duplicate bill number or attempt to finalize a voided number |

---

## 4. Required GlossyLooks Admin Portal POS Alignment

1. **Dynamic Branch Master & Selector**:
   - Load active branches dynamically from `GET /api/integrations/glossylooks/branches` (never hard-code branch IDs, names, or codes in UI dropdowns or backend maps).
   - Standardize GlossyLooks local branch references to canonical IDs (`tgl-gachi`, `tgl-konda`, and any future `smav_branches.id`).
   - Preselect a branch **only** when the authenticated user has **exactly 1** active assigned branch. If 2+, start unselected and require explicit selection. If 0, block billing with a clear authorization alert.
   - Disable **Generate Bill** / **Print Receipt** until an active branch is selected.
2. **Reserve → Save → Finalize Flow**:
   - Generate a deterministic `idempotencyKey` per checkout attempt (reset only when cart/branch changes or after billing completes).
   - Call `POST /api/integrations/glossylooks/bill-numbers/reserve` with canonical `branchId` and `branchCode` to obtain `centralBillId` and `centralBillNumber`.
   - Persist `central_bill_id`, `central_bill_number`, `branch_id`, `branch_code`, and `branch_name` on GlossyLooks `orders` and `payments` records (keep `bill_number = centralBillNumber`).
   - Call `POST /api/integrations/glossylooks/bill-numbers/finalize` with `externalOrderId`.
3. **Strict Finalized-Sale Sequence & Durable-Only Outbox (SMAV → GlossyLooks)**:
   - Set `GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL=https://www.glossylooks.in/api/integrations/smav/sale-event` on the SMAV Cloud Run backend.
   - For both online and delayed offline sync, `/api/mobile/sync/bills` enforces the strict sequence:
     `reserve central number → save local/central bill → finalize central bill number via central RPC → persist durable outbound event in public.smav_outbound_sale_events → dispatch signed event via public.smav_claim_due_outbound_sale_events`.
   - If central finalization fails, `central_bill_finalized` is **never** enqueued or sent; SMAV returns a retryable HTTP `503` (`CENTRAL_BILL_FINALIZE_FAILED`) and leaves the bill pending for safe idempotent retry.
   - There is **no in-memory fallback queue** for finalized-sale events. If `public.smav_outbound_sale_events` or `public.smav_claim_due_outbound_sale_events` is unavailable, SMAV returns HTTP `503` (`OUTBOUND_OUTBOX_UNAVAILABLE`, `retryable: true`) and does **not** report successful GlossyLooks synchronization.
   - Failed webhook deliveries after durable persistence remain queued in `public.smav_outbound_sale_events` and retry automatically with exponential backoff using the **exact same `idempotency_key` and `central_bill_number`**.
   - Signed headers sent on every delivery & retry (unchanged):
     - `X-Integration-Key: <GLOSSYLOOKS_INTEGRATION_KEY>`
     - `X-SMAV-Timestamp: <unix_seconds>`
     - `X-SMAV-Signature: <hex(HMAC_SHA256(SMAV_DISPATCH_SECRET, "${timestamp}.${rawJsonBody}"))>`
     - `X-SMAV-Event-Id: <event_id>`
     - `X-Idempotency-Key: <idempotency_key>`
   - Payload includes canonical dynamic fields: `event_id`, `event_type`, `idempotency_key`, `central_bill_id`, `central_bill_number`, `bill_number`, `outlet_id`, `outlet_code`, `branch_id`, `branch_code`, `branch_name`, `local_branch_id` (= `branch_id`), `external_branch_id` (= `branch_id`), `external_order_id`, `customer_name`, `customer_phone`, `cashier_name`, `payment_mode`, `payment_status`, `subtotal`, `discount`, `tax_amount`, `grand_total`, `paid_amount`, `due_amount`, `billed_at`, `source_system`, and complete `items` array.

---

## 5. Required Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `GLOSSYLOOKS_INTEGRATION_KEY` | SMAV Backend & GlossyLooks Backend | Shared secret validated via `X-Integration-Key` |
| `SMAV_DISPATCH_SECRET` | SMAV Backend & GlossyLooks Backend | Separate shared secret for HMAC-SHA256 signing (`${timestamp}.${rawBody}`) on both inbound and outbound server calls |
| `GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL` | SMAV Backend | `https://www.glossylooks.in/api/integrations/smav/sale-event` — GlossyLooks webhook endpoint to record SMAV-originated bills in GlossyLooks Payment Ledger |
| `SMAV_API_BASE_URL` | GlossyLooks Backend | Base URL of the SMAV Cloud Run service |
