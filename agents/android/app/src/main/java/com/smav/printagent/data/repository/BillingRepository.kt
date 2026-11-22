package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smav.printagent.bluetooth.BluetoothPrinterManager
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.RetailBillEntity
import com.smav.printagent.data.local.entities.RetailBillItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.data.local.entities.SyncQueueEntity
import com.smav.printagent.model.Branch
import com.smav.printagent.model.BranchOption
import com.smav.printagent.model.PrinterConnectionStatus
import com.smav.printagent.model.PrinterPurpose
import com.smav.printagent.model.RestaurantCartItem
import com.smav.printagent.model.RetailCartItem
import com.smav.printagent.model.SalonCartItem
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.optBool
import com.smav.printagent.network.optString
import com.smav.printagent.util.BillIdGenerator
import com.smav.printagent.util.ReceiptFormatter
import com.smav.printagent.worker.OfflineSyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.UUID

class BillingRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val sessionManager: SessionManager,
    private val printerManager: BluetoothPrinterManager
) {

    private val gson = Gson()

    private suspend fun printWithSavedFallback(
        bytes: ByteArray,
        purpose: PrinterPurpose
    ): Result<Unit> {
        val currentStatus = printerManager.connectionStatus.value[purpose]
        if (currentStatus != PrinterConnectionStatus.CONNECTED) {
            val savedMac = sessionManager.getPrinterMac(purpose)
            if (!savedMac.isNullOrBlank()) {
                printerManager.connectPrinter(savedMac, purpose)
            }
        }
        return printerManager.printBytes(bytes, purpose)
    }

    suspend fun getOfflinePreallocatedCount(outletId: String, branchCode: String): Int = withContext(Dispatchers.IO) {
        val todayIso = BillIdGenerator.getIndiaIsoDate()
        database.preallocatedBillNumberDao().expireBeforeDate(todayIso)
        database.preallocatedBillNumberDao().countAvailable(outletId, branchCode.uppercase(Locale.ENGLISH), todayIso)
    }

    /**
     * Creates and saves a Salon Bill using ONLY centrally issued bill numbers:
     * - Online: reserves atomically from SMAV central API (POST /api/central/bill-numbers/reserve) with deterministic idempotencyKey.
     * - Offline: consumes a single centrally preallocated, branch-specific number permanently (never reused).
     * - If offline with no preallocated number available: blocks generation with exact required message.
     */
    suspend fun createSalonBill(
        cartItems: List<SalonCartItem>,
        customerName: String?,
        customerPhone: String?,
        paymentMode: String,
        branch: Branch,
        selectedBranch: BranchOption?,
        cashierName: String,
        checkoutAttemptId: String = UUID.randomUUID().toString(),
        shouldPrint: Boolean = true
    ): Result<SalonBillEntity> = withContext(Dispatchers.IO) {
        if (cartItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("Cart is empty"))
        }
        val normalizedBranchId = selectedBranch?.id?.trim().orEmpty()
        val normalizedBranchCode = selectedBranch?.branchCode?.trim()?.uppercase(Locale.ENGLISH).orEmpty()
        if (selectedBranch == null || !selectedBranch.isActive || normalizedBranchId.isBlank() || normalizedBranchCode.isBlank()) {
            return@withContext Result.failure(
                IllegalArgumentException("Branch selection is mandatory before generating a bill.")
            )
        }
        val normalizedBranchName = selectedBranch.displayName

        val normalizedCustomerName = customerName?.trim().orEmpty()
        val normalizedCustomerPhone = customerPhone?.trim().orEmpty()
        if (normalizedCustomerName.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Customer name is required."))
        }
        if (!Regex("^\\d{10}$").matches(normalizedCustomerPhone)) {
            return@withContext Result.failure(
                IllegalArgumentException("Please enter a valid 10-digit mobile number.")
            )
        }
        if (cartItems.any { it.stylist == null || it.stylist.id.isBlank() }) {
            return@withContext Result.failure(
                IllegalArgumentException("Please select a stylist for every salon service.")
            )
        }

        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Active session required."))
        val deviceId = sessionManager.deviceId
        val billId = UUID.randomUUID().toString()
        val reserveIdempotencyKey = "AND_${normalizedBranchCode}_${checkoutAttemptId}"

        var centralBillId: String? = null
        var billNumber: String? = null
        var idempotencyKey = reserveIdempotencyKey
        var networkFailed = false

        // 1. Online path: reserve atomic central bill number from SMAV backend
        try {
            val api = SmavApiClient.create(sessionManager)
            val bearer = SmavApiClient.bearer(session.token)
            val req = JsonObject().apply {
                // The outlet is the tenant/business ID.  The selected branch is
                // sent separately below; using a branch ID as outletId caused
                // legacy Android bills to fall back to local TGL-GLOSS numbers.
                addProperty("outletId", session.businessId)
                addProperty("branchId", normalizedBranchId)
                addProperty("branchCode", normalizedBranchCode)
                addProperty("branchName", normalizedBranchName)
                addProperty("sourceSystem", "smav_android_agent")
                addProperty("idempotencyKey", reserveIdempotencyKey)
                addProperty("deviceId", deviceId)
            }
            val resp = api.reserveCentralBillNumber(bearer, req)
            val body = resp.body()
            when {
                resp.isSuccessful && body != null && body.optBool("success", false) && body.optString("centralBillNumber").isNotBlank() -> {
                    centralBillId = body.optString("centralBillId").takeIf { it.isNotBlank() }
                    billNumber = body.optString("centralBillNumber")
                    idempotencyKey = body.optString("idempotencyKey").ifBlank { reserveIdempotencyKey }
                }
                resp.code() in 400..499 -> {
                    val serverMsg = SmavApiClient.parseErrorMessage(
                        resp,
                        "Branch validation or central bill reservation rejected (HTTP ${resp.code()})."
                    )
                    return@withContext Result.failure(IllegalStateException(serverMsg))
                }
                else -> {
                    networkFailed = true
                }
            }
        } catch (_: Exception) {
            networkFailed = true
        }

        // 2. Offline fallback: consume a single centrally preallocated, branch-specific bill number (NEVER invent locally)
        if (billNumber.isNullOrBlank()) {
            val todayIso = BillIdGenerator.getIndiaIsoDate()
            database.preallocatedBillNumberDao().expireBeforeDate(todayIso)
            val claimed = database.preallocatedBillNumberDao().claimNextAvailable(
                outletId = session.businessId,
                branchCode = normalizedBranchCode,
                billingDate = todayIso,
                billId = billId
            )
            if (claimed != null) {
                centralBillId = claimed.centralBillId
                billNumber = claimed.centralBillNumber
                idempotencyKey = claimed.idempotencyKey.ifBlank { "PREALLOC_${claimed.centralBillNumber}" }
            } else {
                val msg = if (networkFailed) {
                    "Connect to internet to obtain a valid bill number."
                } else {
                    "Connect to internet to obtain a valid bill number."
                }
                return@withContext Result.failure(IllegalStateException(msg))
            }
        }

        val finalBillNumber = billNumber!!

        var subtotal = 0.0
        var totalDiscount = 0.0
        var totalCgst = 0.0
        var totalSgst = 0.0

        val billItems = cartItems.map { item ->
            subtotal += item.subtotal
            totalDiscount += item.discountAmount
            val cgstPart = item.gstAmount / 2.0
            val sgstPart = item.gstAmount / 2.0
            totalCgst += cgstPart
            totalSgst += sgstPart

            SalonBillItemEntity(
                billId = billId,
                serviceId = item.service.id,
                serviceName = item.service.name,
                categoryName = item.service.category,
                stylistId = item.stylist?.id,
                stylistName = item.stylist?.name,
                quantity = item.quantity,
                unitPrice = item.unitPrice,
                discountAmount = item.discountAmount,
                taxableAmount = item.taxableAmount,
                gstPercent = item.service.gstPercent,
                gstAmount = item.gstAmount,
                totalAmount = item.totalAmount
            )
        }

        val totalTax = totalCgst + totalSgst
        val rawGrandTotal = (subtotal - totalDiscount) + totalTax
        val roundedGrandTotal = Math.round(rawGrandTotal).toDouble()
        val roundOff = roundedGrandTotal - rawGrandTotal

        val currentCatalogRev = database.cachedCatalogDao().getSyncState("the_glossy_looks")?.currentRevision ?: 101L

        val billEntity = SalonBillEntity(
            id = billId,
            billNumber = finalBillNumber,
            businessId = branch.id,
            branchId = normalizedBranchId,
            branchCode = normalizedBranchCode,
            branchName = normalizedBranchName,
            centralBillId = centralBillId,
            sourceSystem = "smav_android_agent",
            deviceId = deviceId,
            idempotencyKey = idempotencyKey,
            customerName = normalizedCustomerName,
            customerPhone = normalizedCustomerPhone,
            paymentMode = paymentMode,
            subtotal = subtotal,
            discountPercent = if (subtotal > 0) (totalDiscount / subtotal) * 100 else 0.0,
            discountAmount = totalDiscount,
            cgstRate = 9.0,
            cgstAmount = totalCgst,
            sgstRate = 9.0,
            sgstAmount = totalSgst,
            totalTax = totalTax,
            grandTotal = roundedGrandTotal,
            roundOff = roundOff,
            catalogRevisionAtSale = currentCatalogRev,
            syncStatus = "PENDING"
        )

        database.salonBillDao().insertBillWithItems(billEntity, billItems)

        val syncPayload = mapOf("bill" to billEntity, "items" to billItems)
        val syncEntity = SyncQueueEntity(
            idempotencyKey = idempotencyKey,
            entityType = "salon_bill",
            recordId = billEntity.id,
            payloadJson = gson.toJson(syncPayload),
            status = "QUEUED"
        )
        database.syncQueueDao().insertSyncItem(syncEntity)

        if (shouldPrint) {
            val paperWidth = sessionManager.getPaperWidth()
            val configuredBranch = branch.copy(
                receiptHeader = sessionManager.getReceiptHeader(branch.id, branch.receiptHeader),
                receiptFooter = sessionManager.getReceiptFooter(branch.id, branch.receiptFooter)
            )
            val printBytes = ReceiptFormatter.formatSalonReceiptBytes(
                bill = billEntity,
                items = billItems,
                branch = configuredBranch,
                cashierName = cashierName,
                paperWidth = paperWidth
            )

            val printJob = PrintJobEntity(
                billNumber = finalBillNumber,
                printerMac = sessionManager.getPrinterMac(PrinterPurpose.SALON_RECEIPT),
                printerName = "Salon Thermal Printer",
                printerPurpose = PrinterPurpose.SALON_RECEIPT.code,
                paperWidthMm = paperWidth.widthMm,
                jobType = "customer_bill",
                status = "PENDING"
            )
            database.printJobDao().insertJob(printJob)

            val printResult = printWithSavedFallback(printBytes, PrinterPurpose.SALON_RECEIPT)
            if (printResult.isSuccess) {
                database.printJobDao().updateJobStatus(printJob.id, "PRINTED", null, System.currentTimeMillis())
            } else {
                database.printJobDao().updateJobStatus(printJob.id, "OFFLINE", printResult.exceptionOrNull()?.message, null)
            }
        }

        OfflineSyncWorker.enqueueSync(context)
        Result.success(billEntity)
    }

    suspend fun reprintSalonBill(
        billId: String,
        branch: Branch,
        cashierName: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val data = database.salonBillDao().getBillWithItems(billId)
            ?: return@withContext Result.failure(IllegalArgumentException("Bill record not found on device."))
        val paperWidth = sessionManager.getPaperWidth()
        val configuredBranch = branch.copy(
            receiptHeader = sessionManager.getReceiptHeader(branch.id, branch.receiptHeader),
            receiptFooter = sessionManager.getReceiptFooter(branch.id, branch.receiptFooter)
        )
        val bytes = ReceiptFormatter.formatSalonReceiptBytes(
            bill = data.bill,
            items = data.items,
            branch = configuredBranch,
            cashierName = cashierName,
            paperWidth = paperWidth
        )
        val job = PrintJobEntity(
            billNumber = data.bill.billNumber,
            printerMac = sessionManager.getPrinterMac(PrinterPurpose.SALON_RECEIPT),
            printerName = "Salon Thermal Printer",
            printerPurpose = PrinterPurpose.SALON_RECEIPT.code,
            paperWidthMm = paperWidth.widthMm,
            jobType = "customer_bill",
            status = "PENDING"
        )
        database.printJobDao().insertJob(job)
        val res = printWithSavedFallback(bytes, PrinterPurpose.SALON_RECEIPT)
        if (res.isSuccess) {
            database.printJobDao().updateJobStatus(job.id, "PRINTED", null, System.currentTimeMillis())
        } else {
            database.printJobDao().updateJobStatus(job.id, "OFFLINE", res.exceptionOrNull()?.message, null)
        }
        res
    }

    /**
     * Creates and saves a Restaurant Order offline first in Room SQLite.
     * Generates both KOT and Customer Bill print jobs.
     */
    suspend fun createRestaurantOrder(
        cartItems: List<RestaurantCartItem>,
        customerName: String?,
        customerPhone: String?,
        tableOrCounter: String,
        orderType: String,
        paymentMode: String,
        branch: Branch,
        specialInstructions: String?,
        printKot: Boolean = true,
        printCustomerBill: Boolean = true
    ): Result<RestaurantOrderEntity> = withContext(Dispatchers.IO) {
        if (cartItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("Cart is empty"))
        }

        val deviceId = sessionManager.deviceId
        val branchCode = branch.code.ifBlank { "MAIN" }

        val todayPrefix = "%$branchCode-${BillIdGenerator.getTodayDateString()}%"
        val existingCount = database.restaurantOrderDao().countOrdersMatchingPrefix(branchCode, todayPrefix)
        val nextSeq = existingCount + 1

        val orderNumber = BillIdGenerator.generateBillNumber("MOZZ", branchCode, nextSeq)
        val tokenNumber = String.format("%03d", nextSeq % 1000)
        val idempotencyKey = BillIdGenerator.generateIdempotencyKey(orderNumber, deviceId)

        var subtotal = 0.0
        val orderId = UUID.randomUUID().toString()

        val orderItems = cartItems.map { cart ->
            subtotal += cart.subtotal
            RestaurantOrderItemEntity(
                orderId = orderId,
                itemId = cart.item.id,
                itemName = cart.item.name,
                categoryName = cart.item.category,
                variantId = cart.selectedVariant?.id,
                variantName = cart.selectedVariant?.name,
                quantity = cart.quantity,
                unitPrice = cart.unitPrice,
                totalPrice = cart.subtotal,
                notes = cart.specialNotes.takeIf { it.isNotBlank() }
            )
        }

        val cgstRate = 2.5
        val sgstRate = 2.5
        val cgstAmount = subtotal * (cgstRate / 100.0)
        val sgstAmount = subtotal * (sgstRate / 100.0)
        val totalTax = cgstAmount + sgstAmount
        val grandTotal = Math.round(subtotal + totalTax).toDouble()

        val currentCatalogRev = database.cachedCatalogDao().getSyncState("mozz_starters4u")?.currentRevision ?: 201L

        val orderEntity = RestaurantOrderEntity(
            id = orderId,
            orderNumber = orderNumber,
            tokenNumber = tokenNumber,
            businessId = "mozz_starters4u",
            branchId = branch.id,
            branchCode = branchCode,
            tableOrCounter = tableOrCounter,
            orderType = orderType,
            deviceId = deviceId,
            idempotencyKey = idempotencyKey,
            customerName = customerName?.trim()?.takeIf { it.isNotEmpty() },
            customerPhone = customerPhone?.trim()?.takeIf { it.isNotEmpty() },
            paymentMode = paymentMode,
            subtotal = subtotal,
            discountAmount = 0.0,
            cgstRate = cgstRate,
            cgstAmount = cgstAmount,
            sgstRate = sgstRate,
            sgstAmount = sgstAmount,
            totalTax = totalTax,
            grandTotal = grandTotal,
            specialInstructions = specialInstructions?.takeIf { it.isNotBlank() },
            catalogRevisionAtSale = currentCatalogRev,
            syncStatus = "PENDING"
        )

        database.restaurantOrderDao().insertOrderWithItems(orderEntity, orderItems)

        val syncPayload = mapOf("order" to orderEntity, "items" to orderItems)
        val syncEntity = SyncQueueEntity(
            idempotencyKey = idempotencyKey,
            entityType = "restaurant_order",
            recordId = orderEntity.id,
            payloadJson = gson.toJson(syncPayload),
            status = "QUEUED"
        )
        database.syncQueueDao().insertSyncItem(syncEntity)

        val paperWidth = sessionManager.getPaperWidth()
        val configuredBranch = branch.copy(
            receiptHeader = sessionManager.getReceiptHeader(branch.id, branch.receiptHeader),
            receiptFooter = sessionManager.getReceiptFooter(branch.id, branch.receiptFooter)
        )

        if (printKot) {
            val kotBytes = ReceiptFormatter.formatRestaurantKotBytes(
                order = orderEntity,
                items = orderItems,
                paperWidth = paperWidth
            )
            val kotJob = PrintJobEntity(
                billNumber = orderNumber,
                printerMac = sessionManager.getPrinterMac(PrinterPurpose.RESTAURANT_KOT),
                printerName = "Kitchen KOT Printer",
                printerPurpose = PrinterPurpose.RESTAURANT_KOT.code,
                paperWidthMm = paperWidth.widthMm,
                jobType = "kitchen_kot",
                status = "PENDING"
            )
            database.printJobDao().insertJob(kotJob)
            val kotResult = printWithSavedFallback(kotBytes, PrinterPurpose.RESTAURANT_KOT)
            database.restaurantOrderDao().updateKotPrinted(orderEntity.id, kotResult.isSuccess)
            database.printJobDao().updateJobStatus(
                kotJob.id,
                if (kotResult.isSuccess) "PRINTED" else "OFFLINE",
                kotResult.exceptionOrNull()?.message,
                if (kotResult.isSuccess) System.currentTimeMillis() else null
            )
        }

        if (printCustomerBill) {
            val billBytes = ReceiptFormatter.formatRestaurantBillBytes(
                order = orderEntity,
                items = orderItems,
                branch = configuredBranch,
                paperWidth = paperWidth
            )
            val billJob = PrintJobEntity(
                billNumber = orderNumber,
                printerMac = sessionManager.getPrinterMac(PrinterPurpose.RESTAURANT_BILL),
                printerName = "Counter Bill Printer",
                printerPurpose = PrinterPurpose.RESTAURANT_BILL.code,
                paperWidthMm = paperWidth.widthMm,
                jobType = "customer_bill",
                status = "PENDING"
            )
            database.printJobDao().insertJob(billJob)
            val billResult = printWithSavedFallback(billBytes, PrinterPurpose.RESTAURANT_BILL)
            database.restaurantOrderDao().updateBillPrinted(orderEntity.id, billResult.isSuccess)
            database.printJobDao().updateJobStatus(
                billJob.id,
                if (billResult.isSuccess) "PRINTED" else "OFFLINE",
                billResult.exceptionOrNull()?.message,
                if (billResult.isSuccess) System.currentTimeMillis() else null
            )
        }

        OfflineSyncWorker.enqueueSync(context)
        Result.success(orderEntity)
    }

    suspend fun reprintRestaurantKot(orderId: String): Result<Unit> = withContext(Dispatchers.IO) {
        val data = database.restaurantOrderDao().getOrderWithItems(orderId)
            ?: return@withContext Result.failure(IllegalArgumentException("Order record not found on device."))
        val paperWidth = sessionManager.getPaperWidth()
        val kotBytes = ReceiptFormatter.formatRestaurantKotBytes(data.order, data.items, paperWidth)
        val res = printWithSavedFallback(kotBytes, PrinterPurpose.RESTAURANT_KOT)
        if (res.isSuccess) {
            database.restaurantOrderDao().updateKotPrinted(orderId, true)
        }
        res
    }

    suspend fun reprintRestaurantBill(orderId: String, branch: Branch): Result<Unit> = withContext(Dispatchers.IO) {
        val data = database.restaurantOrderDao().getOrderWithItems(orderId)
            ?: return@withContext Result.failure(IllegalArgumentException("Order record not found on device."))
        val paperWidth = sessionManager.getPaperWidth()
        val configuredBranch = branch.copy(
            receiptHeader = sessionManager.getReceiptHeader(branch.id, branch.receiptHeader),
            receiptFooter = sessionManager.getReceiptFooter(branch.id, branch.receiptFooter)
        )
        val billBytes = ReceiptFormatter.formatRestaurantBillBytes(data.order, data.items, configuredBranch, paperWidth)
        val res = printWithSavedFallback(billBytes, PrinterPurpose.RESTAURANT_BILL)
        if (res.isSuccess) {
            database.restaurantOrderDao().updateBillPrinted(orderId, true)
        }
        res
    }

    /**
     * Creates and saves a Retail Bill offline first in Room SQLite and prints via Bluetooth.
     */
    suspend fun createRetailBill(
        cartItems: List<RetailCartItem>,
        customerName: String?,
        customerPhone: String?,
        paymentMode: String,
        branch: Branch,
        cashierName: String,
        shouldPrint: Boolean = true
    ): Result<RetailBillEntity> = withContext(Dispatchers.IO) {
        if (cartItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("Cart is empty"))
        }

        val deviceId = sessionManager.deviceId
        val branchCode = branch.code.ifBlank { "RTL" }
        val todayPrefix = "%$branchCode-${BillIdGenerator.getTodayDateString()}%"
        val existingCount = database.retailBillDao().countBillsMatchingPrefix(branchCode, todayPrefix)
        val nextSeq = existingCount + 1

        val billNumber = BillIdGenerator.generateBillNumber("RTL", branchCode, nextSeq)
        val idempotencyKey = BillIdGenerator.generateIdempotencyKey(billNumber, deviceId)
        val billId = UUID.randomUUID().toString()

        var subtotal = 0.0
        var totalDiscount = 0.0
        var totalTax = 0.0

        val items = cartItems.map { item ->
            subtotal += item.subtotal
            totalDiscount += item.discountAmount
            totalTax += item.gstAmount
            RetailBillItemEntity(
                billId = billId,
                productId = item.product.id,
                productName = item.product.name,
                categoryName = item.product.category,
                quantity = item.quantity,
                unitPrice = item.unitPrice,
                discountAmount = item.discountAmount,
                gstPercent = item.product.gstPercent,
                gstAmount = item.gstAmount,
                totalAmount = item.totalAmount
            )
        }

        val rawGrand = (subtotal - totalDiscount) + totalTax
        val grandTotal = Math.round(rawGrand).toDouble()
        val roundOff = grandTotal - rawGrand

        val billEntity = RetailBillEntity(
            id = billId,
            billNumber = billNumber,
            outletId = branch.id,
            branchCode = branchCode,
            deviceId = deviceId,
            idempotencyKey = idempotencyKey,
            customerName = customerName?.trim()?.takeIf { it.isNotEmpty() },
            customerPhone = customerPhone?.trim()?.takeIf { it.isNotEmpty() },
            paymentMode = paymentMode,
            subtotal = subtotal,
            discountAmount = totalDiscount,
            totalTax = totalTax,
            grandTotal = grandTotal,
            roundOff = roundOff,
            syncStatus = "PENDING"
        )

        database.retailBillDao().insertBillWithItems(billEntity, items)

        val syncPayload = mapOf("bill" to billEntity, "items" to items)
        database.syncQueueDao().insertSyncItem(
            SyncQueueEntity(
                idempotencyKey = idempotencyKey,
                entityType = "retail_bill",
                recordId = billEntity.id,
                payloadJson = gson.toJson(syncPayload),
                status = "QUEUED"
            )
        )

        if (shouldPrint) {
            val paperWidth = sessionManager.getPaperWidth()
            val configuredBranch = branch.copy(
                receiptHeader = sessionManager.getReceiptHeader(branch.id, branch.receiptHeader),
                receiptFooter = sessionManager.getReceiptFooter(branch.id, branch.receiptFooter)
            )
            val bytes = ReceiptFormatter.formatRetailReceiptBytes(
                bill = billEntity,
                items = items,
                branch = configuredBranch,
                cashierName = cashierName,
                paperWidth = paperWidth
            )
            val job = PrintJobEntity(
                billNumber = billNumber,
                printerMac = sessionManager.getPrinterMac(PrinterPurpose.RETAIL_RECEIPT),
                printerName = "Retail Receipt Printer",
                printerPurpose = PrinterPurpose.RETAIL_RECEIPT.code,
                paperWidthMm = paperWidth.widthMm,
                jobType = "customer_bill",
                status = "PENDING"
            )
            database.printJobDao().insertJob(job)
            val res = printWithSavedFallback(bytes, PrinterPurpose.RETAIL_RECEIPT)
            database.printJobDao().updateJobStatus(
                job.id,
                if (res.isSuccess) "PRINTED" else "OFFLINE",
                res.exceptionOrNull()?.message,
                if (res.isSuccess) System.currentTimeMillis() else null
            )
        }

        Result.success(billEntity)
    }

    suspend fun reprintRetailBill(
        billId: String,
        branch: Branch,
        cashierName: String
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val data = database.retailBillDao().getBillWithItems(billId)
            ?: return@withContext Result.failure(IllegalArgumentException("Retail bill not found on device."))
        val paperWidth = sessionManager.getPaperWidth()
        val configuredBranch = branch.copy(
            receiptHeader = sessionManager.getReceiptHeader(branch.id, branch.receiptHeader),
            receiptFooter = sessionManager.getReceiptFooter(branch.id, branch.receiptFooter)
        )
        val bytes = ReceiptFormatter.formatRetailReceiptBytes(data.bill, data.items, configuredBranch, cashierName, paperWidth)
        printWithSavedFallback(bytes, PrinterPurpose.RETAIL_RECEIPT)
    }

    // ---------------------------------------------------------------------------------------------
    // AUDITED BILL EDIT & SOFT-DELETE (VOID) WITH ROLE GUARD & OFFLINE CONFLICT PROTECTION
    // ---------------------------------------------------------------------------------------------
    suspend fun editSalonBillOfflineOrOnline(
        billId: String,
        customerName: String,
        customerPhone: String,
        paymentMode: String,
        discountAmount: Double,
        editedItems: List<SalonBillItemEntity>,
        reason: String
    ): Result<SalonBillEntity> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Active session required."))
        if (!session.role.isAdminOrAbove()) {
            return@withContext Result.failure(
                SecurityException("Forbidden: Only SUPERADMIN, ADMIN, or authorized MANAGER can edit bills.")
            )
        }
        val cleanReason = reason.trim()
        if (cleanReason.length < 5) {
            return@withContext Result.failure(IllegalArgumentException("Audit reason must be at least 5 characters."))
        }
        if (editedItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("At least one service item is required."))
        }

        val existing = database.salonBillDao().getBillById(billId)
            ?: return@withContext Result.failure(IllegalArgumentException("Salon bill not found locally."))
        if (existing.isVoided) {
            return@withContext Result.failure(IllegalStateException("Conflict: Bill ${existing.billNumber} is already voided."))
        }

        val subtotal = editedItems.sumOf { it.unitPrice * it.quantity }
        val safeDiscount = discountAmount.coerceIn(0.0, subtotal)
        val taxable = (subtotal - safeDiscount).coerceAtLeast(0.0)
        val totalTax = Math.round(taxable * 0.18 * 100.0) / 100.0
        val cgst = Math.round((totalTax / 2.0) * 100.0) / 100.0
        val sgst = Math.round((totalTax - cgst) * 100.0) / 100.0
        val rawGrand = taxable + totalTax
        val grandTotal = Math.round(rawGrand * 100.0) / 100.0
        val nextVersion = existing.editVersion + 1
        val nowMs = System.currentTimeMillis()

        val recalculatedItems = editedItems.map { item ->
            val lineGross = item.unitPrice * item.quantity
            val lineShare = if (subtotal > 0.0) lineGross / subtotal else 0.0
            val lineDisc = Math.round(safeDiscount * lineShare * 100.0) / 100.0
            val lineTaxable = (lineGross - lineDisc).coerceAtLeast(0.0)
            val lineGst = Math.round(lineTaxable * (item.gstPercent / 100.0) * 100.0) / 100.0
            item.copy(
                billId = existing.id,
                discountAmount = lineDisc,
                taxableAmount = lineTaxable,
                gstAmount = lineGst,
                totalAmount = Math.round((lineTaxable + lineGst) * 100.0) / 100.0
            )
        }

        val updatedEntity = existing.copy(
            customerName = customerName.trim().ifBlank { "Walk-in Guest" },
            customerPhone = customerPhone.trim().takeIf { it.isNotBlank() },
            paymentMode = paymentMode.trim().lowercase(),
            subtotal = Math.round(subtotal * 100.0) / 100.0,
            discountAmount = Math.round(safeDiscount * 100.0) / 100.0,
            cgstAmount = cgst,
            sgstAmount = sgst,
            totalTax = totalTax,
            grandTotal = grandTotal,
            roundOff = 0.0,
            editVersion = nextVersion,
            editReason = cleanReason,
            updatedAtLocal = nowMs,
            conflictMessage = null
        )

        val payload = JsonObject().apply {
            addProperty("billNumber", existing.billNumber)
            addProperty("customerName", updatedEntity.customerName ?: "Walk-in Guest")
            addProperty("customerPhone", updatedEntity.customerPhone ?: "")
            addProperty("paymentMode", updatedEntity.paymentMode)
            addProperty("discountAmount", updatedEntity.discountAmount)
            addProperty("reason", cleanReason)
            addProperty("expectedEditVersion", existing.editVersion)
            val arr = JsonArray()
            recalculatedItems.forEach { it ->
                arr.add(JsonObject().apply {
                    addProperty("id", it.serviceId)
                    addProperty("name", it.serviceName)
                    addProperty("quantity", it.quantity)
                    addProperty("unitPrice", it.unitPrice)
                    if (!it.stylistId.isNullOrBlank()) addProperty("stylistId", it.stylistId)
                    if (!it.stylistName.isNullOrBlank()) addProperty("stylistName", it.stylistName)
                    addProperty("gstPercent", it.gstPercent)
                })
            }
            add("items", arr)
        }

        // Persist updated bill locally first
        database.salonBillDao().replaceBillAndItems(updatedEntity, recalculatedItems)

        // Try immediate online sync; if offline, queue mutation safely with expectedEditVersion
        try {
            val api = SmavApiClient.create(sessionManager)
            val resp = api.editBill(SmavApiClient.bearer(session.token), existing.billNumber, payload)
            when {
                resp.isSuccessful -> {
                    database.salonBillDao().updateSyncStatus(existing.id, "SYNCED", null, System.currentTimeMillis())
                    return@withContext Result.success(updatedEntity.copy(syncStatus = "SYNCED"))
                }
                resp.code() == 409 || resp.code() == 403 -> {
                    val conflictMsg = SmavApiClient.parseErrorMessage(resp, "Server rejected edit (HTTP ${resp.code()}).")
                    database.salonBillDao().markConflict(existing.id, conflictMsg)
                    return@withContext Result.failure(IllegalStateException(conflictMsg))
                }
            }
        } catch (_: Exception) {
            // Fall through to offline sync queue
        }

        database.syncQueueDao().insertSyncItem(
            SyncQueueEntity(
                idempotencyKey = "EDIT_${existing.billNumber}_v${nextVersion}_${nowMs}",
                entityType = "bill_edit",
                recordId = existing.id,
                payloadJson = payload.toString(),
                status = "QUEUED"
            )
        )
        OfflineSyncWorker.enqueueSync(context)
        Result.success(updatedEntity.copy(syncStatus = "PENDING"))
    }

    suspend fun voidSalonBillOfflineOrOnline(
        billId: String,
        reason: String
    ): Result<String> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Active session required."))
        if (!session.role.isAdminOrAbove()) {
            return@withContext Result.failure(
                SecurityException("Forbidden: Only SUPERADMIN, ADMIN, or authorized MANAGER can void bills.")
            )
        }
        val cleanReason = reason.trim()
        if (cleanReason.length < 5) {
            return@withContext Result.failure(IllegalArgumentException("Void reason must be at least 5 characters."))
        }

        val existing = database.salonBillDao().getBillById(billId)
            ?: return@withContext Result.failure(IllegalArgumentException("Salon bill not found locally."))
        if (existing.isVoided) {
            return@withContext Result.failure(IllegalStateException("Bill ${existing.billNumber} is already voided."))
        }

        val nowMs = System.currentTimeMillis()
        val payload = JsonObject().apply {
            addProperty("billNumber", existing.billNumber)
            addProperty("reason", cleanReason)
            addProperty("expectedEditVersion", existing.editVersion)
        }

        try {
            val api = SmavApiClient.create(sessionManager)
            val resp = api.voidBill(SmavApiClient.bearer(session.token), existing.billNumber, payload)
            when {
                resp.isSuccessful -> {
                    database.salonBillDao().markVoided(existing.id, cleanReason, nowMs, session.userId)
                    return@withContext Result.success("Bill ${existing.billNumber} voided (audited soft-delete).")
                }
                resp.code() == 409 || resp.code() == 403 -> {
                    val conflictMsg = SmavApiClient.parseErrorMessage(resp, "Cannot void bill (HTTP ${resp.code()}).")
                    database.salonBillDao().markConflict(existing.id, conflictMsg)
                    return@withContext Result.failure(IllegalStateException(conflictMsg))
                }
            }
        } catch (_: Exception) {
            // Offline fallback: soft-delete locally & queue audited void sync
        }

        database.salonBillDao().markVoided(existing.id, cleanReason, nowMs, session.userId)
        database.syncQueueDao().insertSyncItem(
            SyncQueueEntity(
                idempotencyKey = "VOID_${existing.billNumber}_${nowMs}",
                entityType = "bill_void",
                recordId = existing.id,
                payloadJson = payload.toString(),
                status = "QUEUED"
            )
        )
        OfflineSyncWorker.enqueueSync(context)
        Result.success("Bill ${existing.billNumber} voided offline; will sync safely when online.")
    }

    suspend fun voidRestaurantOrderOfflineOrOnline(
        orderId: String,
        reason: String
    ): Result<String> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Active session required."))
        if (!session.role.isAdminOrAbove()) {
            return@withContext Result.failure(
                SecurityException("Forbidden: Only SUPERADMIN, ADMIN, or authorized MANAGER can void orders.")
            )
        }
        val cleanReason = reason.trim()
        if (cleanReason.length < 5) {
            return@withContext Result.failure(IllegalArgumentException("Void reason must be at least 5 characters."))
        }
        val existing = database.restaurantOrderDao().getOrderById(orderId)
            ?: return@withContext Result.failure(IllegalArgumentException("Order not found locally."))

        val nowMs = System.currentTimeMillis()
        val payload = JsonObject().apply {
            addProperty("billNumber", existing.orderNumber)
            addProperty("reason", cleanReason)
            addProperty("expectedEditVersion", existing.editVersion)
        }

        try {
            val api = SmavApiClient.create(sessionManager)
            val resp = api.voidBill(SmavApiClient.bearer(session.token), existing.orderNumber, payload)
            when {
                resp.isSuccessful -> {
                    database.restaurantOrderDao().markVoided(existing.id, cleanReason, nowMs, session.userId)
                    return@withContext Result.success("Order ${existing.orderNumber} voided (audited soft-delete).")
                }
                resp.code() == 409 || resp.code() == 403 -> {
                    val conflictMsg = SmavApiClient.parseErrorMessage(resp, "Cannot void order (HTTP ${resp.code()}).")
                    database.restaurantOrderDao().markConflict(existing.id, conflictMsg)
                    return@withContext Result.failure(IllegalStateException(conflictMsg))
                }
            }
        } catch (_: Exception) {
            // Offline fallback
        }

        database.restaurantOrderDao().markVoided(existing.id, cleanReason, nowMs, session.userId)
        database.syncQueueDao().insertSyncItem(
            SyncQueueEntity(
                idempotencyKey = "VOID_${existing.orderNumber}_${nowMs}",
                entityType = "bill_void",
                recordId = existing.id,
                payloadJson = payload.toString(),
                status = "QUEUED"
            )
        )
        OfflineSyncWorker.enqueueSync(context)
        Result.success("Order ${existing.orderNumber} voided offline; will sync safely when online.")
    }

    suspend fun voidRetailBillOfflineOrOnline(
        billId: String,
        reason: String
    ): Result<String> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("Active session required."))
        if (!session.role.isAdminOrAbove()) {
            return@withContext Result.failure(
                SecurityException("Forbidden: Only SUPERADMIN, ADMIN, or authorized MANAGER can void bills.")
            )
        }
        val cleanReason = reason.trim()
        if (cleanReason.length < 5) {
            return@withContext Result.failure(IllegalArgumentException("Void reason must be at least 5 characters."))
        }
        val existing = database.retailBillDao().getBillById(billId)
            ?: return@withContext Result.failure(IllegalArgumentException("Retail bill not found locally."))

        val nowMs = System.currentTimeMillis()
        database.retailBillDao().markVoided(existing.id, cleanReason, nowMs, session.userId)
        Result.success("Bill ${existing.billNumber} voided (audited soft-delete).")
    }
}
