package com.smav.printagent.bluetooth

import android.graphics.Bitmap
import com.smav.printagent.model.PaperWidth
import java.io.ByteArrayOutputStream
import java.nio.charset.Charset

/**
 * High-performance ESC/POS byte command generator supporting both 80mm (48 cols)
 * and 58mm (32 cols) Bluetooth thermal printers.
 */
class EscPosBuilder(val paperWidth: PaperWidth = PaperWidth.WIDTH_80MM) {

    val totalColumns: Int = paperWidth.columns
    private val output = ByteArrayOutputStream()
    private val charset = Charset.forName("CP437")

    init {
        initialize()
    }

    fun initialize(): EscPosBuilder {
        output.write(byteArrayOf(0x1B, 0x40)) // ESC @ : Initialize printer
        return this
    }

    fun alignLeft(): EscPosBuilder {
        output.write(byteArrayOf(0x1B, 0x61, 0x00)) // ESC a 0
        return this
    }

    fun alignCenter(): EscPosBuilder {
        output.write(byteArrayOf(0x1B, 0x61, 0x01)) // ESC a 1
        return this
    }

    fun alignRight(): EscPosBuilder {
        output.write(byteArrayOf(0x1B, 0x61, 0x02)) // ESC a 2
        return this
    }

    fun setBold(enabled: Boolean): EscPosBuilder {
        val flag = if (enabled) 0x01.toByte() else 0x00.toByte()
        output.write(byteArrayOf(0x1B, 0x45, flag)) // ESC E n
        return this
    }

    fun setDoubleSize(enabled: Boolean): EscPosBuilder {
        val flag = if (enabled) 0x11.toByte() else 0x00.toByte()
        output.write(byteArrayOf(0x1D, 0x21, flag)) // GS ! n (double width & height)
        return this
    }

    fun setDoubleHeight(enabled: Boolean): EscPosBuilder {
        val flag = if (enabled) 0x01.toByte() else 0x00.toByte()
        output.write(byteArrayOf(0x1D, 0x21, flag)) // GS ! 0x01
        return this
    }

    fun text(text: String): EscPosBuilder {
        val clean = sanitizeForThermal(text)
        output.write(clean.toByteArray(charset))
        return this
    }

    fun textLine(line: String): EscPosBuilder {
        text(line)
        newLine()
        return this
    }

    fun newLine(): EscPosBuilder {
        output.write(byteArrayOf(0x0A)) // LF
        return this
    }

    fun feedLines(count: Int): EscPosBuilder {
        output.write(byteArrayOf(0x1B, 0x64, count.toByte())) // ESC d n
        return this
    }

    fun divider(char: Char = '-'): EscPosBuilder {
        val line = char.toString().repeat(totalColumns)
        textLine(line)
        return this
    }

    fun doubleDivider(): EscPosBuilder {
        divider('=')
        return this
    }

    /**
     * Prints a two-column row perfectly spaced across selected width (32 cols for 58mm, 48 cols for 80mm).
     */
    fun rowTwoColumns(left: String, right: String): EscPosBuilder {
        val cleanLeft = sanitizeForThermal(left)
        val cleanRight = sanitizeForThermal(right)
        val rightLen = cleanRight.length
        val availableForLeft = totalColumns - rightLen - 1

        val truncatedLeft = if (cleanLeft.length > availableForLeft) {
            cleanLeft.take(availableForLeft)
        } else {
            cleanLeft
        }

        val spacesCount = totalColumns - truncatedLeft.length - rightLen
        val spaces = " ".repeat(spacesCount.coerceAtLeast(1))
        textLine("$truncatedLeft$spaces$cleanRight")
        return this
    }

    /**
     * Formats an item row dynamically budget-allocated for 58mm or 80mm:
     * - 80mm (48 cols): Name (28 chars), Qty (6 chars), Amount (14 chars)
     * - 58mm (32 cols): Name (16 chars), Qty (5 chars), Amount (11 chars)
     */
    fun rowItem(name: String, qtyText: String, amountText: String): EscPosBuilder {
        val cleanName = sanitizeForThermal(name)
        val cleanQty = sanitizeForThermal(qtyText)
        val cleanAmount = sanitizeForThermal(amountText)

        val amountBudget = if (totalColumns >= 48) 14 else 10
        val qtyBudget = if (totalColumns >= 48) 6 else 5
        val nameBudget = totalColumns - amountBudget - qtyBudget

        val amountPadded = cleanAmount.padStart(amountBudget)
        val qtyPadded = cleanQty.padStart(qtyBudget)

        if (cleanName.length <= nameBudget) {
            val namePadded = cleanName.padEnd(nameBudget)
            textLine("$namePadded$qtyPadded$amountPadded")
        } else {
            val firstLineName = cleanName.take(nameBudget)
            textLine("$firstLineName$qtyPadded$amountPadded")
            val remainder = cleanName.substring(nameBudget).trim()
            if (remainder.isNotEmpty()) {
                textLine("  $remainder")
            }
        }
        return this
    }

    fun cutPaper(supportCut: Boolean = true): EscPosBuilder {
        feedLines(3)
        if (supportCut) {
            output.write(byteArrayOf(0x1D, 0x56, 0x42, 0x00)) // GS V 66 0
        }
        return this
    }

    fun build(): ByteArray {
        return output.toByteArray()
    }

    companion object {
        fun sanitizeForThermal(input: String): String {
            return input
                .replace("₹", "Rs. ")
                .replace("\u20B9", "Rs. ")
                .replace("\t", " ")
        }
    }
}
