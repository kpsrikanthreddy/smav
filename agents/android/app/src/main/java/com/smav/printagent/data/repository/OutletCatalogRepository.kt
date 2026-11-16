package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.JsonObject
import com.smav.printagent.data.local.OutletCatalogDatabase
import com.smav.printagent.data.local.OutletCatalogItem
import com.smav.printagent.data.local.OutletCatalogMetadata
import com.smav.printagent.network.ApiService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.collect
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

/** B1/B2: explicitly outlet-scoped catalog cache and validated full snapshot download.
 * No business images, customers, or other outlets are downloaded.
 */
class OutletCatalogRepository(private val context: Context, private val sessions: SessionManager) {
    fun observe(outletId: String): kotlinx.coroutines.flow.Flow<List<OutletCatalogItem>> =
        kotlinx.coroutines.flow.flow {
            val db = OutletCatalogDatabase.open(context, outletId)
            try { db.catalogDao().observeItems().collect { emit(it) } }
            finally { db.close() }
        }

    /** Caller must pass the central outlet UUID selected in the authenticated session.
     * The backend independently enforces authorization. Never use a business slug as outletId.
     */
    suspend fun refresh(outletId: String, expectedOutletId: String): Result<Int> = withContext(Dispatchers.IO) {
        if (outletId != expectedOutletId || !sessions.isLoggedIn())
            return@withContext Result.failure(SecurityException("Active outlet mismatch"))
        val session = sessions.getStaffSession()
            ?: return@withContext Result.failure(SecurityException("No session"))
        if (session.token.isBlank()) return@withContext Result.failure(SecurityException("Missing token"))
        val db = OutletCatalogDatabase.open(context, outletId)
        try {
            val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS).build()
            val api = Retrofit.Builder()
                .baseUrl(sessions.getServerUrl().trimEnd('/') + "/")
                .client(client).addConverterFactory(GsonConverterFactory.create())
                .build().create(ApiService::class.java)
            val rows = mutableListOf<OutletCatalogItem>()
            var offset = 0
            var expectedTotal: Int? = null
            var sourceName: String? = null
            do {
                val response = api.getOutletSourceCatalog("Bearer ${session.token}", outletId, 200, offset)
                if (!response.isSuccessful) error("Catalog request failed: HTTP ${response.code()}")
                val body = response.body() ?: error("Empty catalog response")
                if (!body.get("success").asBoolean || body.get("outletId").asString != outletId)
                    error("Outlet response mismatch")
                // Cached/derived MOZZ source is not yet authoritative. Do not replace local data with it.
                if (!body.get("fresh").asBoolean) error("Source is not authoritative/fresh")
                val total = body.get("total").asInt
                if (total < 0 || total > 10000 || (expectedTotal != null && total != expectedTotal))
                    error("Invalid or changing catalog size")
                expectedTotal = total
                val source = body.get("source").asString
                if (sourceName != null && sourceName != source) error("Source changed during download")
                sourceName = source
                val items = body.getAsJsonArray("items") ?: error("Missing catalog items")
                for (element in items) {
                    val item = element.asJsonObject
                    val id = item.string("external_item_id")
                    val name = item.string("name")
                    val price = item.get("price")?.asDouble ?: error("Missing price")
                    if (id.isBlank() || name.isBlank() || !price.isFinite() || price < 0)
                        error("Invalid catalog item")
                    rows.add(OutletCatalogItem(id, name, item.string("category"),
                        item.string("subcategory"), price, item.string("item_type")))
                }
                if (items.size() == 0 && rows.size < total) error("Incomplete catalog page")
                offset += items.size()
            } while (offset < (expectedTotal ?: 0))
            if (rows.size != expectedTotal || rows.map { it.itemId }.toSet().size != rows.size)
                error("Incomplete or duplicate catalog snapshot")
            // Only a complete validated download replaces the local catalog atomically.
            db.catalogDao().replaceSnapshot(rows, OutletCatalogMetadata(source = sourceName ?: "unknown",
                fetchedAt = System.currentTimeMillis(), itemCount = rows.size))
            Result.success(rows.size)
        } catch (e: Exception) {
            Result.failure(e) // Keep previous offline catalog untouched on failure.
        } finally {
            db.close()
        }
    }

    private fun JsonObject.string(key: String): String =
        get(key)?.takeUnless { it.isJsonNull }?.asString ?: ""
}
