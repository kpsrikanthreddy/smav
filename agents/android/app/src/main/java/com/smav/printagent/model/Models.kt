package com.smav.printagent.model

import com.google.gson.annotations.SerializedName
import java.util.Locale

enum class BusinessType(val id: String, val displayName: String) {
    SALON("salon", "Salon & Spa"),
    RESTAURANT("restaurant", "Restaurant & Cloud Kitchen"),
    RETAIL("retail", "Shopping & Retail Store"),
    OTHER("other", "Enterprise Operations");

    companion object {
        private val salonCategories = setOf(
            "salon",
            "beauty_salon",
            "salon_and_spa",
            "spa",
            "beauty",
            "women_salon"
        )
        private val restaurantCategories = setOf(
            "restaurant",
            "cloud_kitchen",
            "pizzeria",
            "cafe",
            "food"
        )
        private val retailCategories = setOf(
            "retail",
            "store",
            "hardware",
            "seeds"
        )

        fun normalizeCategory(raw: String?): String =
            (raw ?: "")
                .trim()
                .lowercase(Locale.ENGLISH)
                .replace('-', '_')
                .replace(Regex("\\s+"), "_")

        fun fromRawCategory(raw: String?): BusinessType {
            val normalized = normalizeCategory(raw)
            return when {
                normalized in salonCategories -> SALON
                normalized in restaurantCategories -> RESTAURANT
                normalized in retailCategories -> RETAIL
                else -> OTHER
            }
        }
    }
}

enum class UserRole(val code: String, val label: String, val visibleRole: String) {
    SUPERADMIN("superadmin", "Superadministrator", "SUPERADMIN"),
    ADMIN("admin", "Outlet Administrator", "ADMIN"),
    STAFF("staff", "POS Billing Staff", "POS_BILLING"),
    OWNER("owner", "Outlet Administrator", "ADMIN"),
    MANAGER("manager", "Branch Manager", "POS_BILLING"),
    CASHIER("cashier", "POS Billing Cashier", "POS_BILLING"),
    SALON_RECEPTIONIST("salon_receptionist", "Salon Receptionist", "POS_BILLING");

    fun isSuperadmin(): Boolean = this == SUPERADMIN
    fun isAdminOrAbove(): Boolean = this == SUPERADMIN || this == ADMIN || this == OWNER
    fun isAdminOnly(): Boolean = this == ADMIN || this == OWNER

    companion object {
        fun fromBackend(role: String?, displayRole: String? = null): UserRole {
            val normDisplay = (displayRole ?: "").trim().uppercase(Locale.ENGLISH)
            val normRole = (role ?: "").trim().lowercase(Locale.ENGLISH)
            return when {
                normDisplay == "SUPERADMIN" || normRole == "superadmin" -> SUPERADMIN
                normDisplay == "ADMIN" || normRole == "admin" || normRole == "owner" -> ADMIN
                normRole == "manager" -> MANAGER
                normRole == "cashier" -> CASHIER
                normRole == "salon_receptionist" -> SALON_RECEPTIONIST
                else -> STAFF
            }
        }
    }
}

enum class PrinterPurpose(val code: String, val label: String) {
    SALON_RECEIPT("salon_receipt", "Salon Receipt Printer"),
    RESTAURANT_BILL("mozz_bill", "Restaurant Customer Bill Printer"),
    RESTAURANT_KOT("mozz_kot", "Kitchen KOT Printer (No Prices)"),
    RETAIL_RECEIPT("retail_receipt", "Retail Receipt Printer")
}

enum class PaperWidth(val widthMm: Int, val columns: Int) {
    WIDTH_58MM(58, 32),
    WIDTH_80MM(80, 48)
}

enum class PrinterConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    PRINTING,
    FAILED
}

enum class OrderType(val code: String, val label: String) {
    DINE_IN("dine_in", "Dine-In"),
    COUNTER("counter", "Counter Order"),
    TAKEAWAY("takeaway", "Takeaway / Parcel"),
    DELIVERY("delivery", "Direct Delivery")
}

