# GlossyLooks Admin Portal — Central Bill Numbering & Mandatory Branch Selection Contract

This specification defines the exact contract between the **GlossyLooks Admin Portal** (backend + POS UI) and the **SMAV Central Billing Backend** so that **GlossyLooks Admin Portal POS**, **SMAV Web Counter POS**, and **SMAV Android Print Agent** share one atomic, immutable bill-number sequence per `(outlet, branch, Asia/Kolkata date)`.

---

## 1. Canonical Branch Codes & Bill Number Format

| Branch Display Name | Canonical `branchCode` | `externalBranchId` | Bill Prefix |
| --- | --- | --- | --- |
| **Gachibowli** | `GACHI` | `tgl-gachibowli-main` | `TGL` |
| **Kondapur** | `KONDA` | `tgl-kondapur-main` | `TGL` |

**Format:**
```text
TGL-{BRANCH_CODE}-{YYYYMMDD}-{4_DIGIT_SEQUENCE}
```
Examples:
- `TGL-GACHI-20261120-0001`
- `TGL-KONDA-20261120-0001`
- `TGL-GACHI-20261120-0002`

**Rules:**
1. Date (`YYYYMMDD`) is always computed server-side in **India Standard Time (`Asia/Kolkata`)**.
2. Sequence resets to `0001` per `(outlet_id, branch_code, billing_date)` using an atomic PostgreSQL transaction + advisory lock (`smav_reserve_central_bill_number`).
3. **Never** generate final bill numbers in GlossyLooks frontend code, browser `localStorage`, or GlossyLooks Supabase triggers/sequences.
4. Once assigned, a `central_bill_number` is **immutable** (`trg_smav_central_bill_number_immutable`) and must be stored identically across SMAV, GlossyLooks `orders` / `payments`, thermal receipts, and WhatsApp receipt/feedback payloads.
5. Historical bill numbers created before cutover are preserved untouched as legacy records.

---

## 2. Authentication (Server-to-Server from GlossyLooks Backend)

Call SMAV Central API from the GlossyLooks backend (never expose integration secrets in browser code). Any one of the following authentication methods is accepted:

1. **Integration Key Header** *(recommended for server-to-server)*:
   - `X-Integration-Key: <GLOSSYLOOKS_INTEGRATION_KEY>` (or `X-SMAV-Gateway-Secret`)
2. **HMAC-SHA256 Signed Request** *(optional defense-in-depth; valid within ±5 minutes)*:
   - `X-SMAV-Timestamp: <unix_ms_or_seconds>`
   - `X-SMAV-Signature: <hex(HMAC_SHA256(GLOSSYLOOKS_INTEGRATION_KEY, "${timestamp}.${rawJsonBody}"))>`
3. **SMAV User Bearer Token** *(when calling directly with a SMAV session)*:
   - `Authorization: Bearer <smav_access_token>`

---

## 3. Endpoints

### 3.1 List Permitted Branches
`GET /api/integrations/glossylooks/branches`  
*(Generic SMAV alias: `GET /api/pos/branches`)*

Returns active branches for the outlet and whether auto-selection is permitted.

**Response (`200 OK`):**
```json
{
  "success": true,
  "outletId": "39a76a12-...",
  "outletCode": "glossylooks",
  "branches": [
    {
      "id": "uuid",
      "outletId": "39a76a12-...",
      "branchCode": "GACHI",
      "branchName": "Gachibowli",
      "externalBranchId": "tgl-gachibowli-main",
      "billPrefix": "TGL",
      "isActive": true
    },
    {
      "id": "uuid",
      "outletId": "39a76a12-...",
      "branchCode": "KONDA",
      "branchName": "Kondapur",
      "externalBranchId": "tgl-kondapur-main",
      "billPrefix": "TGL",
      "isActive": true
    }
  ],
  "autoSelectedBranch": null,
  "requiresManualBranchSelection": true
}
```

### 3.2 Reserve Central Bill Number (Atomic & Idempotent)
`POST /api/integrations/glossylooks/bill-numbers/reserve`  
*(Generic SMAV aliases: `POST /api/central/bill-numbers/reserve`, `POST /api/pos/salon/next-bill-number`)*

Call this immediately before saving/printing a GlossyLooks POS bill. Reuse the **exact same `idempotencyKey`** on network retries for the same checkout attempt so SMAV returns the previously assigned bill number instead of allocating a second one.

**Request Body:**
```json
{
  "branchCode": "GACHI",
  "idempotencyKey": "GLPOS_20261120_8f4c1a2e-9b7d-4e3f-9d1a-3b6c5f2e1a90",
  "sourceSystem": "glossylooks_admin_portal",
  "actorUserId": "5d29c8a0-...",
  "actorRole": "owner",
  "assignedBranchCodes": ["GACHI", "KONDA"]
}
```
- `branchCode` *(required)*: `GACHI`, `KONDA`, `Gachibowli`, or `Kondapur` (normalized server-side; blank or unknown values return `400 BRANCH_REQUIRED`).
- `idempotencyKey` *(required for safe retries)*: Deterministic per checkout attempt (also accepted via `X-Idempotency-Key` header).
- `assignedBranchCodes` *(optional)*: Staff's assigned branch codes in GlossyLooks; if provided and `branchCode` is not included, SMAV returns `403 BRANCH_NOT_PERMITTED`.

