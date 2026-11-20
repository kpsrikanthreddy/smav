package com.smav.printagent.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.smav.printagent.data.local.entities.CachedMenuItemEntity
import com.smav.printagent.data.local.entities.CachedSalonServiceEntity
import com.smav.printagent.data.local.entities.CatalogSyncStateEntity
import com.smav.printagent.data.local.entities.PreallocatedBillNumberEntity
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.data.local.entities.SyncQueueEntity
import kotlinx.coroutines.flow.Flow

data class SalonBillWithItems(
    val bill: SalonBillEntity,
    val items: List<SalonBillItemEntity>
)

data class RestaurantOrderWithItems(
    val order: RestaurantOrderEntity,
    val items: List<RestaurantOrderItemEntity>
)

@Dao
interface SalonBillDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBill(bill: SalonBillEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<SalonBillItemEntity>)

    @Transaction
    suspend fun insertBillWithItems(bill: SalonBillEntity, items: List<SalonBillItemEntity>) {
        insertBill(bill)
        insertItems(items)
    }

    @Query("SELECT * FROM salon_bills ORDER BY createdAtLocal DESC")
    fun getAllBills(): Flow<List<SalonBillEntity>>

    @Query("SELECT * FROM salon_bills WHERE branchId = :branchId ORDER BY createdAtLocal DESC")
    fun getBillsForBranch(branchId: String): Flow<List<SalonBillEntity>>

    @Query("SELECT * FROM salon_bills WHERE branchId = :branchId AND isVoided = 0 AND createdAtLocal >= :startOfDayMs ORDER BY createdAtLocal DESC")
    fun getTodayActiveBillsForBranch(branchId: String, startOfDayMs: Long): Flow<List<SalonBillEntity>>

    @Query("SELECT * FROM salon_bills WHERE id = :id LIMIT 1")
    suspend fun getBillById(id: String): SalonBillEntity?

    @Query("SELECT * FROM salon_bills WHERE billNumber = :billNumber LIMIT 1")
    suspend fun getBillByNumber(billNumber: String): SalonBillEntity?

    @Query("SELECT * FROM salon_bill_items WHERE billId = :billId")
    suspend fun getItemsForBill(billId: String): List<SalonBillItemEntity>

    @Query("DELETE FROM salon_bill_items WHERE billId = :billId")
    suspend fun deleteItemsForBill(billId: String)

    @Transaction
    suspend fun replaceBillAndItems(bill: SalonBillEntity, items: List<SalonBillItemEntity>) {
        insertBill(bill)
        deleteItemsForBill(bill.id)
        insertItems(items)
    }

    @Transaction
    suspend fun getBillWithItems(billId: String): SalonBillWithItems? {
        val bill = getBillById(billId) ?: return null
        val items = getItemsForBill(billId)
        return SalonBillWithItems(bill, items)
    }

    @Query("SELECT * FROM salon_bills WHERE (syncStatus = 'PENDING' OR syncStatus = 'FAILED') AND isVoided = 0 ORDER BY createdAtLocal ASC")
    suspend fun getUnsyncedBills(): List<SalonBillEntity>

    @Query("UPDATE salon_bills SET syncStatus = :status, syncError = :error, createdAtServer = :serverTime WHERE id = :id OR billNumber = :id")
    suspend fun updateSyncStatus(id: String, status: String, error: String?, serverTime: Long?)

    @Query("UPDATE salon_bills SET isVoided = 1, voidReason = :reason, voidedAtLocal = :voidedAt, voidedBy = :voidedBy, updatedAtLocal = :voidedAt, conflictMessage = NULL WHERE id = :id")
    suspend fun markVoided(id: String, reason: String, voidedAt: Long, voidedBy: String)

    @Query("UPDATE salon_bills SET conflictMessage = :message, syncStatus = 'CONFLICT' WHERE id = :id OR billNumber = :id")
    suspend fun markConflict(id: String, message: String?)

    @Query("SELECT COUNT(*) FROM salon_bills WHERE syncStatus != 'SYNCED' AND isVoided = 0")
    fun countPendingBills(): Flow<Int>

    @Query("SELECT COUNT(*) FROM salon_bills WHERE branchId = :branchId AND syncStatus != 'SYNCED' AND isVoided = 0")
    fun countPendingBillsForBranch(branchId: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM salon_bills WHERE branchCode = :branchCode AND billNumber LIKE :prefix")
    suspend fun countBillsMatchingPrefix(branchCode: String, prefix: String): Int
}