data class BluetoothDeviceItem(
    val name: String,
    val address: String,
    val isPaired: Boolean = true,
    val isConnected: Boolean = false,
    val assignedPurpose: PrinterPurpose? = null,
    val paperWidth: PaperWidth = PaperWidth.WIDTH_80MM
)

data class Outlet(
    val id: String,
    val code: String,
    val name: String,
    val category: String,
    val address: String,
    val phone: String,
    val gstin: String,
    val receiptHeader: String,
    val receiptFooter: String,
    val isActive: Boolean = true
) {
    val businessType: BusinessType get() = BusinessType.fromRawCategory(category)
}

data class BranchOption(
    val id: String,
    val name: String = "",
    val branchCode: String,
    val branchName: String = "",
    val billPrefix: String = "TGL",
    val isActive: Boolean = true
) {
    val displayName: String
        get() = name.ifBlank { branchName }.ifBlank { branchCode }
}

data class SalonService(
    val id: String,
    val name: String,
    val category: String,
    val subcategory: String = "",
    val price: Double,
    val gstPercent: Double = 18.0,
    val isDiscountEligible: Boolean = true,
    val isActive: Boolean = true
)

data class Stylist(
    val id: String,
    val name: String,
    val specialty: String = "",
    val branchId: String = "",
    val isAvailable: Boolean = true
)

data class SalonAppointment(
    val id: String,
    val customerName: String,
    val customerPhone: String,
    val serviceId: String,
    val serviceName: String,
    val stylistId: String?,
    val stylistName: String?,
    val appointmentTime: String,
    val status: String
)

data class SalonCartItem(
    val service: SalonService,
    val stylist: Stylist?,
    val quantity: Int = 1,
    val discountPercent: Double = 0.0,
    val customPrice: Double? = null
) {
    val unitPrice: Double get() = customPrice ?: service.price
    val subtotal: Double get() = unitPrice * quantity
    val discountAmount: Double get() = subtotal * (discountPercent / 100.0)
    val taxableAmount: Double get() = subtotal - discountAmount
    val gstAmount: Double get() = taxableAmount * (service.gstPercent / 100.0)
    val totalAmount: Double get() = taxableAmount + gstAmount
}

data class RestaurantMenuItem(
    val id: String,
    val name: String,
    val category: String,
    val basePrice: Double,
    val isVeg: Boolean = false,
    val variants: List<RestaurantVariant> = emptyList(),
    val isAvailable: Boolean = true
)

data class RestaurantVariant(
    val id: String,
    val name: String,
    val priceDelta: Double = 0.0
)

data class RestaurantTable(
    val tableNumber: String,
    val capacity: Int = 4,
    val status: String = "available",
    val currentOrderId: String? = null
)

data class RestaurantCartItem(
    val item: RestaurantMenuItem,
    val selectedVariant: RestaurantVariant? = null,
    val quantity: Int = 1,
    val specialNotes: String = ""
) {
    val unitPrice: Double get() = item.basePrice + (selectedVariant?.priceDelta ?: 0.0)
    val subtotal: Double get() = unitPrice * quantity
}

data class RetailProduct(
    val id: String,
    val name: String,
    val category: String,
    val subcategory: String = "",
    val sku: String = "",
    val price: Double,
    val gstPercent: Double = 12.0,
    val stockQuantity: Int = 0,
    val isActive: Boolean = true
)

data class RetailCartItem(
    val product: RetailProduct,
    val quantity: Int = 1,
    val discountPercent: Double = 0.0
) {
    val unitPrice: Double get() = product.price
    val subtotal: Double get() = unitPrice * quantity
    val discountAmount: Double get() = subtotal * (discountPercent / 100.0)
    val taxableAmount: Double get() = subtotal - discountAmount
    val gstAmount: Double get() = taxableAmount * (product.gstPercent / 100.0)
    val totalAmount: Double get() = taxableAmount + gstAmount
}

