package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.Gson
import com.smav.printagent.bluetooth.BluetoothPrinterManager
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.data.local.entities.SyncQueueEntity
import com.smav.printagent.model.Branch
import com.smav.printagent.model.PrinterPurpose
import com.smav.printagent.model.RestaurantCartItem
import com.smav.printagent.model.SalonCartItem
import com.smav.printagent.util.BillIdGenerator
import com.smav.printagent.util.ReceiptFormatter
import com.smav.printagent.worker.OfflineSyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

class BillingRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val sessionManager: SessionManager,
    private val printerManager: BluetoothPrinterManager
) {

    private val gson = Gson()

    /**
     * Creates and saves a Salon Bill offline first in Room SQLite.
     * Queues print job and auto-sync immediately.
     */
    suspend fun createSalonBill(
        cartItems: List<SalonCartItem>,
        customerName: String?,
        customerPhone: String?,
        paymentMode: String,
        branch: Branch,
        cashierName: String
    ): Result<SalonBillEntity> = withContext(Dispatchers.IO) {
        if (cartItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("Cart is empty"))
        }

        val deviceId = sessionManager.deviceId
        val branchCode = branch.code.ifBlank { "GACH" }

        // Determine today's sequence
        val todayPrefix = "%$branchCode-${BillIdGenerator.getTodayDateString()}%"
        val existingCount = database.salonBillDao().countBillsMatchingPrefix(branchCode, todayPrefix)
        val nextSeq = existingCount + 1

        val billNumber = BillIdGenerator.generateBillNumber("TGL", branchCode, nextSeq)
        val idempotencyKey = BillIdGenerator.generateIdempotencyKey(billNumber, deviceId)

        // Financial calculations
        var subtotal = 0.0
        var totalDiscount = 0.0
        var totalCgst = 0.0
        var totalSgst = 0.0
        val billId = UUID.randomUUID().toString()

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

        val currentCatalogRev = database.cachedCatalogDao().getSyncState("the_glossy_looks")?.lastSyncedRevision ?: 101L

        val billEntity = SalonBillEntity(
            id = billId,
            billNumber = billNumber,
            businessId = "the_glossy_looks",
            branchId = branch.id,
            branchCode = branchCode,
            deviceId = deviceId,
            idempotencyKey = idempotencyKey,
            customerName = customerName?.trim()?.takeIf { it.isNotEmpty() },
            customerPhone = customerPhone?.trim()?.takeIf { it.isNotEmpty() },
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

        // Atomically insert bill and items
        database.salonBillDao().insertBillWithItems(billEntity, billItems)

        // Queue Sync in Room
        val syncPayload = mapOf("bill" to billEntity, "items" to billItems)
        val syncEntity = SyncQueueEntity(
            idempotencyKey = idempotencyKey,
            entityType = "salon_bill",
            recordId = billEntity.id,
            payloadJson = gson.toJson(syncPayload),
            status = "QUEUED"
        )
        database.syncQueueDao().insertSyncItem(syncEntity)

        // Create Print Job with user-selected paper width (58mm or 80mm)
        val paperWidth = sessionManager.getPaperWidth()
        val printBytes = ReceiptFormatter.formatSalonReceiptBytes(
            bill = billEntity,
            items = billItems,
            branch = branch,
            cashierName = cashierName,
            paperWidth = paperWidth
        )

        val printJob = PrintJobEntity(
            billNumber = billNumber,
            printerMac = sessionManager.getPrinterMac(PrinterPurpose.SALON_RECEIPT),
            printerName = "Salon Thermal Printer",
            printerPurpose = PrinterPurpose.SALON_RECEIPT.code,
            paperWidthMm = paperWidth.widthMm,
            jobType = "customer_bill",
            status = "PENDING"
        )
        database.printJobDao().insertJob(printJob)

        // Print asynchronously via Bluetooth
        val printResult = printerManager.printBytes(printBytes, PrinterPurpose.SALON_RECEIPT)
        if (printResult.isSuccess) {
            database.printJobDao().updateJobStatus(printJob.id, "PRINTED", null, System.currentTimeMillis())
        } else {
            database.printJobDao().updateJobStatus(printJob.id, "OFFLINE", printResult.exceptionOrNull()?.message, null)
        }

        // Trigger WorkManager auto-sync
        OfflineSyncWorker.enqueueSync(context)

        Result.success(billEntity)
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
        specialInstructions: String?
    ): Result<RestaurantOrderEntity> = withContext(Dispatchers.IO) {
        if (cartItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("Cart is empty"))
        }

        val deviceId = sessionManager.deviceId
        val branchCode = branch.code.ifBlank { "GACH" }

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

        val currentCatalogRev = database.cachedCatalogDao().getSyncState("mozz_starters4u")?.lastSyncedRevision ?: 201L

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

        // Insert into Room
        database.restaurantOrderDao().insertOrderWithItems(orderEntity, orderItems)

        // Queue Sync
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

        // 1. Kitchen KOT Print Job (NO PRICES)
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
        val kotResult = printerManager.printBytes(kotBytes, PrinterPurpose.RESTAURANT_KOT)
        database.restaurantOrderDao().updateKotPrinted(orderEntity.id, kotResult.isSuccess)

        // 2. Customer Bill Print Job
        val billBytes = ReceiptFormatter.formatRestaurantBillBytes(
            order = orderEntity,
            items = orderItems,
            branch = branch,
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
        val billResult = printerManager.printBytes(billBytes, PrinterPurpose.RESTAURANT_BILL)
        database.restaurantOrderDao().updateBillPrinted(orderEntity.id, billResult.isSuccess)

        // Trigger WorkManager
        OfflineSyncWorker.enqueueSync(context)

        Result.success(orderEntity)
    }
}
