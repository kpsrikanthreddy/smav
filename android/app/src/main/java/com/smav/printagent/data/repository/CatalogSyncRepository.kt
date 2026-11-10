package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.Gson
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.entities.CachedMenuItemEntity
import com.smav.printagent.data.local.entities.CachedSalonServiceEntity
import com.smav.printagent.data.local.entities.CatalogSyncStateEntity
import com.smav.printagent.network.ApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class CatalogSyncRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val sessionManager: SessionManager
) {

    private val gson = Gson()

    private fun getApiService(): ApiService {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()

        val baseUrl = sessionManager.getServerUrl().let {
            if (it.endsWith("/")) it else "$it/"
        }

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    fun getActiveSalonServices(): Flow<List<CachedSalonServiceEntity>> {
        return database.cachedCatalogDao().getActiveSalonServicesFlow()
    }

    fun getActiveMenuItems(): Flow<List<CachedMenuItemEntity>> {
        return database.cachedCatalogDao().getActiveMenuItemsFlow()
    }

    fun getSyncState(businessId: String): Flow<CatalogSyncStateEntity?> {
        return database.cachedCatalogDao().getSyncStateFlow(businessId)
    }

    /**
     * Executes version-based delta sync or full reconciliation against authoritative Supabase backend.
     */
    suspend fun syncCatalog(businessId: String): Result<CatalogSyncStateEntity> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("No active staff session"))

        // Enforce tenant isolation: staff cannot sync catalog of another business
        if (session.businessType.id != businessId) {
            return@withContext Result.failure(IllegalStateException("Access denied: Tenant isolation violated"))
        }

        val token = "Bearer ${session.token}"
        val api = getApiService()
        val localState = database.cachedCatalogDao().getSyncState(businessId)
        val sinceRevision = localState?.currentRevision ?: 0L

        try {
            val response = api.getCatalogDeltaSync(
                token = token,
                businessId = businessId,
                sinceRevision = sinceRevision,
                branchId = session.branchId
            )

            if (!response.isSuccessful || response.body() == null) {
                val errorMsg = response.errorBody()?.string() ?: "HTTP ${response.code()}"
                val errorState = CatalogSyncStateEntity(
                    businessId = businessId,
                    currentRevision = sinceRevision,
                    lastSyncTimestamp = System.currentTimeMillis(),
                    status = "ERROR",
                    lastError = errorMsg
                )
                database.cachedCatalogDao().saveSyncState(errorState)
                return@withContext Result.failure(Exception(errorMsg))
            }

            val body = response.body()!!

            if (businessId == "the_glossy_looks") {
                val tombstones = mutableListOf<String>()
                val toUpsert = mutableListOf<CachedSalonServiceEntity>()

                for (change in body.changes) {
                    val id = change["id"] as? String ?: continue
                    val isDeleted = change["isDeleted"] as? Boolean ?: false
                    val isActive = change["isActive"] as? Boolean ?: true

                    if (isDeleted || !isActive) {
                        tombstones.add(id)
                    } else {
                        val name = change["name"] as? String ?: "Service"
                        val category = change["category"] as? String ?: "General"
                        val subcategory = change["subcategory"] as? String ?: ""
                        val price = (change["price"] as? Number)?.toDouble() ?: 0.0
                        val gstPercent = (change["gstPercent"] as? Number)?.toDouble() ?: 18.0
                        val revision = (change["revision"] as? Number)?.toLong() ?: body.currentRevision

                        toUpsert.add(
                            CachedSalonServiceEntity(
                                id = id,
                                businessId = businessId,
                                name = name,
                                category = category,
                                subcategory = subcategory,
                                price = price,
                                gstPercent = gstPercent,
                                isDiscountEligible = true,
                                isActive = true,
                                isDeleted = false,
                                revision = revision,
                                updatedAt = System.currentTimeMillis()
                            )
                        )
                    }
                }

                if (toUpsert.isNotEmpty()) {
                    database.cachedCatalogDao().upsertSalonServices(toUpsert)
                }
                if (tombstones.isNotEmpty()) {
                    database.cachedCatalogDao().applySalonServiceTombstones(tombstones)
                }
            } else if (businessId == "mozz_starters4u") {
                val tombstones = mutableListOf<String>()
                val toUpsert = mutableListOf<CachedMenuItemEntity>()

                for (change in body.changes) {
                    val id = change["id"] as? String ?: continue
                    val isDeleted = change["isDeleted"] as? Boolean ?: false
                    val isAvailable = change["isAvailable"] as? Boolean ?: true

                    if (isDeleted || !isAvailable) {
                        tombstones.add(id)
                    } else {
                        val name = change["name"] as? String ?: "Item"
                        val category = change["category"] as? String ?: "Starters"
                        val basePrice = (change["basePrice"] as? Number)?.toDouble() ?: 0.0
                        val isVeg = change["isVeg"] as? Boolean ?: false
                        val variants = change["variants"]
                        val variantsJson = if (variants != null) gson.toJson(variants) else "[]"
                        val revision = (change["revision"] as? Number)?.toLong() ?: body.currentRevision

                        toUpsert.add(
                            CachedMenuItemEntity(
                                id = id,
                                businessId = businessId,
                                name = name,
                                category = category,
                                basePrice = basePrice,
                                isVeg = isVeg,
                                variantsJson = variantsJson,
                                isAvailable = true,
                                isDeleted = false,
                                revision = revision,
                                updatedAt = System.currentTimeMillis()
                            )
                        )
                    }
                }

                if (toUpsert.isNotEmpty()) {
                    database.cachedCatalogDao().upsertMenuItems(toUpsert)
                }
                if (tombstones.isNotEmpty()) {
                    database.cachedCatalogDao().applyMenuItemTombstones(tombstones)
                }
            }

            val updatedState = CatalogSyncStateEntity(
                businessId = businessId,
                currentRevision = body.currentRevision,
                lastSyncTimestamp = System.currentTimeMillis(),
                status = "SYNCED",
                totalCachedItems = body.totalActiveItems,
                lastError = null
            )
            database.cachedCatalogDao().saveSyncState(updatedState)

            Result.success(updatedState)
        } catch (e: Exception) {
            val errorState = CatalogSyncStateEntity(
                businessId = businessId,
                currentRevision = sinceRevision,
                lastSyncTimestamp = System.currentTimeMillis(),
                status = "ERROR",
                lastError = e.message
            )
            database.cachedCatalogDao().saveSyncState(errorState)
            Result.failure(e)
        }
    }
}
