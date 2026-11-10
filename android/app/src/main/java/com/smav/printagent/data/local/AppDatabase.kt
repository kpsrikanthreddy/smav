package com.smav.printagent.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.smav.printagent.data.local.dao.CachedCatalogDao
import com.smav.printagent.data.local.dao.PrintJobDao
import com.smav.printagent.data.local.dao.RestaurantOrderDao
import com.smav.printagent.data.local.dao.SalonBillDao
import com.smav.printagent.data.local.dao.SyncQueueDao
import com.smav.printagent.data.local.entities.CachedMenuItemEntity
import com.smav.printagent.data.local.entities.CachedSalonServiceEntity
import com.smav.printagent.data.local.entities.CatalogSyncStateEntity
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
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
        CatalogSyncStateEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun salonBillDao(): SalonBillDao
    abstract fun restaurantOrderDao(): RestaurantOrderDao
    abstract fun printJobDao(): PrintJobDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun cachedCatalogDao(): CachedCatalogDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "smav_print_agent.db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