// Enterprise Unified Staff Session
data class StaffSession(
    val token: String,
    val userId: String,
    val userName: String,
    val email: String,
    val businessId: String,
    val businessType: BusinessType,
    val businessName: String,
    val branchId: String,
    val branchCode: String,
    val branchName: String,
    val role: UserRole,
    val permissions: List<String>,
    val deviceId: String,
    val isOnline: Boolean = true,
    val displayRole: String = role.visibleRole,
    val assignedOutlets: List<AvailableBusinessOption> = emptyList(),
    val lastValidatedAt: Long = System.currentTimeMillis()
) {
    val visibleRole: String get() = displayRole.ifBlank { role.visibleRole }
}

data class AvailableBusinessOption(
    @SerializedName("outletId", alternate = ["outlet_id", "business_id"]) val businessId: String = "",
    @SerializedName("outletName", alternate = ["outlet_name", "business_name"]) val businessName: String = "",
    @SerializedName("outletCategory", alternate = ["outlet_category", "business_type"]) val businessType: String = "other",
    @SerializedName("branch_id", alternate = ["branchId"]) val branchId: String = "",
    @SerializedName("outletCode", alternate = ["outlet_code", "branch_code"]) val branchCode: String = "",
    @SerializedName("branch_name", alternate = ["branchName"]) val branchName: String = "",
    @SerializedName("role") val role: String = "staff",
    @SerializedName("displayRole") val displayRole: String = ""
) {
    val normalizedBusinessType: BusinessType get() = BusinessType.fromRawCategory(businessType)
    val resolvedBranchId: String get() = branchId
    val resolvedBranchName: String get() = branchName.ifBlank { businessName }
}

// Superadmin / Admin Remote View Models

data class AdminOutletItem(
    val id: String,
    val code: String,
    val name: String,
    val category: String,
    val address: String,
    val phone: String,
    val gstin: String,
    val receiptHeader: String,
    val receiptFooter: String,
    val providerType: String,
    val supabaseUrl: String,
    val syncWebhookUrl: String,
    val isActive: Boolean
) {
    val businessType: BusinessType get() = BusinessType.fromRawCategory(category)
}

data class AdminMembershipItem(
    val outletId: String,
    val outletCode: String,
    val outletName: String,
    val role: String
)

data class OutletAdminItem(
    val userId: String,
    val fullName: String,
    val email: String,
    val username: String,
    val phone: String,
    val role: String,
    val displayRole: String,
    val isActive: Boolean,
    val mustChangePassword: Boolean,
    val syncStatus: String = "synced",
    val outboxLastError: String? = null,
    val memberships: List<AdminMembershipItem> = emptyList()
)

data class NetworkReportData(
    val totalOutlets: Int = 0,
    val activeOutlets: Int = 0,
    val totalRevenue: Double = 0.0,
    val totalTransactions: Int = 0,
    val pairedDevicesCount: Int = 0,
    val breakdown: List<OutletBreakdownItem> = emptyList()
)

data class OutletBreakdownItem(
    val id: String,
    val name: String,
    val code: String,
    val category: String,
    val isActive: Boolean,
    val revenue: Double,
    val transactionCount: Int,
    val supabaseConnected: Boolean
) {
    val businessType: BusinessType get() = BusinessType.fromRawCategory(category)
}

data class AuditLogItem(
    val id: String,
    val timestamp: String,
    val eventType: String,
    val actorEmail: String,
    val ipAddress: String,
    val detailsJson: String
)

data class CentralSupabaseStatusData(
    val isConfigured: Boolean = false,
    val projectUrl: String = "",
    val publishableKeyPreview: String = "",
    val connected: Boolean = false,
    val tableStatus: Map<String, Boolean> = emptyMap(),
    val profileUserId: String = "",
    val profileEmail: String = "",
    val profileFullName: String = "",
    val profilePlatformRole: String = "",
    val profileSource: String = ""
)

