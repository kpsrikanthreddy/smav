package com.smav.printagent.ui.screens

import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.model.BranchOption
import com.smav.printagent.model.SalonCartItem
import com.smav.printagent.model.SalonService
import com.smav.printagent.util.BillIdGenerator
import java.util.Locale

internal const val EMPTY_CART_MESSAGE = "Your cart is empty. Add a service to continue."
internal const val ASIA_KOLKATA_TZ = "Asia/Kolkata"

internal enum class SalonPosTab {
    MENU,
    CART
}

internal enum class SalonFinalizeField {
    BRANCH,
    CUSTOMER_NAME,
    CUSTOMER_PHONE
}

internal data class SalonFinalizeValidationResult(
    val branchError: String? = null,
    val customerNameError: String? = null,
    val customerPhoneError: String? = null,
    val firstInvalidField: SalonFinalizeField? = null
) {
    val isValid: Boolean
        get() = firstInvalidField == null &&
            branchError == null &&
            customerNameError == null &&
            customerPhoneError == null
}

internal data class SalonCartLine(
    val lineId: String,
    val item: SalonCartItem
)

internal data class SalonSubcategoryGroup(
    val subcategory: String,
    val services: List<SalonService>
)

internal fun resolveSalonSubcategoryLabel(service: SalonService): String {
    if (service.subcategory.isNotBlank()) {
        return service.subcategory
            .trim()
            .replace('-', ' ')
            .replace('_', ' ')
            .split(Regex("\\s+"))
            .joinToString(" ") { word -> word.replaceFirstChar { it.titlecase(Locale.ENGLISH) } }
    }

    val source = service.name
        .lowercase(Locale.ENGLISH)
        .replace('-', ' ')
        .replace('_', ' ')

    return when {
        "wax" in source -> "Waxing"
        "hair cut" in source || "haircut" in source || "advance cut" in source -> "Hair Cuts"
        "hair colour" in source || "hair color" in source -> "Hair Colour"
        "blow dry" in source || "blowdry" in source || "hair styling" in source -> "Blow Dry & Styling"
        "hair spa" in source -> "Hair Spa"
        "hair makeover" in source -> "Hair Makeover"
        "hair wash" in source || "head massage" in source -> "Hair Wash & Massage"
        "facial" in source || "clean up" in source || "cleanup" in source || "d tan" in source -> "Facials & Clean-up"
        "thread" in source -> "Threading"
        "pedicure" in source || "manicure" in source -> "Nails Care"
        "massage" in source -> "Massage"
        "mask" in source || "masque" in source -> "Masks"
        service.category.isNotBlank() -> service.category.trim()
        else -> "Other Services"
    }
}

internal fun isExcludedSalonCategory(category: String): Boolean {
    val normalized = category.trim().lowercase(Locale.ENGLISH)
    return normalized == "spa"
}

/**
 * Dynamic category priority ordering for Salon POS:
 * 1. All
 * 2. Makeup
 * 3. Nails Art
 * 4. Salon
 * 5. Secondary Makeup-related categories (strictly after Salon)
 * 6. Any other dynamic categories alphabetically
 */
internal fun salonCategorySortPriority(category: String): Int {
    val normalized = category
        .trim()
        .lowercase(Locale.ENGLISH)
        .replace(Regex("\\s+"), " ")
    return when {
        normalized == "all" -> 0
        normalized == "makeup" -> 1
        normalized == "nails art" || normalized == "nail art" || normalized == "nails" -> 2
        normalized == "salon" || normalized.startsWith("salon ") -> 3
        "makeup" in normalized -> 4
        else -> 5
    }
}

internal fun buildSalonCategories(services: List<SalonService>): List<String> {
    val dynamicCategories = services
        .map { it.category.trim() }
        .filter { it.isNotBlank() && !isExcludedSalonCategory(it) }
        .distinctBy { it.lowercase(Locale.ENGLISH) }
        .sortedWith(
            compareBy<String>(
                { salonCategorySortPriority(it) },
                { it.lowercase(Locale.ENGLISH) }
            )
        )
    return listOf("All") + dynamicCategories
}

