package com.smav.printagent.network

import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.model.AvailableBusinessOption
import com.smav.printagent.model.RestaurantMenuItem
import com.smav.printagent.model.RestaurantTable
import com.smav.printagent.model.SalonAppointment
import com.smav.printagent.model.SalonService
import com.smav.printagent.model.StaffSession
import com.smav.printagent.model.Stylist
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

data class StaffLoginRequest(
    @SerializedName("email") val email: String,
    @SerializedName("password") val password: String,
    @SerializedName("device_id") val deviceId: String
)

data class StaffLoginResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("multi_business") val multiBusiness: Boolean = false,
    @SerializedName("token") val token: String?,
    @SerializedName("temp_token") val tempToken: String?,
    @SerializedName("session") val session: StaffSession?,
    @SerializedName("available_businesses") val availableBusinesses: List<AvailableBusinessOption>?,
    @SerializedName("catalog_revision") val catalogRevision: Long?,
    @SerializedName("message") val message: String?
)

data class SelectBusinessRequest(
    @SerializedName("user_id") val userId: String,
    @SerializedName("business_id") val businessId: String,
    @SerializedName("branch_id") val branchId: String? = null,
    @SerializedName("device_id") val deviceId: String
)

data class AccountMigrationRequest(
    @SerializedName("email") val email: String,
    @SerializedName("legacy_password") val legacyPassword: String,
    @SerializedName("new_password") val newPassword: String,
    @SerializedName("device_id") val deviceId: String = "SMAV-ANDROID-MIGRATE"
)

data class AccountMigrationResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("token") val token: String?,
    @SerializedName("session") val session: StaffSession?
)

data class PasswordResetRequest(
    @SerializedName("email") val email: String
)

data class PasswordResetResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("resetToken") val resetToken: String?,
    @SerializedName("message") val message: String?
)

data class ConfirmResetPasswordRequest(
    @SerializedName("token") val token: String,
    @SerializedName("new_password") val newPassword: String
)

data class UserProfileResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("user") val user: Map<String, Any>?,
    @SerializedName("current_session") val currentSession: StaffSession?,
    @SerializedName("memberships") val memberships: List<Map<String, Any>>?
)

data class CatalogSyncResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("business_id") val businessId: String,
    @SerializedName("current_revision") val currentRevision: Long,
    @SerializedName("since_revision") val sinceRevision: Long,
    @SerializedName("is_delta") val isDelta: Boolean,
    @SerializedName("up_to_date") val upToDate: Boolean = false,
    @SerializedName("reconcile_full") val reconcileFull: Boolean = false,
    @SerializedName("changes") val changes: List<Map<String, Any>>,
    @SerializedName("total_active_items") val totalActiveItems: Int,
    @SerializedName("last_updated") val lastUpdated: String?,
    @SerializedName("server_timestamp") val serverTimestamp: Long
)

data class SalonServicesResponse(
    @SerializedName("business_id") val businessId: String,
    @SerializedName("current_revision") val currentRevision: Long,
    @SerializedName("services") val services: List<SalonService>
)

data class SalonStylistsResponse(
    @SerializedName("business_id") val businessId: String,
    @SerializedName("stylists") val stylists: List<Stylist>
)

data class SalonAppointmentsResponse(
    @SerializedName("business_id") val businessId: String,
    @SerializedName("appointments") val appointments: List<SalonAppointment>
)

data class RestaurantMenuResponse(
    @SerializedName("business_id") val businessId: String,
    @SerializedName("current_revision") val currentRevision: Long,
    @SerializedName("menu") val menu: List<RestaurantMenuItem>
)

data class RestaurantTablesResponse(
    @SerializedName("business_id") val businessId: String,
    @SerializedName("tables") val tables: List<RestaurantTable>
)

data class PendingOrdersResponse(
    @SerializedName("business_id") val businessId: String,
    @SerializedName("pending_orders") val pendingOrders: List<Any>
)

data class DevicePairRequest(
    @SerializedName("pairing_code") val pairingCode: String,
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("device_name") val deviceName: String,
    @SerializedName("model_info") val modelInfo: String,
    @SerializedName("app_version") val appVersion: String = "1.0.0"
)

