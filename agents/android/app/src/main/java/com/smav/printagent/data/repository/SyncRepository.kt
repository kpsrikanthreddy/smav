package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.dao.SalonBillWithItems
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.model.BusinessType
import com.smav.printagent.model.BranchOption
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.SyncPrintStatusRequest
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.network.optBool
import com.smav.printagent.network.optDouble
import com.smav.printagent.network.optInt
import com.smav.printagent.network.optString
import com.smav.printagent.util.BillIdGenerator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class SyncRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val sessionManager: SessionManager
) {
    private fun formatIsoUtc(epochMs: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(epochMs))
    }

    private fun parseIsoToEpochMs(iso: String?, fallbackMs: Long = System.currentTimeMillis()): Long {
        val raw = iso?.trim().orEmpty()
        if (raw.isBlank()) return fallbackMs
        val normalized = raw
            .replace(Regex("\\.(\\d{3})\\d+"), ".$1")
            .replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd HH:mm:ss"
        )
        for (pattern in patterns) {
            try {
                val sdf = SimpleDateFormat(pattern, Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }
                val parsed = sdf.parse(normalized)
                if (parsed != null) return parsed.time
            } catch (_: Exception) {
            }
        }
        return fallbackMs
    }

    private suspend fun findLocalSalonBill(
        id: String?,
        centralBillId: String?,
        idempotencyKey: String?,
        billNumber: String?
    ): SalonBillEntity? {
        val dao = database.salonBillDao()
        if (!id.isNullOrBlank()) dao.getBillById(id)?.let { return it }
        if (!centralBillId.isNullOrBlank()) dao.getBillByCentralId(centralBillId)?.let { return it }
        if (!idempotencyKey.isNullOrBlank()) dao.getBillByIdempotencyKey(idempotencyKey)?.let { return it }
        if (!billNumber.isNullOrBlank()) dao.getBillByNumber(billNumber)?.let { return it }
        return null
    }

    private fun parseRemoteBillToSalonWithItems(
        obj: JsonObject,
        activeOutletId: String,
        existingLocal: SalonBillEntity?,
        deviceId: String
    ): SalonBillWithItems? {
        val remoteId = obj.optString("id")
        val centralBillNumber = obj.optString("centralBillNumber", "central_bill_number")
        val billNumber = centralBillNumber.ifBlank { obj.optString("billNumber", "bill_number") }
        if (billNumber.isBlank()) return null

        val stableId = existingLocal?.id
            ?: remoteId.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString()
        val centralBillId = obj.optString("centralBillId", "central_bill_id").takeIf { it.isNotBlank() }
            ?: existingLocal?.centralBillId
        val remoteIdempotency = obj.optString("idempotencyKey", "idempotency_key").takeIf { it.isNotBlank() }
            ?: existingLocal?.idempotencyKey
            ?: "CENTRAL_${remoteId.ifBlank { billNumber }}"

        val createdAtMs = parseIsoToEpochMs(
            obj.optString("createdAt", "created_at"),
            existingLocal?.createdAtLocal ?: System.currentTimeMillis()
        )
        val updatedAtMs = parseIsoToEpochMs(
            obj.optString("updatedAt", "updated_at", "editedAt", "edited_at"),
            createdAtMs
        )
        val isVoided = obj.optBool("isVoided", false) ||
            obj.optBool("is_voided", false) ||
            obj.optString("deletedAt", "deleted_at").isNotBlank()
        val voidReason = obj.optString("deleteReason", "delete_reason", "voidReason", "void_reason")
            .takeIf { it.isNotBlank() }
        val voidedAtRaw = obj.optString("deletedAt", "deleted_at", "voidedAt", "voided_at")
        val voidedAtMs = if (voidedAtRaw.isNotBlank()) parseIsoToEpochMs(voidedAtRaw, updatedAtMs) else existingLocal?.voidedAtLocal
        val voidedBy = obj.optString("deletedByName", "deletedBy", "deleted_by", "voidedBy", "voided_by")
            .takeIf { it.isNotBlank() } ?: existingLocal?.voidedBy

        val subtotal = obj.optDouble("subtotal", default = 0.0)
        val discountAmount = obj.optDouble("discountAmount", "discount_amount", default = 0.0)
        val totalTax = obj.optDouble("totalTax", "total_tax", "gstAmount", "gst_amount", default = 0.0)
        val grandTotal = obj.optDouble("grandTotal", "grand_total", default = 0.0)
        val cgst = Math.round((totalTax / 2.0) * 100.0) / 100.0
        val sgst = Math.round((totalTax - cgst) * 100.0) / 100.0

        val branchId = obj.optString("branchId", "branch_id").ifBlank { existingLocal?.branchId ?: activeOutletId }
        val branchCode = obj.optString("branchCode", "branch_code").ifBlank { existingLocal?.branchCode ?: "MAIN" }
        val branchName = obj.optString("branchName", "branch_name").takeIf { it.isNotBlank() } ?: existingLocal?.branchName

        val billEntity = SalonBillEntity(
            id = stableId,
            billNumber = billNumber,
            businessId = activeOutletId,
            branchId = branchId,
            branchCode = branchCode,
            deviceId = existingLocal?.deviceId ?: deviceId,
            localRecordId = existingLocal?.localRecordId ?: stableId,
            idempotencyKey = remoteIdempotency,
            customerName = obj.optString("customerName", "customer_name").ifBlank { "Walk-in Guest" },
            customerPhone = obj.optString("customerPhone", "customer_phone").takeIf { it.isNotBlank() },
            paymentMode = obj.optString("paymentMode", "payment_mode").ifBlank { "upi" }.lowercase(Locale.ENGLISH),
            subtotal = subtotal,
            discountPercent = existingLocal?.discountPercent ?: 0.0,
            discountAmount = discountAmount,
            cgstRate = existingLocal?.cgstRate ?: 9.0,
            cgstAmount = cgst,
            sgstRate = existingLocal?.sgstRate ?: 9.0,
            sgstAmount = sgst,
            totalTax = totalTax,
            grandTotal = grandTotal,
            roundOff = existingLocal?.roundOff ?: 0.0,
            catalogRevisionAtSale = existingLocal?.catalogRevisionAtSale ?: 100L,
            notes = existingLocal?.notes,
            syncStatus = "SYNCED",
            syncError = null,
            createdAtLocal = createdAtMs,
            createdAtServer = createdAtMs,
            isVoided = isVoided,
            voidReason = if (isVoided) voidReason else null,
            voidedAtLocal = if (isVoided) voidedAtMs else null,
            voidedBy = if (isVoided) voidedBy else null,
            editVersion = obj.optInt("editVersion", "edit_version", default = existingLocal?.editVersion ?: 1).coerceAtLeast(1),
            editReason = obj.optString("editReason", "edit_reason").takeIf { it.isNotBlank() } ?: existingLocal?.editReason,
            updatedAtLocal = updatedAtMs,
            conflictMessage = null,
            centralBillId = centralBillId,
            branchName = branchName,
            sourceSystem = obj.optString("sourceSystem", "source_system").ifBlank { existingLocal?.sourceSystem ?: "central_smav" }
        )

        val itemsArray = obj.getAsJsonArray("items")
        val items = mutableListOf<SalonBillItemEntity>()
        if (itemsArray != null) {
            for (idx in 0 until itemsArray.size()) {
                val itemEl = itemsArray.get(idx)
                if (!itemEl.isJsonObject) continue
                val itObj = itemEl.asJsonObject
                val qty = itObj.optInt("quantity", "qty", default = 1).coerceAtLeast(1)
                val unitPrice = itObj.optDouble("unitPrice", "unit_price", "price", default = 0.0)
                val lineTotal = itObj.optDouble("lineTotal", "line_total", "totalAmount", "total_amount", default = unitPrice * qty)
                val gstPct = itObj.optDouble("gstPercent", "gst_percent", default = 18.0)
                val discPct = itObj.optDouble("discountPercent", "discount_percent", default = 0.0)
                val lineGross = unitPrice * qty
                val lineDisc = Math.round(lineGross * (discPct / 100.0) * 100.0) / 100.0
                val lineTaxable = (lineGross - lineDisc).coerceAtLeast(0.0)
                val lineGst = Math.round(lineTaxable * (gstPct / 100.0) * 100.0) / 100.0
                items.add(
                    SalonBillItemEntity(
                        id = "${stableId}_item_$idx",
                        billId = stableId,
                        serviceId = itObj.optString("serviceId", "service_id", "id").ifBlank { "svc_$idx" },
                        serviceName = itObj.optString("name", "serviceName", "service_name").ifBlank { "Service" },
                        categoryName = itObj.optString("category", "categoryName", "category_name").ifBlank { "Salon" },
                        stylistId = itObj.optString("stylistId", "stylist_id").takeIf { it.isNotBlank() },
                        stylistName = itObj.optString("stylistName", "stylist_name", "stylist").takeIf { it.isNotBlank() },
                        quantity = qty,
                        unitPrice = unitPrice,
                        discountAmount = lineDisc,
                        taxableAmount = lineTaxable,
                        gstPercent = gstPct,
                        gstAmount = lineGst,
                        totalAmount = if (lineTotal > 0.0) lineTotal else Math.round((lineTaxable + lineGst) * 100.0) / 100.0
                    )
                )
            }
        }
        return SalonBillWithItems(billEntity, items)
    }

    private suspend fun applyTombstonesToRoom(tombstones: JsonArray?) {
        if (tombstones == null) return
        val dao = database.salonBillDao()
        for (i in 0 until tombstones.size()) {
            val el = tombstones.get(i)
            if (!el.isJsonObject) continue
            val t = el.asJsonObject
            val existing = findLocalSalonBill(
                id = t.optString("id"),
                centralBillId = t.optString("centralBillId", "central_bill_id"),
                idempotencyKey = t.optString("idempotencyKey", "idempotency_key"),
                billNumber = t.optString("billNumber", "bill_number")
            ) ?: continue
            val deletedAtMs = parseIsoToEpochMs(t.optString("deletedAt", "deleted_at"), System.currentTimeMillis())
            val reason = t.optString("deleteReason", "delete_reason", "voidReason", "void_reason").ifBlank { "Deleted on another device" }
            dao.markVoidedSynced(
                id = existing.id,
                reason = reason,
                voidedAt = deletedAtMs,
                voidedBy = "central_sync"
            )
        }
    }

    /**
     * Pulls today's authoritative central ledger + deletion tombstones into Room SQLite so
     * bills created on Glossy Looks Admin, SMAV Web, or another POS device immediately appear
     * in Android "Bills & Reprint" and deleted bills disappear consistently.
     */
    suspend fun pullRemoteLedgerIntoRoom(scope: String = "today"): Result<Int> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Please sign in to refresh bills."))
        val activeOutletId = session.businessId
        if (activeOutletId.isBlank() || session.businessType != BusinessType.SALON) {
            return@withContext Result.success(0)
        }

        val api = SmavApiClient.create(sessionManager)
        val bearer = SmavApiClient.bearer(session.token)
        try {
            val response = api.getUnifiedLedger(
                token = bearer,
                scope = scope,
                timezone = "Asia/Kolkata",
                includeTombstones = true
            )
            if (response.code() == 401) {
                sessionManager.clearSession()
                return@withContext Result.failure(
                    UnauthorizedSessionException(SmavApiClient.parseErrorMessage(response, "Session expired. Please sign in again."))
                )
            }
            val body = response.body()
            if (!response.isSuccessful || body == null || !body.optBool("success", false)) {
                return@withContext Result.failure(
                    IOException(SmavApiClient.parseErrorMessage(response, "Unable to refresh central billing ledger."))
                )
            }

            // 1. Apply deletion tombstones first so deleted bills vanish from local Today cache
            applyTombstonesToRoom(body.getAsJsonArray("tombstones"))

            // 2. Upsert every authoritative active bill + line items into Room
            val billsArray = body.getAsJsonArray("bills") ?: JsonArray()
            val seenBillNumbers = mutableSetOf<String>()
            val seenIds = mutableSetOf<String>()
            var upsertedCount = 0

            for (i in 0 until billsArray.size()) {
                val el = billsArray.get(i)
                if (!el.isJsonObject) continue
                val obj = el.asJsonObject
                val existing = findLocalSalonBill(
                    id = obj.optString("id"),
                    centralBillId = obj.optString("centralBillId", "central_bill_id"),
                    idempotencyKey = obj.optString("idempotencyKey", "idempotency_key"),
                    billNumber = obj.optString("centralBillNumber", "billNumber", "bill_number")
                )
                val parsed = parseRemoteBillToSalonWithItems(
                    obj = obj,
                    activeOutletId = activeOutletId,
                    existingLocal = existing,
                    deviceId = sessionManager.deviceId
                ) ?: continue

                database.salonBillDao().replaceBillAndItems(parsed.bill, parsed.items)
                seenBillNumbers.add(parsed.bill.billNumber)
                seenIds.add(parsed.bill.id)
                upsertedCount += 1
            }

            // 3. Reconcile any previously SYNCED local today bill that is no longer active on server
            //    (protects against missed tombstones without ever touching PENDING/offline bills)
            if (scope == "today") {
                val startOfDayMs = BillIdGenerator.getStartOfTodayMillis()
                val localSyncedToday = database.salonBillDao().getTodaySyncedBillsForOutlet(activeOutletId, startOfDayMs)
                for (localBill in localSyncedToday) {
                    if (localBill.id !in seenIds && localBill.billNumber !in seenBillNumbers) {
                        database.salonBillDao().markVoidedSynced(
                            id = localBill.id,
                            reason = localBill.voidReason ?: "Removed from active central ledger",
                            voidedAt = System.currentTimeMillis(),
                            voidedBy = "central_sync"
                        )
                    }
                }
            }

            Result.success(upsertedCount)
        } catch (u: UnauthorizedSessionException) {
            Result.failure(u)
        } catch (e: Exception) {
            Result.failure(IOException(SmavApiClient.friendlyThrowable(e, "Could not sync remote bills right now.")))
        }
    }

    /**
     * Fetches authorized History or Deleted bills directly from the central single source of truth
     * (enforced by server-side RBAC: ADMIN/OWNER/SUPERADMIN only).
     */
    suspend fun fetchRemoteLedger(
        scope: String,
        fromDate: String? = null,
        toDate: String? = null,
        branchId: String? = null,
        search: String? = null
    ): Result<List<SalonBillWithItems>> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Please sign in first."))
        val activeOutletId = session.businessId
        val api = SmavApiClient.create(sessionManager)
        val bearer = SmavApiClient.bearer(session.token)
        try {
            val response = api.getUnifiedLedger(
                token = bearer,
                scope = scope,
                timezone = "Asia/Kolkata",
                fromDate = fromDate?.takeIf { it.isNotBlank() },
                toDate = toDate?.takeIf { it.isNotBlank() },
                branchId = branchId?.takeIf { it.isNotBlank() },
                search = search?.takeIf { it.isNotBlank() },
                includeTombstones = true
            )
            if (response.code() == 401) {
                sessionManager.clearSession()
                return@withContext Result.failure(
                    UnauthorizedSessionException(SmavApiClient.parseErrorMessage(response, "Session expired. Please sign in again."))
                )
            }
            val body = response.body()
            if (!response.isSuccessful || body == null || !body.optBool("success", false)) {
                return@withContext Result.failure(
                    IOException(SmavApiClient.parseErrorMessage(response, "Unable to load $scope bills (HTTP ${response.code()})."))
                )
            }
            applyTombstonesToRoom(body.getAsJsonArray("tombstones"))
            val billsArray = body.getAsJsonArray("bills") ?: JsonArray()
            val result = mutableListOf<SalonBillWithItems>()
            for (i in 0 until billsArray.size()) {
                val el = billsArray.get(i)
                if (!el.isJsonObject) continue
                val obj = el.asJsonObject
                val existing = findLocalSalonBill(
                    id = obj.optString("id"),
                    centralBillId = obj.optString("centralBillId", "central_bill_id"),
                    idempotencyKey = obj.optString("idempotencyKey", "idempotency_key"),
                    billNumber = obj.optString("centralBillNumber", "billNumber", "bill_number")
                )
                val parsed = parseRemoteBillToSalonWithItems(
                    obj = obj,
                    activeOutletId = activeOutletId,
                    existingLocal = existing,
                    deviceId = sessionManager.deviceId
                ) ?: continue
                result.add(parsed)
            }
            Result.success(result.sortedByDescending { it.bill.createdAtLocal })
        } catch (u: UnauthorizedSessionException) {
            Result.failure(u)
        } catch (e: Exception) {
            if (scope == "deleted") {
                val localDeleted = database.salonBillDao().getDeletedBillsForOutlet(activeOutletId).map { b ->
                    SalonBillWithItems(b, database.salonBillDao().getItemsForBill(b.id))
                }
                if (localDeleted.isNotEmpty()) return@withContext Result.success(localDeleted)
            }
            Result.failure(IOException(SmavApiClient.friendlyThrowable(e, "Unable to load $scope bills.")))
        }
    }

    /**
     * A bill created by an older APK may contain a local TGL-GLOSS number.  It
     * must never be uploaded as that number: reserve once with the central
     * service, persist the issued number locally, then sync/finalize it.
     *
     * This deliberately resolves the branch from the bill's stored ID/code,
     * not from the current POS selection, so a queued bill remains syncable.
     */
    private suspend fun ensureCentralSalonBillNumber(
        api: com.smav.printagent.network.ApiService,
        bearer: String,
        outletId: String,
        bill: SalonBillEntity,
        permittedBranches: List<BranchOption>
    ): SalonBillEntity {
        val storedId = bill.branchId.trim()
        val storedCode = bill.branchCode.trim().uppercase(Locale.ENGLISH)
        val branch = permittedBranches.firstOrNull {
            it.isActive && (it.id == storedId || it.branchCode.trim().uppercase(Locale.ENGLISH) == storedCode)
        // Legacy APKs stored GLOSS instead of the actual branch code.  It is
        // safe to recover that record only when this operator has exactly one
        // active permitted branch; otherwise we fail closed rather than assign
        // a bill to the wrong branch.
        } ?: permittedBranches.singleOrNull() ?: throw IllegalStateException(
            "Pending bill ${bill.billNumber} cannot be synced because its saved branch is no longer active or permitted."
        )

        val expectedPrefix = "${branch.billPrefix.ifBlank { "TGL" }.uppercase(Locale.ENGLISH)}-${branch.branchCode.trim().uppercase(Locale.ENGLISH)}-"
        if (!bill.centralBillId.isNullOrBlank() && bill.billNumber.uppercase(Locale.ENGLISH).startsWith(expectedPrefix)) {
            return bill
        }

        val recoveryKey = "ANDROID_RECOVER_${bill.id}"
        val response = api.reserveCentralBillNumber(bearer, JsonObject().apply {
            addProperty("outletId", outletId)
            addProperty("branchId", branch.id)
            addProperty("branchCode", branch.branchCode.trim().uppercase(Locale.ENGLISH))
            addProperty("branchName", branch.displayName)
            addProperty("sourceSystem", "smav_android_agent")
            addProperty("idempotencyKey", recoveryKey)
            addProperty("deviceId", bill.deviceId)
        })
        val body = response.body()
        if (!response.isSuccessful || body == null || !body.optBool("success", false)) {
            throw IOException(SmavApiClient.parseErrorMessage(response, "Central bill-number reservation failed."))
        }
        val centralBillId = body.optString("centralBillId")
        val centralBillNumber = body.optString("centralBillNumber")
        val centralIdempotencyKey = body.optString("idempotencyKey").ifBlank { recoveryKey }
        if (centralBillId.isBlank() || centralBillNumber.isBlank() || !BillIdGenerator.isValidBillNumber(centralBillNumber)) {
            throw IOException("Central bill-number reservation returned an invalid bill number.")
        }

        val canonicalCode = body.optString("branchCode").ifBlank { branch.branchCode }.uppercase(Locale.ENGLISH)
        val canonicalName = body.optString("branchName").ifBlank { branch.displayName }
        val canonicalId = body.optString("branchId").ifBlank { branch.id }
        database.salonBillDao().applyCentralBillReservation(
            id = bill.id,
            billNumber = centralBillNumber,
            centralBillId = centralBillId,
            branchId = canonicalId,
            branchCode = canonicalCode,
            branchName = canonicalName,
            idempotencyKey = centralIdempotencyKey
        )
        return bill.copy(
            billNumber = centralBillNumber,
            centralBillId = centralBillId,
            branchId = canonicalId,
            branchCode = canonicalCode,
            branchName = canonicalName,
            idempotencyKey = centralIdempotencyKey
        )
    }

    suspend fun syncAllPending(): Result<Int> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Please sign in to sync pending transactions."))

        val activeOutletId = session.businessId
        if (activeOutletId.isBlank() || session.businessType == BusinessType.OTHER) {
            return@withContext Result.failure(
                IllegalStateException("Select a specific salon or restaurant outlet before syncing bills.")
            )
        }

        val api = SmavApiClient.create(sessionManager)
        val bearer = SmavApiClient.bearer(session.token)
        var totalSynced = 0

        try {
            // 0. Revalidate active status against Central Auth on reconnect before uploading.
            //    If the user was deactivated or password-reset while offline, revoke local session
            //    immediately while preserving unsynchronized Room bills for an active operator.
            val authCheck = api.getAuthSession(bearer)
            if (authCheck.code() == 401 || authCheck.code() == 403) {
                sessionManager.clearSession()
                throw UnauthorizedSessionException(
                    SmavApiClient.parseErrorMessage(
                        authCheck,
                        "Your account is inactive or your session expired. Please sign in again."
                    )
                )
            }
            if (authCheck.isSuccessful) {
                sessionManager.touchSessionValidatedAt()
            }

            // 1. Sync Salon Bills strictly belonging to the active outlet (preserving already-printed central bill number)
            if (session.businessType == BusinessType.SALON) {
                val permittedBranches = sessionManager.getPermittedBranches(activeOutletId).filter { it.isActive }
                val cachedBranchIds = permittedBranches.map { it.id }.toSet()
                val cachedBranchCodes = permittedBranches.map { it.branchCode.uppercase(Locale.ENGLISH) }.toSet()
                val pendingBills = database.salonBillDao().getUnsyncedBills().filter {
                    it.businessId == activeOutletId ||
                        it.branchId == activeOutletId ||
                        (session.branchId.isNotBlank() && it.branchId == session.branchId) ||
                        it.branchId in cachedBranchIds ||
                        it.branchCode.uppercase(Locale.ENGLISH) in cachedBranchCodes
                }
                if (pendingBills.isNotEmpty()) {
                    val billsJsonArray = JsonArray()
                    for (pendingBill in pendingBills) {
                        val bill = ensureCentralSalonBillNumber(
                            api = api,
                            bearer = bearer,
                            outletId = activeOutletId,
                            bill = pendingBill,
                            permittedBranches = permittedBranches
                        )
                        val items = database.salonBillDao().getItemsForBill(bill.id)
                        if (items.isEmpty()) continue

                        val resolvedBranchName = bill.branchName?.takeIf { it.isNotBlank() } ?: bill.branchCode

                        val billObj = JsonObject().apply {
                            addProperty("id", bill.id)
                            addProperty("outletId", activeOutletId)
                            addProperty("billNumber", bill.billNumber)
                            addProperty("centralBillNumber", bill.billNumber)
                            if (!bill.centralBillId.isNullOrBlank()) {
                                addProperty("centralBillId", bill.centralBillId)
                            }
                            if (bill.branchId.isNotBlank() && bill.branchId != activeOutletId) {
                                addProperty("branchId", bill.branchId)
                            }
                            addProperty("branchCode", bill.branchCode)
                            addProperty("branchName", resolvedBranchName)
                            addProperty("sourceSystem", bill.sourceSystem.ifBlank { "smav_android_agent" })
                            addProperty("customerName", bill.customerName ?: "Walk-in Guest")
                            addProperty("customerPhone", bill.customerPhone ?: "")
                            addProperty("paymentMode", bill.paymentMode)
                            addProperty("subtotal", bill.subtotal)
                            addProperty("discountAmount", bill.discountAmount)
                            addProperty("totalTax", bill.totalTax)
                            addProperty("grandTotal", bill.grandTotal)
                            addProperty("createdAt", formatIsoUtc(bill.createdAtLocal))
                        }

                        val itemsArray = JsonArray()
                        for (item in items) {
                            itemsArray.add(JsonObject().apply {
                                addProperty("serviceId", item.serviceId)
                                addProperty("name", item.serviceName)
                                addProperty("stylistId", item.stylistId?.takeIf { it.isNotBlank() } ?: session.userId)
                                addProperty("stylist", item.stylistName?.takeIf { it.isNotBlank() } ?: session.userName)
                                addProperty("quantity", item.quantity)
                                addProperty("price", item.unitPrice)
                            })
                        }

                        val entryObj = JsonObject().apply {
                            add("bill", billObj)
                            add("items", itemsArray)
                            addProperty("idempotency_key", bill.idempotencyKey)
                        }
                        billsJsonArray.add(entryObj)
                    }

                    if (billsJsonArray.size() > 0) {
                        val requestBody = JsonObject().apply { add("bills", billsJsonArray) }
                        val response = api.syncBillsJson(bearer, requestBody)
                        if (response.code() == 401) {
                            throw UnauthorizedSessionException(SmavApiClient.parseErrorMessage(response))
                        }
                        val body = response.body()
                        if (!response.isSuccessful || body == null || !body.success) {
                            throw IOException(SmavApiClient.parseErrorMessage(response, "Salon bill sync failed."))
                        }
                        body.syncedIds.forEach { syncedId ->
                            database.salonBillDao().updateSyncStatus(syncedId, "SYNCED", null, body.serverTimestamp)
                        }
                        // Apply any server deletion tombstones returned during offline bill upload
                        // so an offline device never resurrects a soft-deleted bill.
                        body.syncedBills?.forEach { sb ->
                            if (sb.optBool("is_voided", false) || sb.optString("deleted_at").isNotBlank()) {
                                val existing = findLocalSalonBill(
                                    id = sb.optString("bill_id"),
                                    centralBillId = sb.optString("central_bill_id"),
                                    idempotencyKey = sb.optString("idempotency_key"),
                                    billNumber = sb.optString("bill_number")
                                )
                                if (existing != null) {
                                    val delMs = parseIsoToEpochMs(sb.optString("deleted_at"), System.currentTimeMillis())
                                    database.salonBillDao().markVoidedSynced(
                                        id = existing.id,
                                        reason = sb.optString("void_reason").ifBlank { "Deleted on central server" },
                                        voidedAt = delMs,
                                        voidedBy = "central_sync"
                                    )
                                }
                            }
                        }
                        totalSynced += body.syncedIds.size
                    }
                }

                // Replenish offline preallocated bill number ranges on reconnect when below threshold
                val cachedBranches = sessionManager.getPermittedBranches(activeOutletId)
                if (cachedBranches.isNotEmpty()) {
                    runCatching {
                        CatalogSyncRepository(context, database, sessionManager)
                            .ensureOfflineBillNumberRanges(api, bearer, activeOutletId, cachedBranches)
                    }
                }
            }

            // 2. Sync Restaurant Orders strictly belonging to the active outlet
            if (session.businessType == BusinessType.RESTAURANT) {
                val pendingOrders = database.restaurantOrderDao().getUnsyncedOrders().filter {
                    it.branchId == activeOutletId || (session.branchId.isNotBlank() && it.branchId == session.branchId)
                }
                if (pendingOrders.isNotEmpty()) {
                    val ordersJsonArray = JsonArray()
                    for (order in pendingOrders) {
                        val items = database.restaurantOrderDao().getItemsForOrder(order.id)
                        val orderObj = JsonObject().apply {
                            addProperty("id", order.id)
                            addProperty("outletId", activeOutletId)
                            addProperty("orderNumber", order.orderNumber)
                            addProperty("tokenNumber", order.tokenNumber)
                            addProperty("branchCode", order.branchCode)
                            addProperty("tableOrCounter", order.tableOrCounter)
                            addProperty("orderType", order.orderType)
                            addProperty("customerName", order.customerName ?: "")
                            addProperty("customerPhone", order.customerPhone ?: "")
                            addProperty("paymentMode", order.paymentMode)
                            addProperty("grandTotal", order.grandTotal)
                            addProperty("catalogRevisionAtSale", order.catalogRevisionAtSale)
                            addProperty("createdAt", formatIsoUtc(order.createdAtLocal))
                        }
                        val itemsArray = JsonArray()
                        for (item in items) {
                            itemsArray.add(JsonObject().apply {
                                addProperty("itemId", item.itemId)
                                addProperty("name", item.itemName)
                                addProperty("category", item.categoryName)
                                addProperty("variantId", item.variantId)
                                addProperty("variantName", item.variantName)
                                addProperty("quantity", item.quantity)
                                addProperty("price", item.unitPrice)
                                addProperty("totalPrice", item.totalPrice)
                                addProperty("notes", item.notes)
                            })
                        }
                        ordersJsonArray.add(JsonObject().apply {
                            add("order", orderObj)
                            add("items", itemsArray)
                            addProperty("idempotency_key", order.idempotencyKey)
                        })
                    }

                    if (ordersJsonArray.size() > 0) {
                        val requestBody = JsonObject().apply { add("orders", ordersJsonArray) }
                        val response = api.syncOrdersJson(bearer, requestBody)
                        if (response.code() == 401) {
                            throw UnauthorizedSessionException(SmavApiClient.parseErrorMessage(response))
                        }
                        val body = response.body()
                        if (!response.isSuccessful || body == null || !body.success) {
                            throw IOException(SmavApiClient.parseErrorMessage(response, "Restaurant order sync failed."))
                        }
                        body.syncedIds.forEach { syncedId ->
                            database.restaurantOrderDao().updateSyncStatus(syncedId, "SYNCED", null, body.serverTimestamp)
                        }
                        totalSynced += body.syncedIds.size
                    }
                }
            }

            // 3. Retail bills are kept safely queued in Room until POST /api/mobile/sync/retail-bills is added
            if (session.businessType == BusinessType.RETAIL) {
                val pendingRetail = database.retailBillDao().getUnsyncedBills().filter { it.outletId == activeOutletId }
                if (pendingRetail.isNotEmpty() && totalSynced == 0) {
                    return@withContext Result.failure(
                        IOException("Retail bills are saved safely offline. Server endpoint POST /api/mobile/sync/retail-bills is required for cloud upload.")
                    )
                }
            }

            // 3B. Replay queued offline bill_edit and bill_void mutations safely after bill creation sync
            val queuedMutations = database.syncQueueDao().getQueuedItems().filter {
                it.entityType == "bill_edit" || it.entityType == "bill_void"
            }
            for (mutation in queuedMutations) {
                try {
                    val payload = com.google.gson.JsonParser.parseString(mutation.payloadJson).asJsonObject
                    val billIdentifier = payload.get("billNumber")?.asString?.takeIf { it.isNotBlank() }
                        ?: mutation.recordId
                    val resp = if (mutation.entityType == "bill_edit") {
                        api.editBill(bearer, billIdentifier, payload)
                    } else {
                        api.voidBill(bearer, billIdentifier, payload)
                    }
                    when {
                        resp.code() == 401 -> {
                            throw UnauthorizedSessionException(SmavApiClient.parseErrorMessage(resp))
                        }
                        resp.code() == 409 || resp.code() == 403 -> {
                            val conflictMsg = SmavApiClient.parseErrorMessage(
                                resp,
                                if (resp.code() == 409) {
                                    "Offline edit/void conflict detected on server. Refresh ledger before retrying."
                                } else {
                                    "Forbidden: Only SUPERADMIN, ADMIN, or MANAGER can edit or void bills."
                                }
                            )
                            database.syncQueueDao().updateStatus(mutation.id, "CONFLICT", conflictMsg)
                            database.salonBillDao().markConflict(mutation.recordId, conflictMsg)
                            database.restaurantOrderDao().markConflict(mutation.recordId, conflictMsg)
                            database.retailBillDao().markConflict(mutation.recordId, conflictMsg)
                        }
                        resp.isSuccessful -> {
                            database.syncQueueDao().markSynced(mutation.id, System.currentTimeMillis())
                            database.salonBillDao().updateSyncStatus(mutation.recordId, "SYNCED", null, System.currentTimeMillis())
                            database.restaurantOrderDao().updateSyncStatus(mutation.recordId, "SYNCED", null, System.currentTimeMillis())
                            totalSynced += 1
                        }
                        else -> {
                            val errMsg = SmavApiClient.parseErrorMessage(resp, "Mutation sync failed (HTTP ${resp.code()})")
                            database.syncQueueDao().recordRetry(mutation.id, errMsg)
                        }
                    }
                } catch (u: UnauthorizedSessionException) {
                    throw u
                } catch (e: Exception) {
                    database.syncQueueDao().recordRetry(mutation.id, e.message ?: "Offline mutation retry pending")
                }
            }

            // 4. Report Print Job statuses opportunistically
            val pendingPrints = database.printJobDao().getPendingJobs()
            if (pendingPrints.isNotEmpty()) {
                runCatching {
                    api.syncPrintStatus(bearer, SyncPrintStatusRequest(pendingPrints))
                }
            }

            // 5. Pull authoritative Today's active bills + deletion tombstones from central server
            if (session.businessType == BusinessType.SALON) {
                runCatching { pullRemoteLedgerIntoRoom("today") }
            }

            Result.success(totalSynced)
        } catch (e: UnauthorizedSessionException) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(IOException(SmavApiClient.friendlyThrowable(e, "Sync failed. Local records remain safe.")))
        }
    }
}
