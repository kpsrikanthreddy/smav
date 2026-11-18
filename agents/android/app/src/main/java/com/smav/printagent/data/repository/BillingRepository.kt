package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.Gson
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
import com.smav.printagent.model.PrinterConnectionStatus
import com.smav.printagent.model.PrinterPurpose
import com.smav.printagent.model.RestaurantCartItem
import com.smav.printagent.model.RetailCartItem
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
        cashierName: String,
        shouldPrint: Boolean = true
    ): Result<SalonBillEntity> = withContext(Dispatchers.IO) {
        if (cartItems.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("Cart is empty"))
        }
        val normalizedCustomerName = customerName?.trim().orEmpty()
        val normalizedCustomerPhone = customerPhone?.trim().orEmpty()
        if (normalizedCustomerName.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Customer name is required."))
        }
        if (normalizedCustomerPhone.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Customer phone is required."))
        }
        if (cartItems.any { it.stylist == null || it.stylist.id.isBlank() }) {
            return@withContext Result.failure(
                IllegalArgumentException("Please select a stylist for every salon service.")
            )
        }

        val deviceId = sessionManager.deviceId
        val branchCode = branch.code.ifBlank { "GACH" }
        val billBranchCode = BillIdGenerator.salonBranchCode(branchCode, branch.name, branch.address)

        // Count every salon bill for this physical branch/date, including legacy GL bill numbers,
        // so changing the display branch token does not restart today's sequence at 0001.
        val todayPrefix = "%-${BillIdGenerator.getTodayDateString()}-%"
        val existingCount = database.salonBillDao().countBillsMatchingPrefix(branchCode, todayPrefix)
        val nextSeq = existingCount + 1

        val billNumber = BillIdGenerator.generateBillNumber("TGL", billBranchCode, nextSeq)
        val idempotencyKey = BillIdGenerator.generateIdempotencyKey(billNumber, deviceId)

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

        val currentCatalogRev = database.cachedCatalogDao().getSyncState("the_glossy_looks")?.currentRevision ?: 101L

        val billEntity = SalonBillEntity(
            id = billId,
            billNumber = billNumber,
            businessId = "the_glossy_looks",
            branchId = branch.id,
            branchCode = branchCode,
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
                billNumber = billNumber,
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
}
