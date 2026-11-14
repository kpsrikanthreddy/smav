package com.smav.printagent.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Deterministic offline unique bill ID generator.
 * Format examples:
 * - The Glossy Looks Salon: TGL-GACH-20261106-00001
 * - MOZZ / Starters4U:       MOZZ-GACH-20261106-00001
 */
object BillIdGenerator {

    private val kolkataTimeZone = TimeZone.getTimeZone("Asia/Kolkata")

    fun getTodayDateString(timestamp: Long = System.currentTimeMillis()): String {
        val sdf = SimpleDateFormat("yyyyMMdd", Locale.ENGLISH)
        sdf.timeZone = kolkataTimeZone
        return sdf.format(Date(timestamp))
    }

    fun getFormattedDateTime(timestamp: Long = System.currentTimeMillis()): String {
        val sdf = SimpleDateFormat("dd-MMM-yyyy hh:mm a", Locale.ENGLISH)
        sdf.timeZone = kolkataTimeZone
        return sdf.format(Date(timestamp))
    }

    /**
     * Generates a unique local bill number: [PREFIX]-[BRANCH]-[YYYYMMDD]-[SEQUENCE]
     * @param businessPrefix "TGL" or "MOZZ"
     * @param branchCode "GACH", "KOK", "KNDP", etc.
     * @param sequenceNumber Sequential counter for the day (1-based integer)
     * @param timestamp Optional epoch milliseconds
     */
    fun generateBillNumber(
        businessPrefix: String,
        branchCode: String,
        sequenceNumber: Int,
        timestamp: Long = System.currentTimeMillis()
    ): String {
        val datePart = getTodayDateString(timestamp)
        val cleanBranch = branchCode.trim().uppercase()
        val formattedSeq = String.format(Locale.ENGLISH, "%05d", sequenceNumber.coerceAtLeast(1))
        return "$businessPrefix-$cleanBranch-$datePart-$formattedSeq"
    }

    /**
     * Generates a unique, collision-resistant idempotency key combining bill number and device hardware ID.
     */
    fun generateIdempotencyKey(billNumber: String, deviceId: String): String {
        val cleanDevice = deviceId.takeLast(12)
        return "IDEM_${billNumber}_$cleanDevice"
    }

    /**
     * Validates that a bill number conforms to the standard pattern.
     */
    fun isValidBillNumber(billNumber: String): Boolean {
        val regex = Regex("^(TGL|MOZZ)-[A-Z0-9]{2,8}-\\d{8}-\\d{5}$")
        return regex.matches(billNumber)
    }
}
