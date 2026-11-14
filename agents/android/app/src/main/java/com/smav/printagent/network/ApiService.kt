package com.smav.printagent.network

import com.google.gson.annotations.SerializedName
import com.smav.printagent.data.local.entities.PrintJobEntity
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.model.AvailableBusinessOption
import com.smav.printagent.model.Branch
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
import retrofit2.http.POST
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
    @SerializedName("branch_id") val branchId: String,
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
    @SerializedName("server_timestamp") val serverTimestamp: Long
)

interface ApiService {
    // 1. Staff & Multi-Outlet Enterprise Authentication (SUPERADMIN, ADMIN, STAFF)
    @POST("api/auth/login")
    suspend fun loginEnterpriseAuth(@Body request: StaffLoginRequest): Response<StaffLoginResponse>

    @POST("api/mobile-auth/login")
    suspend fun loginStaff(@Body request: StaffLoginRequest): Response<StaffLoginResponse>

    @POST("api/auth/select-outlet")
    suspend fun selectOutlet(@Body request: SelectBusinessRequest): Response<StaffLoginResponse>

    @POST("api/mobile-auth/select-business")
    suspend fun selectBusiness(@Body request: SelectBusinessRequest): Response<StaffLoginResponse>

    @POST("api/auth/migrate-account")
    suspend fun migrateAccount(@Body request: AccountMigrationRequest): Response<AccountMigrationResponse>

    @POST("api/auth/request-password-reset")
    suspend fun requestPasswordReset(@Body request: PasswordResetRequest): Response<PasswordResetResponse>

    @POST("api/auth/reset-password")
    suspend fun resetPassword(@Body request: ConfirmResetPasswordRequest): Response<PasswordResetResponse>

    @GET("api/auth/me")
    suspend fun getCurrentProfile(@Header("Authorization") token: String): Response<UserProfileResponse>

    // 2. Monotonic Delta Catalog Synchronization
    @GET("api/catalog/sync")
    suspend fun getCatalogDeltaSync(
        @Header("Authorization") token: String,
        @Query("business_id") businessId: String,
        @Query("since_revision") sinceRevision: Long,
        @Query("branch_id") branchId: String? = null
    ): Response<CatalogSyncResponse>

    // 3. Salon POS APIs
    @GET("api/salon/services")
    suspend fun getSalonServices(@Header("Authorization") token: String): Response<SalonServicesResponse>

    @GET("api/salon/stylists")
    suspend fun getSalonStylists(@Header("Authorization") token: String): Response<SalonStylistsResponse>

    @GET("api/salon/appointments")
    suspend fun getSalonAppointments(@Header("Authorization") token: String): Response<SalonAppointmentsResponse>

    // 4. Restaurant POS APIs
    @GET("api/restaurant/menu")
    suspend fun getRestaurantMenu(@Header("Authorization") token: String): Response<RestaurantMenuResponse>

    @GET("api/restaurant/tables")
    suspend fun getRestaurantTables(@Header("Authorization") token: String): Response<RestaurantTablesResponse>

    @GET("api/restaurant/orders/pending")
    suspend fun getPendingRestaurantOrders(@Header("Authorization") token: String): Response<PendingOrdersResponse>

    // 5. Device Pairing & Transaction Sync
    @POST("api/devices/pair")
    suspend fun pairDevice(@Body request: DevicePairRequest): Response<DevicePairResponse>

    @POST("api/mobile/sync/bills")
    suspend fun syncBills(
        @Header("Authorization") token: String,
        @Body request: SyncBillsRequest
    ): Response<SyncResponse>

    @POST("api/mobile/sync/orders")
    suspend fun syncOrders(
        @Header("Authorization") token: String,
        @Body request: SyncOrdersRequest
    ): Response<SyncResponse>

    @POST("api/mobile/sync/print-status")
    suspend fun syncPrintStatus(
        @Header("Authorization") token: String,
        @Body request: SyncPrintStatusRequest
    ): Response<SyncResponse>
}
