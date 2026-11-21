package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.model.BusinessType
import com.smav.printagent.model.BranchOption
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.SyncPrintStatusRequest
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.network.optBool
import com.smav.printagent.network.optString
import com.smav.printagent.util.BillIdGenerator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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

            Result.success(totalSynced)
        } catch (e: UnauthorizedSessionException) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(IOException(SmavApiClient.friendlyThrowable(e, "Sync failed. Local records remain safe.")))
        }
    }
}
