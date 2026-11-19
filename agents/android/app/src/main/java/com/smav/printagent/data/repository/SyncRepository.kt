package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.model.BusinessType
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.SyncPrintStatusRequest
import com.smav.printagent.network.UnauthorizedSessionException
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

            // 1. Sync Salon Bills strictly belonging to the active outlet
            if (session.businessType == BusinessType.SALON) {
                val pendingBills = database.salonBillDao().getUnsyncedBills().filter {
                    it.branchId == activeOutletId || it.branchId == session.branchId
                }
                if (pendingBills.isNotEmpty()) {
                    val billsJsonArray = JsonArray()
                    for (bill in pendingBills) {
                        val items = database.salonBillDao().getItemsForBill(bill.id)
                        if (items.isEmpty()) continue

                        val billObj = JsonObject().apply {
                            addProperty("outletId", activeOutletId)
                            addProperty("billNumber", bill.billNumber)
                            addProperty("customerName", bill.customerName ?: "Walk-in Guest")
                            addProperty("customerPhone", bill.customerPhone ?: "")
                            addProperty("paymentMode", bill.paymentMode)
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
            }

            // 2. Sync Restaurant Orders strictly belonging to the active outlet
            if (session.businessType == BusinessType.RESTAURANT) {
                val pendingOrders = database.restaurantOrderDao().getUnsyncedOrders().filter {
                    it.branchId == activeOutletId || it.branchId == session.branchId
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