@Dao
interface RestaurantOrderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrder(order: RestaurantOrderEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<RestaurantOrderItemEntity>)

    @Transaction
    suspend fun insertOrderWithItems(order: RestaurantOrderEntity, items: List<RestaurantOrderItemEntity>) {
        insertOrder(order)
        insertItems(items)
    }

    @Query("SELECT * FROM restaurant_orders ORDER BY createdAtLocal DESC")
    fun getAllOrders(): Flow<List<RestaurantOrderEntity>>

    @Query("SELECT * FROM restaurant_orders WHERE branchId = :branchId ORDER BY createdAtLocal DESC")
    fun getOrdersForBranch(branchId: String): Flow<List<RestaurantOrderEntity>>

    @Query("SELECT * FROM restaurant_orders WHERE branchId = :branchId AND isVoided = 0 AND createdAtLocal >= :startOfDayMs ORDER BY createdAtLocal DESC")
    fun getTodayActiveOrdersForBranch(branchId: String, startOfDayMs: Long): Flow<List<RestaurantOrderEntity>>

    @Query("SELECT * FROM restaurant_orders WHERE id = :id LIMIT 1")
    suspend fun getOrderById(id: String): RestaurantOrderEntity?

    @Query("SELECT * FROM restaurant_order_items WHERE orderId = :orderId")
    suspend fun getItemsForOrder(orderId: String): List<RestaurantOrderItemEntity>

    @Query("DELETE FROM restaurant_order_items WHERE orderId = :orderId")
    suspend fun deleteItemsForOrder(orderId: String)

    @Transaction
    suspend fun replaceOrderAndItems(order: RestaurantOrderEntity, items: List<RestaurantOrderItemEntity>) {
        insertOrder(order)
        deleteItemsForOrder(order.id)
        insertItems(items)
    }

    @Transaction
    suspend fun getOrderWithItems(orderId: String): RestaurantOrderWithItems? {
        val order = getOrderById(orderId) ?: return null
        val items = getItemsForOrder(orderId)
        return RestaurantOrderWithItems(order, items)
    }

    @Query("SELECT * FROM restaurant_orders WHERE (syncStatus = 'PENDING' OR syncStatus = 'FAILED') AND isVoided = 0 ORDER BY createdAtLocal ASC")
    suspend fun getUnsyncedOrders(): List<RestaurantOrderEntity>

    @Query("UPDATE restaurant_orders SET syncStatus = :status, syncError = :error, createdAtServer = :serverTime WHERE id = :id OR orderNumber = :id")
    suspend fun updateSyncStatus(id: String, status: String, error: String?, serverTime: Long?)

    @Query("UPDATE restaurant_orders SET isVoided = 1, voidReason = :reason, voidedAtLocal = :voidedAt, voidedBy = :voidedBy, updatedAtLocal = :voidedAt, conflictMessage = NULL WHERE id = :id")
    suspend fun markVoided(id: String, reason: String, voidedAt: Long, voidedBy: String)

    @Query("UPDATE restaurant_orders SET conflictMessage = :message, syncStatus = 'CONFLICT' WHERE id = :id OR orderNumber = :id")
    suspend fun markConflict(id: String, message: String?)

    @Query("UPDATE restaurant_orders SET kotPrinted = :printed WHERE id = :id")
    suspend fun updateKotPrinted(id: String, printed: Boolean)

    @Query("UPDATE restaurant_orders SET billPrinted = :printed WHERE id = :id")
    suspend fun updateBillPrinted(id: String, printed: Boolean)

    @Query("SELECT COUNT(*) FROM restaurant_orders WHERE syncStatus != 'SYNCED' AND isVoided = 0")
    fun countPendingOrders(): Flow<Int>

    @Query("SELECT COUNT(*) FROM restaurant_orders WHERE branchId = :branchId AND syncStatus != 'SYNCED' AND isVoided = 0")
    fun countPendingOrdersForBranch(branchId: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM restaurant_orders WHERE branchCode = :branchCode AND orderNumber LIKE :prefix")
    suspend fun countOrdersMatchingPrefix(branchCode: String, prefix: String): Int
}