data class DevicePairResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("token") val token: String,
    @SerializedName("business_id") val businessId: String,
    @SerializedName("branch_id") val branchId: String,
    @SerializedName("branch_code") val branchCode: String,
    @SerializedName("role") val role: String,
    @SerializedName("message") val message: String?
)

data class SyncBillsRequest(
    @SerializedName("bills") val bills: List<SyncBillPayload>
)

data class SyncBillPayload(
    @SerializedName("bill") val bill: SalonBillEntity,
    @SerializedName("items") val items: List<SalonBillItemEntity>,
    @SerializedName("idempotency_key") val idempotencyKey: String
)

data class SyncOrdersRequest(
    @SerializedName("orders") val orders: List<SyncOrderPayload>
)

data class SyncOrderPayload(
    @SerializedName("order") val order: RestaurantOrderEntity,
    @SerializedName("items") val items: List<RestaurantOrderItemEntity>,
    @SerializedName("idempotency_key") val idempotencyKey: String
)

data class SyncPrintStatusRequest(
    @SerializedName("jobs") val jobs: List<PrintJobEntity>
)

data class SyncResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("synced_ids") val syncedIds: List<String>,
    @SerializedName("failed_ids") val failedIds: Map<String, String>?,
    @SerializedName("server_timestamp") val serverTimestamp: Long,
    @SerializedName("synced_bills") val syncedBills: List<JsonObject>? = null
)

interface ApiService {
    // Authoritative catalog paginated per central outlet UUID
    @GET("api/pos/outlets/{outletId}/source-catalog")
    suspend fun getOutletSourceCatalog(
        @Header("Authorization") token: String,
        @Path("outletId") outletId: String,
        @Query("limit") limit: Int = 200,
        @Query("offset") offset: Int = 0
    ): Response<JsonObject>

    @GET("api/pos/outlets/{outletId}/catalog-preview")
    suspend fun getOutletCatalogPreview(
        @Header("Authorization") token: String,
        @Path("outletId") outletId: String,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0
    ): Response<JsonObject>

    @GET("api/pos/outlets/{outletId}/catalog-changes")
    suspend fun getOutletCatalogChanges(
        @Header("Authorization") token: String,
        @Path("outletId") outletId: String,
        @Query("sinceRevision") sinceRevision: Long = 0,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0
    ): Response<JsonObject>

    @GET("api/superadmin/outlets/{outletId}/catalog-import-preview")
    suspend fun getCatalogImportPreflight(
        @Header("Authorization") token: String,
        @Path("outletId") outletId: String
    ): Response<JsonObject>

    // 1. Central Authentication & Session Endpoints
    @POST("api/auth/login")
    suspend fun loginRaw(@Body request: JsonObject): Response<JsonObject>

    @POST("api/auth/select-outlet")
    suspend fun selectOutletRaw(@Body request: JsonObject): Response<JsonObject>

    @GET("api/auth/session")
    suspend fun getAuthSession(@Header("Authorization") token: String): Response<JsonObject>

    @GET("api/auth/profile")
    suspend fun getAuthProfile(@Header("Authorization") token: String): Response<JsonObject>

    @GET("api/auth/outlets")
    suspend fun getAuthorizedOutlets(@Header("Authorization") token: String): Response<JsonObject>