data class CatalogDiagnosticItem(
    val checkType: String,
    val outletCode: String = "",
    val source: String = "",
    val fresh: Boolean = false,
    val total: Int = 0,
    val newItems: Int = 0,
    val changedItems: Int = 0,
    val unchangedItems: Int = 0,
    val summary: String = "",
    val warning: String? = null
)

data class SyncOutboxItemDto(
    val id: String,
    val targetUserId: String,
    val targetLabel: String,
    val status: String,
    val lastError: String?
)

data class OutletReportSummary(
    val outletName: String = "",
    val totalSales: Double = 0.0,
    val totalTax: Double = 0.0,
    val totalTransactions: Int = 0,
    val transactions: List<RemoteTransactionRow> = emptyList()
)

data class RemoteTransactionRow(
    val id: String,
    val referenceNumber: String,
    val subtitle: String,
    val paymentMode: String,
    val grandTotal: Double,
    val createdAt: String,
    val status: String
)

data class IntegrationRouteDto(
    val outletId: String,
    val outletCode: String,
    val outletName: String,
    val category: String,
    val configured: Boolean,
    val endpointUrl: String,
    val enabled: Boolean,
    val sendReceipts: Boolean,
    val sendFeedback: Boolean,
    val receiptTemplateName: String,
    val feedbackTemplateName: String,
    val lastHttpStatus: Int? = null,
    val lastError: String? = null,
    val reachabilityReachable: Boolean? = null,
    val reachabilityMessage: String? = null
)

data class IntegrationJobDto(
    val id: String,
    val outletId: String,
    val sourceType: String,
    val eventType: String,
    val status: String,
    val billNumber: String,
    val maskedPhone: String,
    val attempts: Int,
    val lastHttpStatus: Int? = null,
    val downstreamStatus: String = "",
    val whatsappStatus: String = "",
    val whatsappMessageId: String = "",
    val lastError: String? = null,
    val updatedAt: String = ""
)

data class IntegrationLogDto(
    val id: String,
    val eventId: String,
    val billId: String,
    val outletId: String,
    val billNumber: String,
    val eventType: String,
    val step: String,
    val status: String,
    val httpStatus: Int? = null,
    val whatsappStatus: String = "",
    val maskedPhone: String = "",
    val sanitizedError: String? = null,
    val createdAt: String = ""
)

data class IntegrationDiagnosticReport(
    val checkedAt: String = "",
    val serviceRoleConfigured: Boolean = false,
    val dispatchSecretConfigured: Boolean = false,
    val cronSecretConfigured: Boolean = false,
    val internalDispatcherEnabled: Boolean = false,
    val internalDispatcherIntervalSec: Int = 25,
    val internalDispatcherLastRunAt: String = "",
    val supabaseConnected: Boolean = false,
    val supabaseError: String? = null,
    val salonBillsCount: Int = 0,
    val centralSalesCount: Int = 0,
    val totalSyncedRecords: Int = 0,
    val pendingJobs: Int = 0,
    val sentJobs: Int = 0,
    val failedJobs: Int = 0,
    val skippedJobs: Int = 0,
    val totalJobs: Int = 0,
    val routes: List<IntegrationRouteDto> = emptyList(),
    val recentJobs: List<IntegrationJobDto> = emptyList(),
    val recentLogs: List<IntegrationLogDto> = emptyList()
)

data class IntegrationE2EStepDto(
    val step: String,
    val status: String,
    val detail: String
)

data class IntegrationE2EResult(
    val success: Boolean,
    val outletName: String = "",
    val billNumber: String = "",
    val eventId: String = "",
    val eventType: String = "",
    val httpStatus: Int? = null,
    val whatsappStatus: String = "",
    val sanitizedError: String? = null,
    val steps: List<IntegrationE2EStepDto> = emptyList()
)