@Dao
interface PrintJobDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertJob(job: PrintJobEntity)

    @Query("SELECT * FROM print_jobs WHERE status = 'PENDING' OR status = 'OFFLINE' ORDER BY createdAtLocal ASC")
    suspend fun getPendingJobs(): List<PrintJobEntity>

    @Query("SELECT * FROM print_jobs ORDER BY createdAtLocal DESC")
    fun getAllJobsFlow(): Flow<List<PrintJobEntity>>

    @Query("UPDATE print_jobs SET status = :status, errorMessage = :error, printedAtLocal = :printedTime WHERE id = :id")
    suspend fun updateJobStatus(id: String, status: String, error: String?, printedTime: Long?)

    @Query("UPDATE print_jobs SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: String)

    @Query("SELECT COUNT(*) FROM print_jobs WHERE status = 'PENDING' OR status = 'OFFLINE' OR status = 'FAILED'")
    fun countPendingJobs(): Flow<Int>
}

@Dao
interface SyncQueueDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertSyncItem(item: SyncQueueEntity)

    @Query("SELECT * FROM sync_queue WHERE status = 'QUEUED' OR status = 'FAILED' ORDER BY createdAtLocal ASC")
    suspend fun getQueuedItems(): List<SyncQueueEntity>

    @Query("UPDATE sync_queue SET status = :status, lastError = :error WHERE id = :id")
    suspend fun updateStatus(id: String, status: String, error: String?)

    @Query("UPDATE sync_queue SET status = 'SYNCED', syncedAtServer = :serverTime WHERE id = :id")
    suspend fun markSynced(id: String, serverTime: Long)

    @Query("UPDATE sync_queue SET retryCount = retryCount + 1, lastError = :error WHERE id = :id")
    suspend fun recordRetry(id: String, error: String?)

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status != 'SYNCED'")
    fun countPendingSync(): Flow<Int>

    @Query("SELECT * FROM sync_queue ORDER BY createdAtLocal DESC")
    fun getAllSyncHistory(): Flow<List<SyncQueueEntity>>
}

// -------------------------------------------------------------------------------------------------
// Authoritative Cached Catalog DAO with Delta Sync & Deletion Tombstone Support
// -------------------------------------------------------------------------------------------------
@Dao
interface CachedCatalogDao {
    // Salon Services
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSalonServices(services: List<CachedSalonServiceEntity>)

    @Query("UPDATE cached_salon_services SET isDeleted = 1, isActive = 0, updatedAt = :timestamp WHERE id IN (:ids)")
    suspend fun applySalonServiceTombstones(ids: List<String>, timestamp: Long = System.currentTimeMillis())

    @Query("SELECT * FROM cached_salon_services WHERE isDeleted = 0 AND isActive = 1 ORDER BY category ASC, name ASC")
    fun getActiveSalonServicesFlow(): Flow<List<CachedSalonServiceEntity>>

    @Query("SELECT * FROM cached_salon_services WHERE id = :id LIMIT 1")
    suspend fun getSalonServiceById(id: String): CachedSalonServiceEntity?