    @POST("api/auth/switch-outlet")
    suspend fun switchOutlet(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/auth/logout")
    suspend fun logout(@Header("Authorization") token: String): Response<JsonObject>

    // Legacy / Mobile compatibility
    @POST("api/mobile-auth/login")
    suspend fun loginStaff(@Body request: StaffLoginRequest): Response<StaffLoginResponse>

    @POST("api/mobile-auth/select-business")
    suspend fun selectBusiness(@Body request: SelectBusinessRequest): Response<StaffLoginResponse>

    // 2. Superadmin Management Endpoints
    @GET("api/superadmin/outlets")
    suspend fun getSuperadminOutlets(@Header("Authorization") token: String): Response<JsonObject>

    @POST("api/superadmin/outlets")
    suspend fun createSuperadminOutlet(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @PUT("api/superadmin/outlets/{id}")
    suspend fun updateSuperadminOutlet(
        @Header("Authorization") token: String,
        @Path("id") outletId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/superadmin/outlets/{id}/status")
    suspend fun setSuperadminOutletStatus(
        @Header("Authorization") token: String,
        @Path("id") outletId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @GET("api/superadmin/admins")
    suspend fun getSuperadminAdmins(@Header("Authorization") token: String): Response<JsonObject>

    @POST("api/superadmin/admins")
    suspend fun createSuperadminAdmin(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/superadmin/admins/{id}/reset-password")
    suspend fun resetSuperadminAdminPassword(
        @Header("Authorization") token: String,
        @Path("id") adminId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @GET("api/superadmin/reports")
    suspend fun getSuperadminReports(@Header("Authorization") token: String): Response<JsonObject>

    @GET("api/superadmin/audit-logs")
    suspend fun getSuperadminAuditLogs(@Header("Authorization") token: String): Response<JsonObject>

    @POST("api/superadmin/launch-pos")
    suspend fun launchSuperadminPos(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @GET("api/central-supabase/status")
    suspend fun getCentralSupabaseStatus(): Response<JsonObject>

    // 3. Outlet Admin & Unified Outlet Users Endpoints
    @GET("api/admin/outlet-details")
    suspend fun getAdminOutletDetails(@Header("Authorization") token: String): Response<JsonObject>

    @GET("api/outlet-users")
    suspend fun getOutletUsers(
        @Header("Authorization") token: String,
        @Query("outletCode") outletCode: String? = null
    ): Response<JsonObject>

    @POST("api/outlet-users")
    suspend fun createOutletUser(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @PUT("api/outlet-users/{userId}")
    suspend fun updateOutletUser(
        @Header("Authorization") token: String,
        @Path("userId") userId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/outlet-users/{userId}/reset-password")
    suspend fun resetOutletUserPassword(
        @Header("Authorization") token: String,
        @Path("userId") userId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/outlet-users/{userId}/status")
    suspend fun setOutletUserStatus(
        @Header("Authorization") token: String,
        @Path("userId") userId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @GET("api/sync/outbox")
    suspend fun getSyncOutbox(
        @Header("Authorization") token: String,
        @Query("outletCode") outletCode: String? = null
    ): Response<JsonObject>

    @POST("api/sync/outbox/{id}/retry")
    suspend fun retrySyncOutboxItem(
        @Header("Authorization") token: String,
        @Path("id") outboxId: String
    ): Response<JsonObject>

    @GET("api/admin/reports")
    suspend fun getAdminReports(@Header("Authorization") token: String): Response<JsonObject>

    @GET("api/admin/sync-status")
    suspend fun getAdminSyncStatus(@Header("Authorization") token: String): Response<JsonObject>

    @POST("api/admin/catalog/service")
    suspend fun saveSalonService(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/admin/catalog/menu-item")
    suspend fun saveRestaurantMenuItem(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/admin/catalog/retail-product")
    suspend fun saveRetailProduct(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    // Central Billing & WhatsApp Integration Diagnostics
    @POST("api/admin/integration-diagnostics/run")
    suspend fun runIntegrationDiagnostics(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/admin/integration-diagnostics/dispatch-now")
    suspend fun dispatchIntegrationNotificationsNow(
        @Header("Authorization") token: String
    ): Response<JsonObject>

    @POST("api/admin/integration-diagnostics/test-e2e")
    suspend fun runConfirmedIntegrationE2ETest(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    // 4. POS Init & Monotonic Delta Catalog Synchronization
    @GET("api/pos/init")
    suspend fun getPosInit(@Header("Authorization") token: String): Response<JsonObject>

    @GET("api/catalog/sync")
    suspend fun getCatalogDeltaSync(
        @Header("Authorization") token: String,
        @Query("business_id") businessId: String,
        @Query("since_revision") sinceRevision: Long,
        @Query("branch_id") branchId: String? = null
    ): Response<CatalogSyncResponse>

    // Salon POS APIs
    @GET("api/salon/services")
    suspend fun getSalonServices(@Header("Authorization") token: String): Response<SalonServicesResponse>

    @GET("api/salon/stylists")
    suspend fun getSalonStylists(@Header("Authorization") token: String): Response<SalonStylistsResponse>

    @GET("api/salon/stylists")
    suspend fun getSalonStylistsRaw(
        @Header("Authorization") token: String,
        @Query("outletId") outletId: String? = null
    ): Response<JsonObject>

    @GET("api/salon/appointments")
    suspend fun getSalonAppointments(@Header("Authorization") token: String): Response<SalonAppointmentsResponse>

    // Restaurant POS APIs
    @GET("api/restaurant/menu")
    suspend fun getRestaurantMenu(@Header("Authorization") token: String): Response<RestaurantMenuResponse>

    @GET("api/restaurant/tables")
    suspend fun getRestaurantTables(@Header("Authorization") token: String): Response<RestaurantTablesResponse>

    @GET("api/restaurant/orders/pending")
    suspend fun getPendingRestaurantOrders(@Header("Authorization") token: String): Response<PendingOrdersResponse>

    // 5. Offline Transaction Sync
    @POST("api/mobile/sync/bills")
    suspend fun syncBills(
        @Header("Authorization") token: String,
        @Body request: SyncBillsRequest
    ): Response<SyncResponse>

    @POST("api/mobile/sync/bills")
    suspend fun syncBillsJson(
        @Header("Authorization") token: String,
        @Body request: JsonObject
    ): Response<SyncResponse>

    @POST("api/mobile/sync/orders")
    suspend fun syncOrders(
        @Header("Authorization") token: String,
        @Body request: SyncOrdersRequest
    ): Response<SyncResponse>

    @POST("api/mobile/sync/orders")
    suspend fun syncOrdersJson(
        @Header("Authorization") token: String,
        @Body request: JsonObject
    ): Response<SyncResponse>

    @POST("api/mobile/sync/print-status")
    suspend fun syncPrintStatus(
        @Header("Authorization") token: String,
        @Body request: SyncPrintStatusRequest
    ): Response<SyncResponse>

    // 6. Unified Multi-Platform Transaction Ledger, Audited Edit, Soft-Delete (Void) & Restore
    @GET("api/pos/ledger/today")
    suspend fun getTodayLedger(
        @Header("Authorization") token: String,
        @Query("timezone") timezone: String = "Asia/Kolkata"
    ): Response<JsonObject>

    @GET("api/pos/ledger")
    suspend fun getUnifiedLedger(
        @Header("Authorization") token: String,
        @Query("scope") scope: String = "today",
        @Query("timezone") timezone: String = "Asia/Kolkata",
        @Query("fromDate") fromDate: String? = null,
        @Query("toDate") toDate: String? = null,
        @Query("branchId") branchId: String? = null,
        @Query("search") search: String? = null,
        @Query("includeTombstones") includeTombstones: Boolean = true
    ): Response<JsonObject>

    @PATCH("api/pos/bills/{billId}")
    suspend fun editBill(
        @Header("Authorization") token: String,
        @Path("billId") billId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/pos/bills/{billId}/void")
    suspend fun voidBill(
        @Header("Authorization") token: String,
        @Path("billId") billId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/pos/bills/{billId}/restore")
    suspend fun restoreBill(
        @Header("Authorization") token: String,
        @Path("billId") billId: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    // 7. Central Bill Numbering, Mandatory Branch Selection & Offline Range Preallocation
    @GET("api/pos/branches")
    suspend fun getPermittedBranches(
        @Header("Authorization") token: String
    ): Response<JsonObject>

    @POST("api/central/bill-numbers/reserve")
    suspend fun reserveCentralBillNumber(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/central/bill-numbers/finalize")
    suspend fun finalizeCentralBillNumber(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>

    @POST("api/central/bill-numbers/allocate-range")
    suspend fun allocateBillNumberRange(
        @Header("Authorization") token: String,
        @Body body: JsonObject
    ): Response<JsonObject>
}
