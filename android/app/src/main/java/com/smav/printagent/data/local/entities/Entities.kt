package com.smav.printagent.data.local.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(
    tableName = "salon_bills",
    indices = [
        Index(value = ["billNumber"], unique = true),
        Index(value = ["idempotencyKey"], unique = true),
        Index(value = ["syncStatus"])
    ]
)
data class SalonBillEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val billNumber: String,
    val businessId: String = "the_glossy_looks",
    val branchId: String,
    val branchCode: String,
    val deviceId: String,
    val localRecordId: String = UUID.randomUUID().toString(),
    val idempotencyKey: String,
    val customerName: String?,
    val customerPhone: String?,
    val paymentMode: String,
    val subtotal: Double,
    val discountPercent: Double,
    val discountAmount: Double,
    val cgstRate: Double = 9.0,
    val cgstAmount: Double,
    val sgstRate: Double = 9.0,
    val sgstAmount: Double,
    val totalTax: Double,
    val grandTotal: Double,
    val roundOff: Double = 0.0,
    val catalogRevisionAtSale: Long = 100L, // Immutable price snapshot revision
    val notes: String? = null,
    val syncStatus: String = "PENDING", // PENDING, SYNCING, SYNCED, FAILED
    val syncError: String? = null,
    val createdAtLocal: Long = System.currentTimeMillis(),
    val createdAtServer: Long? = null
)

@Entity(
    tableName = "salon_bill_items",
    foreignKeys = [
        ForeignKey(
            entity = SalonBillEntity::class,
            parentColumns = ["id"],
            childColumns = ["billId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["billId"])]
)
data class SalonBillItemEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val billId: String,
    val serviceId: String,
    val serviceName: String,
    val categoryName: String,
    val stylistId: String?,
    val stylistName: String?,
    val quantity: Int,
    val unitPrice: Double, // Immutable snapshot price at time of sale
    val discountAmount: Double,
    val taxableAmount: Double,
    val gstPercent: Double,
    val gstAmount: Double,
    val totalAmount: Double
)

@Entity(
    tableName = "restaurant_orders",
    indices = [
        Index(value = ["orderNumber"], unique = true),
        Index(value = ["idempotencyKey"], unique = true),
        Index(value = ["syncStatus"])
    ]
)
data class RestaurantOrderEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val orderNumber: String,
    val tokenNumber: String,
    val businessId: String = "mozz_starters4u",
    val branchId: String,
    val branchCode: String,
    val tableOrCounter: String = "Counter 1",
    val orderType: String = "dine_in",
    val deviceId: String,
    val localRecordId: String = UUID.randomUUID().toString(),
    val idempotencyKey: String,
    val customerName: String?,
    val customerPhone: String?,
    val paymentMode: String,
    val subtotal: Double,
    val discountAmount: Double,
    val cgstRate: Double = 2.5,
    val cgstAmount: Double,
    val sgstRate: Double = 2.5,
    val sgstAmount: Double,
    val totalTax: Double,
    val grandTotal: Double,
    val catalogRevisionAtSale: Long = 200L, // Immutable price snapshot revision
    val specialInstructions: String? = null,
    val kotPrinted: Boolean = false,
    val billPrinted: Boolean = false,
    val syncStatus: String = "PENDING",
    val syncError: String? = null,
    val createdAtLocal: Long = System.currentTimeMillis(),
    val createdAtServer: Long? = null
)

@Entity(
    tableName = "restaurant_order_items",
    foreignKeys = [
        ForeignKey(
            entity = RestaurantOrderEntity::class,
            parentColumns = ["id"],
            childColumns = ["orderId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["orderId"])]
)
data class RestaurantOrderItemEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val orderId: String,
    val itemId: String,
    val itemName: String,
    val categoryName: String,
    val variantId: String?,
    val variantName: String?,
    val quantity: Int,
    val unitPrice: Double, // Immutable snapshot price at time of sale
    val totalPrice: Double,
    val notes: String? = null
)

@Entity(
    tableName = "print_jobs",
    indices = [
        Index(value = ["billNumber"]),
        Index(value = ["status"])
    ]
)
data class PrintJobEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val localJobId: String = UUID.randomUUID().toString(),
    val billNumber: String,
    val printerMac: String?,
    val printerName: String?,
    val printerPurpose: String, // salon_receipt, mozz_bill, mozz_kot
    val paperWidthMm: Int = 80,
    val jobType: String, // customer_bill, kitchen_kot, test_print
    val status: String = "PENDING", // PENDING, PRINTING, PRINTED, OFFLINE, FAILED
    val retryCount: Int = 0,
    val rawBytesHex: String? = null,
    val errorMessage: String? = null,
    val createdAtLocal: Long = System.currentTimeMillis(),
    val printedAtLocal: Long? = null
)

@Entity(
    tableName = "sync_queue",
    indices = [
        Index(value = ["idempotencyKey"], unique = true),
        Index(value = ["status"])
    ]
)
data class SyncQueueEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val idempotencyKey: String,
    val entityType: String, // salon_bill, restaurant_order, print_status
    val recordId: String,
    val payloadJson: String,
    val status: String = "QUEUED", // QUEUED, SYNCING, SYNCED, CONFLICT, FAILED
    val retryCount: Int = 0,
    val lastError: String? = null,
    val createdAtLocal: Long = System.currentTimeMillis(),
    val syncedAtServer: Long? = null
)

// -------------------------------------------------------------------------------------------------
// Authoritative Cached Catalog Entities with Revisions and Deletion Tombstones
// -------------------------------------------------------------------------------------------------
@Entity(
    tableName = "cached_salon_services",
    indices = [
        Index(value = ["businessId", "revision"]),
        Index(value = ["category"])
    ]
)
data class CachedSalonServiceEntity(
    @PrimaryKey
    val id: String,
    val businessId: String = "the_glossy_looks",
    val name: String,
    val category: String,
    val subcategory: String = "",
    val price: Double,
    val gstPercent: Double = 18.0,
    val durationMinutes: Int = 30,
    val isDiscountEligible: Boolean = true,
    val isActive: Boolean = true,
    val isDeleted: Boolean = false, // Tombstone
    val revision: Long = 100L,
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "cached_restaurant_menu_items",
    indices = [
        Index(value = ["businessId", "revision"]),
        Index(value = ["category"])
    ]
)
data class CachedMenuItemEntity(
    @PrimaryKey
    val id: String,
    val businessId: String = "mozz_starters4u",
    val name: String,
    val category: String,
    val basePrice: Double,
    val isVeg: Boolean = false,
    val variantsJson: String = "[]",
    val isAvailable: Boolean = true,
    val isDeleted: Boolean = false, // Tombstone
    val revision: Long = 200L,
    val updatedAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "catalog_sync_state")
data class CatalogSyncStateEntity(
    @PrimaryKey
    val businessId: String,
    val currentRevision: Long = 0L,
    val lastSyncTimestamp: Long = 0L,
    val status: String = "SYNCED", // SYNCED, STALE, SYNCING, ERROR
    val totalCachedItems: Int = 0,
    val lastError: String? = null
)
