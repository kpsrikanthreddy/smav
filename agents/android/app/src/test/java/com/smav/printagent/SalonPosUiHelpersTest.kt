package com.smav.printagent

import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.model.BranchOption
import com.smav.printagent.model.SalonCartItem
import com.smav.printagent.model.SalonService
import com.smav.printagent.model.Stylist
import com.smav.printagent.ui.screens.SalonCartLine
import com.smav.printagent.ui.screens.SalonFinalizeField
import com.smav.printagent.ui.screens.buildSalonCategories
import com.smav.printagent.ui.screens.filterAndGroupSalonServices
import com.smav.printagent.ui.screens.filterTodaySalonBillsAsiaKolkata
import com.smav.printagent.ui.screens.findFirstMissingStylistLine
import com.smav.printagent.ui.screens.isSubcategoryExpanded
import com.smav.printagent.ui.screens.validateSalonFinalizeForm
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class SalonPosUiHelpersTest {

    private val sampleServices = listOf(
        SalonService(id = "s1", name = "Full Body Massage", category = "Spa", subcategory = "Therapy", price = 1800.0),
        SalonService(id = "s2", name = "Advance Haircut", category = "Salon", subcategory = "Hair Cuts", price = 600.0),
        SalonService(id = "s3", name = "Chrome Nail Art", category = "Nails Art", subcategory = "Extensions", price = 1500.0),
        SalonService(id = "s4", name = "HD Party Look", category = "Makeup", subcategory = "Party", price = 4500.0),
        SalonService(id = "s5", name = "Bridal Airbrush", category = "Bridal Makeup", subcategory = "Bridal", price = 18000.0),
        SalonService(id = "s6", name = "Keratin Blow Dry", category = "Salon", subcategory = "Blow Dry & Styling", price = 1200.0)
    )

    @Test
    fun testSalonCategoriesExcludeSpaAndFollowRequiredOrder() {
        val categories = buildSalonCategories(sampleServices)
        assertFalse(categories.any { it.equals("Spa", ignoreCase = true) })
        assertEquals(
            listOf("All", "Makeup", "Nails Art", "Salon", "Bridal Makeup"),
            categories
        )
        assertTrue(categories.indexOf("Salon") < categories.indexOf("Bridal Makeup"))
    }

    @Test
    fun testSearchMatchesServiceNameAndSubcategoryAndExcludesSpa() {
        val byName = filterAndGroupSalonServices(sampleServices, "All", "keratin")
        assertEquals(1, byName.size)
        assertEquals("Blow Dry & Styling", byName.first().subcategory)
        assertEquals("Keratin Blow Dry", byName.first().services.first().name)

        val bySubcategory = filterAndGroupSalonServices(sampleServices, "All", "extensions")
        assertEquals(1, bySubcategory.size)
        assertEquals("Extensions", bySubcategory.first().subcategory)
        assertEquals("Chrome Nail Art", bySubcategory.first().services.first().name)

        val spaSearch = filterAndGroupSalonServices(sampleServices, "All", "Full Body Massage")
        assertTrue(spaSearch.isEmpty())
    }

    @Test
    fun testSubcategoryAutoExpandsDuringSearchAndRespectsToggleOtherwise() {
        val state = mapOf("Hair Cuts" to false, "Blow Dry & Styling" to true)
        assertFalse(isSubcategoryExpanded("Hair Cuts", state, "", "Hair Cuts"))
        assertTrue(isSubcategoryExpanded("Blow Dry & Styling", state, "", "Hair Cuts"))
        assertTrue(isSubcategoryExpanded("Hair Cuts", state, "hair", "Blow Dry & Styling"))
    }

    @Test
    fun testFindFirstMissingStylistLineDetectsIncompleteService() {
        val stylist = Stylist(id = "st-1", name = "Stylist A")
        val lines = listOf(
            SalonCartLine("l1", SalonCartItem(sampleServices[1], stylist, 1)),
            SalonCartLine("l2", SalonCartItem(sampleServices[2], null, 1))
        )
        val missing = findFirstMissingStylistLine(lines)
        assertNotNull(missing)
        assertEquals("l2", missing?.lineId)

        val completed = listOf(
            SalonCartLine("l1", SalonCartItem(sampleServices[1], stylist, 1))
        )
        assertNull(findFirstMissingStylistLine(completed))
    }

    @Test
    fun testFinalizeValidationChecksBranchNamePhoneInOrder() {
        val branch = BranchOption(id = "b-1", name = "Branch One", branchCode = "BR1")

        val allMissing = validateSalonFinalizeForm(null, "", "")
        assertFalse(allMissing.isValid)
        assertEquals(SalonFinalizeField.BRANCH, allMissing.firstInvalidField)
        assertNotNull(allMissing.branchError)
        assertNotNull(allMissing.customerNameError)
        assertNotNull(allMissing.customerPhoneError)

        val missingName = validateSalonFinalizeForm(branch, "   ", "9876543210")
        assertFalse(missingName.isValid)
        assertEquals(SalonFinalizeField.CUSTOMER_NAME, missingName.firstInvalidField)
        assertNull(missingName.branchError)
        assertNotNull(missingName.customerNameError)

        val missingPhone = validateSalonFinalizeForm(branch, "Ananya", "123")
        assertFalse(missingPhone.isValid)
        assertEquals(SalonFinalizeField.CUSTOMER_PHONE, missingPhone.firstInvalidField)
        assertNotNull(missingPhone.customerPhoneError)

        val valid = validateSalonFinalizeForm(branch, "Ananya", "9876543210")
        assertTrue(valid.isValid)
        assertNull(valid.firstInvalidField)
    }

    @Test
    fun testBillsReprintFiltersOnlyTodayInAsiaKolkata() {
        val ist = TimeZone.getTimeZone("Asia/Kolkata")
        val calNow = Calendar.getInstance(ist).apply {
            set(2026, Calendar.NOVEMBER, 21, 14, 30, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val calYesterdayLate = Calendar.getInstance(ist).apply {
            set(2026, Calendar.NOVEMBER, 20, 23, 59, 59)
            set(Calendar.MILLISECOND, 999)
        }
        val calTodayEarly = Calendar.getInstance(ist).apply {
            set(2026, Calendar.NOVEMBER, 21, 0, 0, 1)
            set(Calendar.MILLISECOND, 0)
        }

        fun bill(id: String, no: String, customer: String, createdMs: Long, voided: Boolean = false) =
            SalonBillEntity(
                id = id,
                billNumber = no,
                branchId = "b-1",
                branchCode = "BR1",
                deviceId = "DEV1",
                idempotencyKey = "IDEM_$id",
                customerName = customer,
                customerPhone = "9876543210",
                paymentMode = "upi",
                subtotal = 1000.0,
                discountPercent = 0.0,
                discountAmount = 0.0,
                cgstAmount = 90.0,
                sgstAmount = 90.0,
                totalTax = 180.0,
                grandTotal = 1180.0,
                createdAtLocal = createdMs,
                isVoided = voided
            )

        val bills = listOf(
            bill("1", "TGL-BR1-20261120-0009", "Priya", calYesterdayLate.timeInMillis),
            bill("2", "TGL-BR1-20261121-0001", "Ananya", calTodayEarly.timeInMillis),
            bill("3", "TGL-BR1-20261121-0002", "Meera", calNow.timeInMillis, voided = true)
        )

        val todayOnly = filterTodaySalonBillsAsiaKolkata(bills, calNow.timeInMillis)
        assertEquals(1, todayOnly.size)
        assertEquals("TGL-BR1-20261121-0001", todayOnly.first().billNumber)

        val searched = filterTodaySalonBillsAsiaKolkata(bills, calNow.timeInMillis, "ananya")
        assertEquals(1, searched.size)
        assertTrue(filterTodaySalonBillsAsiaKolkata(bills, calNow.timeInMillis, "priya").isEmpty())
    }
}