**Response (`200 OK`):**
```json
{
  "success": true,
  "centralBillId": "7d1a4c21-...",
  "centralBillNumber": "TGL-GACHI-20261120-0001",
  "billNumber": "TGL-GACHI-20261120-0001",
  "outletId": "39a76a12-...",
  "branchId": "a1b2c3d4-...",
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
  "branchId": "a1b2c3d4-...",
  "branchCode": "GACHI",
  "branchName": "Gachibowli",
  "status": "FINALIZED",
  "finalizedAt": "2026-11-20T09:15:23.118Z",
  "storageMode": "central_rpc"
}
```

### 3.4 Reconciliation Report (Admin / Superadmin)
`GET /api/admin/bill-numbers/reconciliation` *(requires SMAV Admin/Superadmin Bearer token)*

Returns duplicate detections, unlinked `TGL-*` bills, mismatched numbers, unused reserved/preallocated counts, branch breakdown, and preserved `legacyHistoricalBillsCount`.

### 3.5 Standard Error Codes
| HTTP Status | `code` | Meaning |
| --- | --- | --- |
| `400` | `BRANCH_REQUIRED` | Missing or invalid branch (`GACHI` / `KONDA` required) |
| `400` | `CENTRAL_BILL_NUMBER_REQUIRED` | Missing `centralBillNumber` during finalize/sync |
| `401` | `UNAUTHORIZED` | Missing/invalid Bearer token, `X-Integration-Key`, or HMAC signature |
| `403` | `BRANCH_NOT_PERMITTED` | User is not allowed to bill for the selected branch |
| `404` | `OUTLET_NOT_FOUND` | Unknown outlet code |
| `409` | `DUPLICATE_CENTRAL_BILL_NUMBER` / `CENTRAL_BILL_VOIDED` | Duplicate bill number or attempt to finalize a voided number |

---

## 4. Required GlossyLooks Admin Portal POS Changes

1. **Mandatory Branch Selector**:
   - Add a required **Branch** selector (`Gachibowli (GACHI)`, `Kondapur (KONDA)`) to the GlossyLooks Admin Portal POS checkout screen.
   - Preselect a branch **only** when the authenticated user has **exactly 1** assigned branch. If the user has 2+ permitted branches (or is Owner/Admin), start unselected and require explicit selection.
   - Disable **Generate Bill** / **Print Receipt** until a branch is selected.
   - Enforce `BRANCH_REQUIRED` and `BRANCH_NOT_PERMITTED` on the GlossyLooks backend route as well.
2. **Reserve → Save → Finalize Flow**:
   - Generate a deterministic `idempotencyKey` per checkout attempt (reset only when cart/branch changes or after billing completes).
   - Call `POST /api/integrations/glossylooks/bill-numbers/reserve` to get `centralBillId` and `centralBillNumber`.
   - Persist `central_bill_id`, `central_bill_number`, `branch_code`, and `branch_name` on GlossyLooks `orders` and `payments` records (keep `bill_number = centralBillNumber`).
   - Call `POST /api/integrations/glossylooks/bill-numbers/finalize` with `externalOrderId`.
   - Pass `centralBillNumber`, `branchCode`, and `branchName` into WhatsApp receipt & feedback templates.
3. **80mm Thermal Receipt Template**:
   - **Remove** full salon street address, city, PIN code, and GSTIN from the receipt header/footer.
   - **Keep** `THE GLOSSY LOOKS`, `"Professional Women's Salon"`, WhatsApp contact line (`9966970003 (G) · 9154744608 (K)`), `Branch: <Gachibowli | Kondapur>` near `Bill No: <TGL-...>`, date/time, customer details, services, stylist, tax, payment mode, and totals.
4. **Optional Outbound Sync Webhook (SMAV → GlossyLooks)**:
   - Set `GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL=https://www.glossylooks.in/api/integrations/smav/sale-event` on the SMAV Cloud Run backend. When configured, SMAV automatically POSTs finalized bills from **SMAV Web POS** and **SMAV Android Print Agent** with `event_id`, `event_type: "central_bill_finalized"`, `central_bill_id`, `central_bill_number`, `branch_code`, `branch_name`, `idempotency_key`, `customer_name`, `customer_phone`, `payment_mode`, `grand_total`, `billed_at`, and `source_system`, signed with `X-SMAV-Event-Id`, `X-SMAV-Timestamp` (Unix seconds), `X-SMAV-Signature` (HMAC-SHA256 using `SMAV_DISPATCH_SECRET`, falling back to `GLOSSYLOOKS_INTEGRATION_KEY`), and `X-Integration-Key`.

---

## 5. Required Environment Variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `GLOSSYLOOKS_INTEGRATION_KEY` | SMAV Backend & GlossyLooks Backend | Shared secret for `X-Integration-Key` and HMAC-SHA256 signing |
| `GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL` | SMAV Backend | `https://www.glossylooks.in/api/integrations/smav/sale-event` — GlossyLooks webhook endpoint to store SMAV-originated `central_bill_number` on GlossyLooks orders/payments |
| `SMAV_API_BASE_URL` | GlossyLooks Backend | Base URL of the SMAV Cloud Run service |
