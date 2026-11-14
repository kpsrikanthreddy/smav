package com.smav.printagent.model

import com.google.gson.annotations.SerializedName

enum class BusinessType(val id: String, val displayName: String) {
    SALON("salon", "Salon & Spa"),
    RESTAURANT("restaurant", "Restaurant & Cloud Kitchen"),
    RETAIL("retail", "Shopping & Retail Store"),
    OTHER("other", "Other Enterprise Venture")
}

enum class UserRole(val code: String, val label: String) {
    SUPERADMIN("superadmin", "Superadministrator"),
    ADMIN("admin", "Outlet Administrator"),
    STAFF("staff", "Staff Member"),
    OWNER("owner", "Business Owner"),
    MANAGER("manager", "Branch Manager"),
    CASHIER("cashier", "Cashier"),
    SALON_RECEPTIONIST("salon_receptionist", "Salon Receptionist")
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
)

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
    val branchId: String,
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
    val isOnline: Boolean = true
)

data class AvailableBusinessOption(
    @SerializedName("outlet_id", alternate = ["business_id"]) val businessId: String,
    @SerializedName("outlet_name", alternate = ["business_name"]) val businessName: String,
    @SerializedName("outlet_category", alternate = ["business_type"]) val businessType: String,
    @SerializedName("branch_id") val branchId: String,
    @SerializedName("outlet_code", alternate = ["branch_code"]) val branchCode: String,
    @SerializedName("branch_name") val branchName: String,
    @SerializedName("role") val role: String
)
