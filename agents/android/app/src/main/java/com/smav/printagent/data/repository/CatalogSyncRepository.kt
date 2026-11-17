package com.smav.printagent.data.repository

import android.content.Context
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.reflect.TypeToken
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.OutletCatalogDatabase
import com.smav.printagent.data.local.entities.CachedMenuItemEntity
import com.smav.printagent.data.local.entities.CachedSalonServiceEntity
import com.smav.printagent.data.local.entities.CatalogSyncStateEntity
import com.smav.printagent.model.BusinessType
import com.smav.printagent.model.RestaurantMenuItem
import com.smav.printagent.model.RestaurantTable
import com.smav.printagent.model.RestaurantVariant
import com.smav.printagent.model.RetailProduct
import com.smav.printagent.model.SalonAppointment
import com.smav.printagent.model.SalonService
import com.smav.printagent.model.Stylist
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.network.asJsonObjectOrNull
import com.smav.printagent.network.optBool
import com.smav.printagent.network.optDouble
import com.smav.printagent.network.optInt
import com.smav.printagent.network.optLong
import com.smav.printagent.network.optString
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.io.IOException

data class PosInitBundle(
    val outletId: String,
    val businessType: BusinessType,
    val revision: Long,
    val fromCache: Boolean = false,
    val salonServices: List<SalonService> = emptyList(),
    val stylists: List<Stylist> = emptyList(),
    val appointments: List<SalonAppointment> = emptyList(),
    val stylistWarning: String? = null,
    val menuItems: List<RestaurantMenuItem> = emptyList(),
    val tables: List<RestaurantTable> = emptyList(),
    val retailProducts: List<RetailProduct> = emptyList()
)

class CatalogSyncRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val sessionManager: SessionManager
) {

    private val gson = Gson()
    private val outletCatalogRepo = OutletCatalogRepository(context, sessionManager)

    fun getActiveSalonServices(): Flow<List<CachedSalonServiceEntity>> =
        database.cachedCatalogDao().getActiveSalonServicesFlow()

    fun getActiveMenuItems(): Flow<List<CachedMenuItemEntity>> =
        database.cachedCatalogDao().getActiveMenuItemsFlow()

    fun getSyncState(businessId: String): Flow<CatalogSyncStateEntity?> =
        database.cachedCatalogDao().getSyncStateFlow(businessId)

    /**
     * Loads outlet-isolated POS data (strictly Salon OR Restaurant OR Retail).
     * Combines /api/pos/init with authoritative paginated /api/pos/outlets/:id/source-catalog
     * when online, and gracefully falls back to outlet-scoped Room cache when offline.
     */
    suspend fun loadPosData(outletId: String, expectedType: BusinessType): Result<PosInitBundle> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(UnauthorizedSessionException())

        try {
            val api = SmavApiClient.create(sessionManager)
            val bearer = SmavApiClient.bearer(session.token)
            val initResp = api.getPosInit(bearer)
            val body = SmavApiClient.unwrapOrThrow(initResp) { it }

            val remoteOutlet = body.get("outlet").asJsonObjectOrNull()
            val remoteOutletId = remoteOutlet?.optString("id").orEmpty()
            val remoteCatRaw = body.optString("category").ifBlank { remoteOutlet?.optString("category").orEmpty() }
            val resolvedType = if (remoteCatRaw.isNotBlank()) BusinessType.fromRawCategory(remoteCatRaw) else expectedType

            if (remoteOutletId.isNotBlank() && outletId.isNotBlank() && remoteOutletId != outletId) {
                throw IOException("Outlet session mismatch detected. Please re-open the selected outlet.")
            }

            val revision = body.optLong("revision", default = 0L)

            when (resolvedType) {
                BusinessType.SALON -> {
                    var services = parseSalonServices(body.getAsJsonArray("services"))
                    // Also fetch authoritative source catalog (e.g., 204 live Glossy Looks services)
                    val isUuid = runCatching { java.util.UUID.fromString(outletId) }.isSuccess
                    if (isUuid) {
                        val refreshRes = outletCatalogRepo.refresh(outletId, outletId)
                        if (refreshRes.isSuccess) {
                            val sourceItems = readOutletCatalogSnapshot(outletId)
                            if (sourceItems.isNotEmpty()) {
                                services = sourceItems.map { item ->
                                    SalonService(
                                        id = item.itemId,
                                        name = item.name,
                                        category = item.category.ifBlank { "General" },
                                        subcategory = item.subcategory,
                                        price = item.price,
                                        gstPercent = 18.0,
                                        isDiscountEligible = true,
                                        isActive = item.active
                                    )
                                }
                            }
                        }
                    }

                    // Cache active salon services in Room cleanly
                    if (services.isNotEmpty()) {
                        database.cachedCatalogDao().upsertSalonServices(
                            services.map { s ->
                                CachedSalonServiceEntity(
                                    id = s.id,
                                    businessId = "the_glossy_looks",
                                    name = s.name,
                                    category = s.category,
                                    subcategory = s.subcategory,
                                    price = s.price,
                                    gstPercent = s.gstPercent,
                                    isDiscountEligible = s.isDiscountEligible,
                                    isActive = s.isActive,
                                    isDeleted = false,
                                    revision = revision.coerceAtLeast(101L)
                                )
                            }
                        )
                    }

                    val stylists = parseStylists(body.getAsJsonArray("stylists"))
                    val appointments = parseAppointments(body.getAsJsonArray("appointments"))
                    val stylistWarning = body.optString("stylistError").takeIf { it.isNotBlank() }

                    Result.success(
                        PosInitBundle(
                            outletId = outletId,
                            businessType = BusinessType.SALON,
                            revision = revision,
                            fromCache = false,
                            salonServices = services,
                            stylists = stylists,
                            appointments = appointments,
                            stylistWarning = stylistWarning
                        )
                    )
                }

                BusinessType.RESTAURANT -> {
                    val menu = parseMenuItems(body.getAsJsonArray("menu"))
                    val tables = parseTables(body.getAsJsonArray("tables"))

                    if (menu.isNotEmpty()) {
                        database.cachedCatalogDao().upsertMenuItems(
                            menu.map { m ->
                                CachedMenuItemEntity(
                                    id = m.id,
                                    businessId = "mozz_starters4u",
                                    name = m.name,
                                    category = m.category,
                                    basePrice = m.basePrice,
                                    isVeg = m.isVeg,
                                    variantsJson = gson.toJson(m.variants),
                                    isAvailable = m.isAvailable,
                                    isDeleted = false,
                                    revision = revision.coerceAtLeast(201L)
                                )
                            }
                        )
                    }

                    Result.success(
                        PosInitBundle(
                            outletId = outletId,
                            businessType = BusinessType.RESTAURANT,
                            revision = revision,
                            fromCache = false,
                            menuItems = menu,
                            tables = tables
                        )
                    )
                }

                BusinessType.RETAIL -> {
                    val products = parseRetailProducts(body.getAsJsonArray("products"))
                    Result.success(
                        PosInitBundle(
                            outletId = outletId,
                            businessType = BusinessType.RETAIL,
                            revision = revision,
                            fromCache = false,
                            retailProducts = products
                        )
                    )
                }

                BusinessType.OTHER -> {
                    Result.failure(IOException("Select a Salon, Restaurant, or Retail outlet to launch POS."))
                }
            }
        } catch (u: UnauthorizedSessionException) {
            Result.failure(u)
        } catch (e: Exception) {
            // Fall back to strictly isolated Room offline cache
            val cached = loadOfflineBundle(outletId, expectedType)
            if (cached != null) {
                Result.success(cached)
            } else {
                Result.failure(IOException(SmavApiClient.friendlyThrowable(e, "Unable to load outlet catalog.")))
            }
        }
    }

    private suspend fun readOutletCatalogSnapshot(outletId: String): List<com.smav.printagent.data.local.OutletCatalogItem> {
        return try {
            val db = OutletCatalogDatabase.open(context, outletId)
            try {
                db.catalogDao().observeItems().first()
            } finally {
                db.close()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun loadOfflineBundle(outletId: String, businessType: BusinessType): PosInitBundle? = withContext(Dispatchers.IO) {
        when (businessType) {
            BusinessType.SALON -> {
                val snapshot = readOutletCatalogSnapshot(outletId)
                val services = if (snapshot.isNotEmpty()) {
                    snapshot.map {
                        SalonService(
                            id = it.itemId,
                            name = it.name,
                            category = it.category.ifBlank { "General" },
                            subcategory = it.subcategory,
                            price = it.price,
                            gstPercent = 18.0,
                            isDiscountEligible = true,
                            isActive = it.active
                        )
                    }
                } else {
                    database.cachedCatalogDao().getActiveSalonServicesFlow().first().map {
                        SalonService(
                            id = it.id,
                            name = it.name,
                            category = it.category,
                            subcategory = it.subcategory,
                            price = it.price,
                            gstPercent = it.gstPercent,
                            isDiscountEligible = it.isDiscountEligible,
                            isActive = it.isActive
                        )
                    }
                }
                if (services.isEmpty()) null else PosInitBundle(
                    outletId = outletId,
                    businessType = BusinessType.SALON,
                    revision = database.cachedCatalogDao().getSyncState("the_glossy_looks")?.currentRevision ?: 0L,
                    fromCache = true,
                    salonServices = services
                )
            }

            BusinessType.RESTAURANT -> {
                val variantType = object : TypeToken<List<RestaurantVariant>>() {}.type
                val menu = database.cachedCatalogDao().getActiveMenuItemsFlow().first().map { entity ->
                    val variants: List<RestaurantVariant> = runCatching {
                        gson.fromJson<List<RestaurantVariant>>(entity.variantsJson, variantType)
                    }.getOrNull() ?: emptyList()
                    RestaurantMenuItem(
                        id = entity.id,
                        name = entity.name,
                        category = entity.category,
                        basePrice = entity.basePrice,
                        isVeg = entity.isVeg,
                        variants = variants,
                        isAvailable = entity.isAvailable
                    )
                }
                if (menu.isEmpty()) null else PosInitBundle(
                    outletId = outletId,
                    businessType = BusinessType.RESTAURANT,
                    revision = database.cachedCatalogDao().getSyncState("mozz_starters4u")?.currentRevision ?: 0L,
                    fromCache = true,
                    menuItems = menu,
                    tables = (1..8).map { RestaurantTable("Table $it") }
                )
            }

            else -> null
        }
    }

    /**
     * Executes version-based delta sync or full reconciliation against backend.
     */
    suspend fun syncCatalog(businessId: String): Result<CatalogSyncStateEntity> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(UnauthorizedSessionException())

        val bearer = SmavApiClient.bearer(session.token)
        val api = SmavApiClient.create(sessionManager)
        val localState = database.cachedCatalogDao().getSyncState(businessId)
        val sinceRevision = localState?.currentRevision ?: 0L

        try {
            val response = api.getCatalogDeltaSync(
                token = bearer,
                businessId = businessId,
                sinceRevision = sinceRevision,
                branchId = session.branchId
            )

            if (response.code() == 401) {
                throw UnauthorizedSessionException(SmavApiClient.parseErrorMessage(response))
            }

            if (!response.isSuccessful || response.body() == null) {
                val errorMsg = SmavApiClient.parseErrorMessage(response, "Catalog sync failed")
                val errorState = CatalogSyncStateEntity(
                    businessId = businessId,
                    currentRevision = sinceRevision,
                    lastSyncTimestamp = System.currentTimeMillis(),
                    status = "ERROR",
                    lastError = errorMsg
                )
                database.cachedCatalogDao().saveSyncState(errorState)
                return@withContext Result.failure(IOException(errorMsg))
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

                if (toUpsert.isNotEmpty()) database.cachedCatalogDao().upsertSalonServices(toUpsert)
                if (tombstones.isNotEmpty()) database.cachedCatalogDao().applySalonServiceTombstones(tombstones)
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

                if (toUpsert.isNotEmpty()) database.cachedCatalogDao().upsertMenuItems(toUpsert)
                if (tombstones.isNotEmpty()) database.cachedCatalogDao().applyMenuItemTombstones(tombstones)
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
        } catch (e: UnauthorizedSessionException) {
            Result.failure(e)
        } catch (e: Exception) {
            val friendly = SmavApiClient.friendlyThrowable(e, "Catalog sync failed")
            val errorState = CatalogSyncStateEntity(
                businessId = businessId,
                currentRevision = sinceRevision,
                lastSyncTimestamp = System.currentTimeMillis(),
                status = "ERROR",
                lastError = friendly
            )
            database.cachedCatalogDao().saveSyncState(errorState)
            Result.failure(IOException(friendly))
        }
    }

    private fun parseSalonServices(array: JsonArray?): List<SalonService> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val id = obj.optString("id", "external_item_id")
            val name = obj.optString("name")
            if (id.isBlank() || name.isBlank()) return@mapNotNull null
            SalonService(
                id = id,
                name = name,
                category = obj.optString("category").ifBlank { "General" },
                subcategory = obj.optString("subcategory"),
                price = obj.optDouble("price", default = 0.0),
                gstPercent = obj.optDouble("gstPercent", "gst_percent", default = 18.0),
                isDiscountEligible = obj.optBool("isDiscountEligible", true),
                isActive = obj.optBool("isActive", true)
            )
        }
    }

    private fun parseStylists(array: JsonArray?): List<Stylist> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val id = obj.optString("id", "userId")
            val name = obj.optString("name", "fullName")
            if (id.isBlank() || name.isBlank()) return@mapNotNull null
            Stylist(
                id = id,
                name = name,
                specialty = obj.optString("specialty"),
                branchId = obj.optString("branchId"),
                isAvailable = obj.optBool("isAvailable", true)
            )
        }
    }

    private fun parseAppointments(array: JsonArray?): List<SalonAppointment> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val id = obj.optString("id")
            if (id.isBlank()) return@mapNotNull null
            SalonAppointment(
                id = id,
                customerName = obj.optString("customerName", "customer_name"),
                customerPhone = obj.optString("customerPhone", "customer_phone"),
                serviceId = obj.optString("serviceId", "service_id"),
                serviceName = obj.optString("serviceName", "service_name"),
                stylistId = obj.optString("stylistId", "stylist_id").takeIf { it.isNotBlank() },
                stylistName = obj.optString("stylistName", "stylist_name").takeIf { it.isNotBlank() },
                appointmentTime = obj.optString("appointmentTime", "appointment_time"),
                status = obj.optString("status").ifBlank { "scheduled" }
            )
        }
    }

    private fun parseMenuItems(array: JsonArray?): List<RestaurantMenuItem> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val id = obj.optString("id")
            val name = obj.optString("name")
            if (id.isBlank() || name.isBlank()) return@mapNotNull null
            val variants = obj.getAsJsonArray("variants")?.mapNotNull { vEl ->
                val vObj = vEl.asJsonObjectOrNull() ?: return@mapNotNull null
                RestaurantVariant(
                    id = vObj.optString("id").ifBlank { vObj.optString("name") },
                    name = vObj.optString("name"),
                    priceDelta = vObj.optDouble("priceDelta", "price_delta", default = 0.0)
                )
            } ?: emptyList()
            RestaurantMenuItem(
                id = id,
                name = name,
                category = obj.optString("category").ifBlank { "Menu" },
                basePrice = obj.optDouble("basePrice", "price", default = 0.0),
                isVeg = obj.optBool("isVeg", false),
                variants = variants,
                isAvailable = obj.optBool("isAvailable", true)
            )
        }
    }

    private fun parseTables(array: JsonArray?): List<RestaurantTable> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val num = obj.optString("tableNumber", "table_number", "name")
            if (num.isBlank()) return@mapNotNull null
            RestaurantTable(
                tableNumber = num,
                capacity = obj.optInt("capacity", default = 4),
                status = obj.optString("status").ifBlank { "available" },
                currentOrderId = obj.optString("currentOrderId").takeIf { it.isNotBlank() }
            )
        }
    }

    private fun parseRetailProducts(array: JsonArray?): List<RetailProduct> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val id = obj.optString("id")
            val name = obj.optString("name")
            if (id.isBlank() || name.isBlank()) return@mapNotNull null
            RetailProduct(
                id = id,
                name = name,
                category = obj.optString("category").ifBlank { "General" },
                subcategory = obj.optString("subcategory"),
                sku = obj.optString("sku"),
                price = obj.optDouble("price", default = 0.0),
                gstPercent = obj.optDouble("gstPercent", "gst_percent", default = 12.0),
                stockQuantity = obj.optInt("stockQuantity", "stock", default = 0),
                isActive = obj.optBool("isActive", true)
            )
        }
    }
}
