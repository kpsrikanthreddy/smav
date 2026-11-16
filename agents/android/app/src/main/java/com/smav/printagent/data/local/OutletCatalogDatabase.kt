package com.smav.printagent.data.local

import android.content.Context
import androidx.room.*
import java.security.MessageDigest

/** Separate lightweight catalog DB per authorized outlet. No cross-outlet catalog rows. */
@Entity(tableName = "outlet_catalog", primaryKeys = ["itemId"])
data class OutletCatalogItem(
    val itemId: String,
    val name: String,
    val category: String,
    val subcategory: String,
    val price: Double,
    val itemType: String,
    val active: Boolean = true
)

@Entity(tableName = "catalog_metadata")
data class OutletCatalogMetadata(
    @PrimaryKey val key: String = "current",
    val source: String,
    val fetchedAt: Long,
    val itemCount: Int
)

@Dao
interface OutletCatalogDao {
    @Query("SELECT * FROM outlet_catalog WHERE active = 1 ORDER BY category, name")
    fun observeItems(): kotlinx.coroutines.flow.Flow<List<OutletCatalogItem>>

    @Query("SELECT * FROM catalog_metadata WHERE `key` = 'current' LIMIT 1")
    suspend fun metadata(): OutletCatalogMetadata?

    @Query("DELETE FROM outlet_catalog")
    suspend fun clearCatalog()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItems(items: List<OutletCatalogItem>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMetadata(metadata: OutletCatalogMetadata)

    @Transaction
    suspend fun replaceSnapshot(items: List<OutletCatalogItem>, metadata: OutletCatalogMetadata) {
        clearCatalog()
        insertItems(items)
        putMetadata(metadata)
    }
}

@Database(entities = [OutletCatalogItem::class, OutletCatalogMetadata::class], version = 1, exportSchema = false)
abstract class OutletCatalogDatabase : RoomDatabase() {
    abstract fun catalogDao(): OutletCatalogDao

    companion object {
        /** Use the central outlet UUID, not business type or user-provided display names. */
        fun open(context: Context, outletId: String): OutletCatalogDatabase {
            require(Regex("^[0-9a-fA-F-]{36}$").matches(outletId) &&
                runCatching { java.util.UUID.fromString(outletId) }.isSuccess) { "Invalid outlet UUID" }
            val hash = MessageDigest.getInstance("SHA-256")
                .digest(outletId.lowercase().toByteArray())
                .take(16).joinToString("") { "%02x".format(it) }
            return Room.databaseBuilder(context.applicationContext, OutletCatalogDatabase::class.java,
                "smav_catalog_$hash.db").build()
        }
    }
}
