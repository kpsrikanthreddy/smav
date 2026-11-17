package com.smav.printagent.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.smav.printagent.data.local.dao.CachedCatalogDao
import com.smav.printagent.data.local.dao.PrintJobDao
import com.smav.printagent.data.local.dao.RestaurantOrderDao
import com.smav.printagent.data.local.dao.RetailBillDao
import com.smav.printagent.data.local.dao.SalonBillDao
import com.smav.printagent.data.local.dao.SyncQueueDao
import com.smav.printagent.data.local.entities.CachedMenuItemEntity
import com.smav.printagent.data.local.entities.CachedSalonServiceEntity
import com.smav.printagent.data.local.entities.CatalogSyncStateEntity
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.RetailBillEntity
import com.smav.printagent.data.local.entities.RetailBillItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.data.local.entities.SyncQueueEntity

@Database(
    entities = [
        SalonBillEntity::class,
        SalonBillItemEntity::class,
        RestaurantOrderEntity::class,
        RestaurantOrderItemEntity::class,
        PrintJobEntity::class,
        SyncQueueEntity::class,
        CachedSalonServiceEntity::class,
        CachedMenuItemEntity::class,
        CatalogSyncStateEntity::class,
        RetailBillEntity::class,
        RetailBillItemEntity::class
    ],
    version = 3,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun salonBillDao(): SalonBillDao
    abstract fun restaurantOrderDao(): RestaurantOrderDao
    abstract fun retailBillDao(): RetailBillDao
    abstract fun printJobDao(): PrintJobDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun cachedCatalogDao(): CachedCatalogDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `retail_bills` (
                        `id` TEXT NOT NULL,
                        `billNumber` TEXT NOT NULL,
                        `outletId` TEXT NOT NULL,
                        `branchCode` TEXT NOT NULL,
                        `deviceId` TEXT NOT NULL,
                        `idempotencyKey` TEXT NOT NULL,
                        `customerName` TEXT,
                        `customerPhone` TEXT,
                        `paymentMode` TEXT NOT NULL,
                        `subtotal` REAL NOT NULL,
                        `discountAmount` REAL NOT NULL,
                        `totalTax` REAL NOT NULL,
                        `grandTotal` REAL NOT NULL,
                        `roundOff` REAL NOT NULL,
                        `syncStatus` TEXT NOT NULL,
                        `syncError` TEXT,
                        `createdAtLocal` INTEGER NOT NULL,
                        `createdAtServer` INTEGER,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_retail_bills_billNumber` ON `retail_bills` (`billNumber`)")
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_retail_bills_idempotencyKey` ON `retail_bills` (`idempotencyKey`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_retail_bills_syncStatus` ON `retail_bills` (`syncStatus`)")

                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `retail_bill_items` (
                        `id` TEXT NOT NULL,
                        `billId` TEXT NOT NULL,
                        `productId` TEXT NOT NULL,
                        `productName` TEXT NOT NULL,
                        `categoryName` TEXT NOT NULL,
                        `quantity` INTEGER NOT NULL,
                        `unitPrice` REAL NOT NULL,
                        `discountAmount` REAL NOT NULL,
                        `gstPercent` REAL NOT NULL,
                        `gstAmount` REAL NOT NULL,
                        `totalAmount` REAL NOT NULL,
                        PRIMARY KEY(`id`),
                        FOREIGN KEY(`billId`) REFERENCES `retail_bills`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_retail_bill_items_billId` ON `retail_bill_items` (`billId`)")
            }
        }

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "smav_print_agent.db"
                )
                    .addMigrations(MIGRATION_2_3)
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
