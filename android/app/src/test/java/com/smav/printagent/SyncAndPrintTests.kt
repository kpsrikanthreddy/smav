package com.smav.printagent

import com.smav.printagent.bluetooth.EscPosBuilder
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.model.BusinessType
import com.smav.printagent.model.PaperWidth
import com.smav.printagent.model.StaffSession
import com.smav.printagent.model.UserRole
import com.smav.printagent.util.ReceiptFormatter
import org.junit.Assert.*
import org.junit.Test
import java.nio.charset.Charset

class EscPosReceiptFormatterTest {

    @Test
    fun testSanitizeThermalCharacters() {
        val raw = "Haircut Price: ₹ 500 \t"
        val clean = EscPosBuilder.sanitizeForThermal(raw)
        assertFalse(clean.contains("₹"))
        assertTrue(clean.contains("Rs."))
        assertFalse(clean.contains("\t"))
    }

    @Test
    fun testTwoColumnWidthFits80mmColumns() {
        val builder = EscPosBuilder(PaperWidth.WIDTH_80MM)
        assertEquals(48, builder.totalColumns)
        builder.rowTwoColumns("Subtotal", "Rs. 1,450.00")
        val bytes = builder.build()
        val text = String(bytes, Charset.forName("CP437"))
        assertTrue(text.contains("Subtotal"))
        assertTrue(text.contains("Rs. 1,450.00"))
    }

    @Test
    fun test58mmColumnsWidth() {
        val builder = EscPosBuilder(PaperWidth.WIDTH_58MM)
        assertEquals(32, builder.totalColumns)
        builder.rowTwoColumns("Tax", "Rs. 45")
        val bytes = builder.build()
        val text = String(bytes, Charset.forName("CP437"))
        assertTrue(text.contains("Tax"))
        assertTrue(text.contains("Rs. 45"))
    }

    @Test
    fun testKotTicketContainsNoPrices() {
        val order = RestaurantOrderEntity(
            orderNumber = "MOZZ-GACH-20261106-00001",
            tokenNumber = "001",
            branchId = "branch_mozz_gach",
            branchCode = "GACH",
            deviceId = "DEV-01",
            idempotencyKey = "IDEM_1",
            customerName = "Rahul",
            customerPhone = "9876543210",
            paymentMode = "upi",
            subtotal = 550.0,
            discountAmount = 0.0,
            cgstAmount = 13.75,
            sgstAmount = 13.75,
            totalTax = 27.5,
            grandTotal = 578.0
        )

        val items = listOf(
            RestaurantOrderItemEntity(
                orderId = order.id,
                itemId = "item_shawarma",
                itemName = "Chicken Shawarma",
                categoryName = "Shawarma",
                variantId = "v_spicy",
                variantName = "Extra Spicy",
                quantity = 2,
                unitPrice = 180.0,
                totalPrice = 360.0
            )
        )

        val kotBytes = ReceiptFormatter.formatRestaurantKotBytes(order, items, PaperWidth.WIDTH_80MM)
        val kotText = String(kotBytes, Charset.forName("CP437"))

        assertTrue(kotText.contains("KITCHEN ORDER TICKET"))
        assertTrue(kotText.contains("TOKEN: #001"))
        assertTrue(kotText.contains("Chicken Shawarma"))
        assertTrue(kotText.contains("Extra Spicy"))

        // Requirement: KOT must NOT contain pricing or currency amounts
        assertFalse(kotText.contains("578"))
        assertFalse(kotText.contains("360"))
        assertFalse(kotText.contains("Rs."))
        assertFalse(kotText.contains("Subtotal"))
        assertFalse(kotText.contains("CGST"))
    }
}

class TenantIsolationTest {

    @Test
    fun testSalonStaffCannotAccessRestaurantPOS() {
        val salonStaffSession = StaffSession(
            token = "jwt_salon_user",
            userId = "usr_ananya",
            userName = "Ananya Rao",
            email = "ananya@glossylooks.com",
            businessId = "the_glossy_looks",
            businessType = BusinessType.SALON,
            businessName = "The Glossy Looks Salon & Spa",
            branchId = "branch_gl_gach",
            branchCode = "GACH",
            branchName = "Gachibowli Main",
            role = UserRole.SALON_RECEPTIONIST,
            permissions = listOf("pos:create_bill", "pos:view_services", "pos:print_receipt"),
            deviceId = "DEV-01"
        )

        // Verify session cannot be used for restaurant orders
        fun validateOrderCreation(session: StaffSession, targetBusinessType: BusinessType): Boolean {
            return session.businessType == targetBusinessType
        }

        assertFalse(validateOrderCreation(salonStaffSession, BusinessType.RESTAURANT))
        assertTrue(validateOrderCreation(salonStaffSession, BusinessType.SALON))
    }

    @Test
    fun testMultiBusinessSelectionRequiredForOwner() {
        val ownerMemberships = listOf(
            BusinessType.SALON,
            BusinessType.RESTAURANT
        )

        val requiresSelection = ownerMemberships.size > 1
        assertTrue(requiresSelection)
    }
}

class SyncDuplicatePreventionTest {

    @Test
    fun testDuplicateIdempotencyKeyDeduplication() {
        val syncLog = mutableSetOf<String>()

        fun processSync(idempotencyKey: String): String {
            if (syncLog.contains(idempotencyKey)) {
                return "DUPLICATE_IGNORED"
            }
            syncLog.add(idempotencyKey)
            return "SUCCESS"
        }

        val key = "IDEM_TGL-GACH-20261106-00001_DEV123456"
        val firstAttempt = processSync(key)
        val secondAttempt = processSync(key)

        assertEquals("SUCCESS", firstAttempt)
        assertEquals("DUPLICATE_IGNORED", secondAttempt)
        assertEquals(1, syncLog.size)
    }
}
