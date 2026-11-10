package com.smav.printagent

import com.smav.printagent.util.BillIdGenerator
import org.junit.Assert.*
import org.junit.Test

class BillIdGeneratorTest {

    @Test
    fun testSalonBillNumberFormat() {
        val billNumber = BillIdGenerator.generateBillNumber(
            businessPrefix = "TGL",
            branchCode = "GACH",
            sequenceNumber = 1
        )
        // Format must match TGL-GACH-YYYYMMDD-00001
        assertTrue(billNumber.startsWith("TGL-GACH-"))
        assertTrue(billNumber.endsWith("-00001"))
        assertTrue(BillIdGenerator.isValidBillNumber(billNumber))
    }

    @Test
    fun testRestaurantOrderNumberFormat() {
        val orderNumber = BillIdGenerator.generateBillNumber(
            businessPrefix = "MOZZ",
            branchCode = "KOK",
            sequenceNumber = 42
        )
        // Format must match MOZZ-KOK-YYYYMMDD-00042
        assertTrue(orderNumber.startsWith("MOZZ-KOK-"))
        assertTrue(orderNumber.endsWith("-00042"))
        assertTrue(BillIdGenerator.isValidBillNumber(orderNumber))
    }

    @Test
    fun testSequenceNumberPadding() {
        val bill99 = BillIdGenerator.generateBillNumber("TGL", "GACH", 99)
        assertTrue(bill99.endsWith("-00099"))

        val bill1000 = BillIdGenerator.generateBillNumber("TGL", "GACH", 1000)
        assertTrue(bill1000.endsWith("-01000"))
    }

    @Test
    fun testIdempotencyKeyDeterministic() {
        val billNo = "TGL-GACH-20261106-00001"
        val deviceId = "SMAV-DEV-AABBCCDDEEFF"
        val key1 = BillIdGenerator.generateIdempotencyKey(billNo, deviceId)
        val key2 = BillIdGenerator.generateIdempotencyKey(billNo, deviceId)

        assertEquals(key1, key2)
        assertTrue(key1.contains(billNo))
        assertTrue(key1.startsWith("IDEM_"))
    }
}
