package com.smav.printagent.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Deterministic bill ID utilities.
 * Central salon bill numbers follow: {PREFIX}-{BRANCH_CODE}-{YYYYMMDD}-{SEQUENCE}
 */
object BillIdGenerator {

    private val kolkataTimeZone = TimeZone.getTimeZone("Asia/Kolkata")

    fun getTodayDateString(timestamp: Long = System.currentTimeMillis()): String {
        val sdf = SimpleDateFormat("yyyyMMdd", Locale.ENGLISH)
        sdf.timeZone = kolkataTimeZone
        return sdf.format(Date(timestamp))
    }

    fun getIndiaIsoDate(timestamp: Long = System.currentTimeMillis()): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH)
        sdf.timeZone = kolkataTimeZone
        return sdf.format(Date(timestamp))
    }

    fun getStartOfTodayMillis(
        nowMs: Long = System.currentTimeMillis(),
        timeZoneId: String = "Asia/Kolkata"
    ): Long {
        val tz = runCatching { TimeZone.getTimeZone(timeZoneId) }.getOrDefault(kolkataTimeZone)
        val cal = Calendar.getInstance(tz).apply {
            timeInMillis = nowMs
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return cal.timeInMillis
    }

    fun isSameOutletLocalDay(
        timestampMs: Long,
        nowMs: Long = System.currentTimeMillis(),
        timeZoneId: String = "Asia/Kolkata"
    ): Boolean {
        val start = getStartOfTodayMillis(nowMs, timeZoneId)
        val end = start + 24L * 60L * 60L * 1000L
        return timestampMs in start until end
    }

    fun getFormattedDateTime(timestamp: Long = System.currentTimeMillis()): String {
        val sdf = SimpleDateFormat("dd-MMM-yyyy hh:mm a", Locale.ENGLISH)
        sdf.timeZone = kolkataTimeZone
        return sdf.format(Date(timestamp))
    }

    fun salonBranchCode(code: String): String {
        return code.trim()
            .uppercase(Locale.ENGLISH)
            .replace(Regex("[^A-Z0-9]"), "")
            .take(12)
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
        val formattedSeq = String.format(Locale.ENGLISH, "%04d", sequenceNumber.coerceAtLeast(1))
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
        val regex = Regex("^[A-Z0-9]{2,8}-[A-Z0-9]{2,12}-\\d{8}-\\d{4,}$")
        return regex.matches(billNumber)
    }
}