internal fun filterAndGroupSalonServices(
    services: List<SalonService>,
    selectedCategory: String,
    searchQuery: String
): List<SalonSubcategoryGroup> {
    val q = searchQuery.trim().lowercase(Locale.ENGLISH)
    val selectedNorm = selectedCategory.trim().lowercase(Locale.ENGLISH)

    val matching = services.filter { srv ->
        if (isExcludedSalonCategory(srv.category)) return@filter false
        val matchesCategory = selectedNorm == "all" ||
            srv.category.trim().lowercase(Locale.ENGLISH) == selectedNorm
        if (!matchesCategory) return@filter false
        if (q.isBlank()) return@filter true

        val resolvedSub = resolveSalonSubcategoryLabel(srv).lowercase(Locale.ENGLISH)
        val rawSub = srv.subcategory.trim().lowercase(Locale.ENGLISH)
        srv.name.lowercase(Locale.ENGLISH).contains(q) ||
            resolvedSub.contains(q) ||
            rawSub.contains(q)
    }

    return matching
        .groupBy { resolveSalonSubcategoryLabel(it) }
        .entries
        .sortedBy { it.key.lowercase(Locale.ENGLISH) }
        .map { (sub, list) ->
            SalonSubcategoryGroup(
                subcategory = sub,
                services = list
            )
        }
}

internal fun isSubcategoryExpanded(
    subcategory: String,
    expandedState: Map<String, Boolean>,
    searchQuery: String,
    defaultExpandedSubcategory: String?
): Boolean {
    if (searchQuery.isNotBlank()) return true
    return expandedState[subcategory] ?: (subcategory == defaultExpandedSubcategory)
}

internal fun findFirstMissingStylistLine(cartLines: List<SalonCartLine>): SalonCartLine? {
    return cartLines.firstOrNull { line ->
        val stylist = line.item.stylist
        stylist == null || stylist.id.isBlank()
    }
}

internal fun validateSalonFinalizeForm(
    selectedBranch: BranchOption?,
    customerName: String,
    customerPhone: String
): SalonFinalizeValidationResult {
    val branchError = if (selectedBranch == null || selectedBranch.id.isBlank()) {
        "Please select a branch."
    } else null

    val nameError = if (customerName.trim().isEmpty()) {
        "Customer name is required."
    } else null

    val trimmedPhone = customerPhone.trim()
    val phoneDigits = trimmedPhone.filter { it.isDigit() }
    val phoneError = when {
        trimmedPhone.isEmpty() -> "Customer phone is required."
        phoneDigits.length < 7 -> "Enter a valid phone number."
        else -> null
    }

    val firstInvalid = when {
        branchError != null -> SalonFinalizeField.BRANCH
        nameError != null -> SalonFinalizeField.CUSTOMER_NAME
        phoneError != null -> SalonFinalizeField.CUSTOMER_PHONE
        else -> null
    }

    return SalonFinalizeValidationResult(
        branchError = branchError,
        customerNameError = nameError,
        customerPhoneError = phoneError,
        firstInvalidField = firstInvalid
    )
}

internal fun filterTodaySalonBillsAsiaKolkata(
    bills: List<SalonBillEntity>,
    nowMs: Long = System.currentTimeMillis(),
    searchQuery: String = ""
): List<SalonBillEntity> {
    val q = searchQuery.trim().lowercase(Locale.ENGLISH)
    return bills.filter { bill ->
        if (bill.isVoided) return@filter false
        if (!BillIdGenerator.isSameOutletLocalDay(bill.createdAtLocal, nowMs, ASIA_KOLKATA_TZ)) {
            return@filter false
        }
        if (q.isBlank()) return@filter true
        bill.billNumber.lowercase(Locale.ENGLISH).contains(q) ||
            (bill.customerName ?: "").lowercase(Locale.ENGLISH).contains(q) ||
            (bill.customerPhone ?: "").lowercase(Locale.ENGLISH).contains(q)
    }
}

internal fun formatSalonRupee(amount: Double): String {
    val rounded = Math.round(amount * 100.0) / 100.0
    return if (rounded % 1.0 == 0.0) {
        "₹${rounded.toLong()}"
    } else {
        "₹${String.format(Locale.ENGLISH, "%.2f", rounded)}"
    }
}

internal fun formatSalonStaffName(value: String): String = value
    .trim()
    .lowercase(Locale.ENGLISH)
    .split(Regex("\\s+"))
    .filter { it.isNotBlank() }
    .joinToString(" ") { word -> word.replaceFirstChar { it.titlecase(Locale.ENGLISH) } }