    @Query("SELECT COUNT(*) FROM cached_salon_services WHERE isDeleted = 0 AND isActive = 1")
    fun countActiveSalonServices(): Flow<Int>

    // Restaurant Menu Items
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMenuItems(items: List<CachedMenuItemEntity>)

    @Query("UPDATE cached_restaurant_menu_items SET isDeleted = 1, isAvailable = 0, updatedAt = :timestamp WHERE id IN (:ids)")
    suspend fun applyMenuItemTombstones(ids: List<String>, timestamp: Long = System.currentTimeMillis())

    @Query("SELECT * FROM cached_restaurant_menu_items WHERE isDeleted = 0 AND isAvailable = 1 ORDER BY category ASC, name ASC")
    fun getActiveMenuItemsFlow(): Flow<List<CachedMenuItemEntity>>

    @Query("SELECT * FROM cached_restaurant_menu_items WHERE id = :id LIMIT 1")
    suspend fun getMenuItemById(id: String): CachedMenuItemEntity?

    @Query("SELECT COUNT(*) FROM cached_restaurant_menu_items WHERE isDeleted = 0 AND isAvailable = 1")
    fun countActiveMenuItems(): Flow<Int>

    // Catalog Sync Cursor & State
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSyncState(state: CatalogSyncStateEntity)

    @Query("SELECT * FROM catalog_sync_state WHERE businessId = :businessId LIMIT 1")
    suspend fun getSyncState(businessId: String): CatalogSyncStateEntity?

    @Query("SELECT * FROM catalog_sync_state WHERE businessId = :businessId LIMIT 1")
    fun getSyncStateFlow(businessId: String): Flow<CatalogSyncStateEntity?>
}

data class RetailBillWithItems(
    val bill: com.smav.printagent.data.local.entities.RetailBillEntity,
    val items: List<com.smav.printagent.data.local.entities.RetailBillItemEntity>
)

@Dao
interface RetailBillDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertBill(bill: com.smav.printagent.data.local.entities.RetailBillEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<com.smav.printagent.data.local.entities.RetailBillItemEntity>)

    @Transaction
    suspend fun insertBillWithItems(
        bill: com.smav.printagent.data.local.entities.RetailBillEntity,
        items: List<com.smav.printagent.data.local.entities.RetailBillItemEntity>
    ) {
        insertBill(bill)
        insertItems(items)
    }

    @Query("SELECT * FROM retail_bills WHERE outletId = :outletId ORDER BY createdAtLocal DESC")
    fun getBillsForOutlet(outletId: String): Flow<List<com.smav.printagent.data.local.entities.RetailBillEntity>>

    @Query("SELECT * FROM retail_bills WHERE outletId = :outletId AND isVoided = 0 AND createdAtLocal >= :startOfDayMs ORDER BY createdAtLocal DESC")
    fun getTodayActiveBillsForOutlet(outletId: String, startOfDayMs: Long): Flow<List<com.smav.printagent.data.local.entities.RetailBillEntity>>

    @Query("SELECT * FROM retail_bills WHERE id = :id LIMIT 1")
    suspend fun getBillById(id: String): com.smav.printagent.data.local.entities.RetailBillEntity?

    @Query("SELECT * FROM retail_bill_items WHERE billId = :billId")
    suspend fun getItemsForBill(billId: String): List<com.smav.printagent.data.local.entities.RetailBillItemEntity>

    @Query("DELETE FROM retail_bill_items WHERE billId = :billId")
    suspend fun deleteItemsForBill(billId: String)

    @Transaction
    suspend fun replaceBillAndItems(
        bill: com.smav.printagent.data.local.entities.RetailBillEntity,
        items: List<com.smav.printagent.data.local.entities.RetailBillItemEntity>
    ) {
        insertBill(bill)
        deleteItemsForBill(bill.id)
        insertItems(items)
    }

    @Transaction
    suspend fun getBillWithItems(billId: String): RetailBillWithItems? {
        val bill = getBillById(billId) ?: return null
        return RetailBillWithItems(bill, getItemsForBill(billId))
    }

    @Query("SELECT * FROM retail_bills WHERE (syncStatus = 'PENDING' OR syncStatus = 'FAILED') AND isVoided = 0 ORDER BY createdAtLocal ASC")
    suspend fun getUnsyncedBills(): List<com.smav.printagent.data.local.entities.RetailBillEntity>

    @Query("UPDATE retail_bills SET isVoided = 1, voidReason = :reason, voidedAtLocal = :voidedAt, voidedBy = :voidedBy, updatedAtLocal = :voidedAt, conflictMessage = NULL WHERE id = :id")
    suspend fun markVoided(id: String, reason: String, voidedAt: Long, voidedBy: String)

    @Query("UPDATE retail_bills SET conflictMessage = :message, syncStatus = 'CONFLICT' WHERE id = :id OR billNumber = :id")
    suspend fun markConflict(id: String, message: String?)

    @Query("SELECT COUNT(*) FROM retail_bills WHERE syncStatus != 'SYNCED' AND isVoided = 0")
    fun countPendingBills(): Flow<Int>

    @Query("SELECT COUNT(*) FROM retail_bills WHERE branchCode = :branchCode AND billNumber LIKE :prefix")
    suspend fun countBillsMatchingPrefix(branchCode: String, prefix: String): Int
}

@Dao
interface PreallocatedBillNumberDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(items: List<PreallocatedBillNumberEntity>)

    @Query(
        """
        SELECT * FROM preallocated_bill_numbers
        WHERE outletId = :outletId
          AND branchCode = :branchCode
          AND billingDate = :billingDate
          AND status = 'AVAILABLE'
        ORDER BY sequenceNumber ASC
        LIMIT 1
        """
    )
    suspend fun peekNextAvailable(
        outletId: String,
        branchCode: String,
        billingDate: String
    ): PreallocatedBillNumberEntity?

    @Query(
        """
        UPDATE preallocated_bill_numbers
        SET status = 'CONSUMED',
            consumedAtLocal = :consumedAt,
            consumedByBillId = :billId
        WHERE centralBillId = :centralBillId
          AND status = 'AVAILABLE'
        """
    )
    suspend fun markConsumed(
        centralBillId: String,
        consumedAt: Long,
        billId: String
    ): Int

    /**
     * Atomically consumes a single preallocated central bill number for a branch & India date.
     * Permanently marks CONSUMED inside a Room transaction before returning so it is never reused
     * on cancellation, print failure, app restart, or sync retry.
     */
    @Transaction
    suspend fun claimNextAvailable(
        outletId: String,
        branchCode: String,
        billingDate: String,
        billId: String
    ): PreallocatedBillNumberEntity? {
        val next = peekNextAvailable(outletId, branchCode, billingDate) ?: return null
        val nowMs = System.currentTimeMillis()
        val updated = markConsumed(next.centralBillId, nowMs, billId)
        return if (updated == 1) {
            next.copy(status = "CONSUMED", consumedAtLocal = nowMs, consumedByBillId = billId)
        } else {
            null
        }
    }

    @Query(
        """
        SELECT COUNT(*) FROM preallocated_bill_numbers
        WHERE outletId = :outletId
          AND branchCode = :branchCode
          AND billingDate = :billingDate
          AND status = 'AVAILABLE'
        """
    )
    suspend fun countAvailable(
        outletId: String,
        branchCode: String,
        billingDate: String
    ): Int

    @Query(
        """
        UPDATE preallocated_bill_numbers
        SET status = 'EXPIRED'
        WHERE billingDate < :todayBillingDate
          AND status = 'AVAILABLE'
        """
    )
    suspend fun expireBeforeDate(todayBillingDate: String)
}
