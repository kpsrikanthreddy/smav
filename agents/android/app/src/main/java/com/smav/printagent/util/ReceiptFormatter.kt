package com.smav.printagent.util

import com.smav.printagent.bluetooth.EscPosBuilder
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.model.Branch
import com.smav.printagent.model.PaperWidth
import java.util.Locale

object ReceiptFormatter {

    /**
     * Formats a thermal receipt for The Glossy Looks Salon (supports 80mm and 58mm).
     */
    fun formatSalonReceiptBytes(
        bill: SalonBillEntity,
        items: List<SalonBillItemEntity>,
        branch: Branch,
        cashierName: String = "Front Desk",
        paperWidth: PaperWidth = PaperWidth.WIDTH_80MM,
        supportCut: Boolean = true
    ): ByteArray {
        val b = EscPosBuilder(paperWidth)

        // Header
        b.alignCenter()
        b.setBold(true)
        b.setDoubleSize(true)
        b.textLine("THE GLOSSY LOOKS")
        b.setDoubleSize(false)
        b.textLine("Luxury Salon & Spa")
        b.setBold(false)
        b.textLine(branch.name)
        b.textLine(branch.address)
        b.textLine("Tel: ${branch.phone}")
        if (branch.gstin.isNotBlank()) {
            b.textLine("GSTIN: ${branch.gstin}")
        }
        b.doubleDivider()

        // Metadata
        b.alignLeft()
        b.rowTwoColumns("Bill No: ${bill.billNumber}", "Mode: ${bill.paymentMode.uppercase(Locale.ENGLISH)}")
        b.rowTwoColumns("Date: ${BillIdGenerator.getFormattedDateTime(bill.createdAtLocal)}", "Staff: $cashierName")
        if (!bill.customerName.isNullOrBlank() || !bill.customerPhone.isNullOrBlank()) {
            val name = bill.customerName?.takeIf { it.isNotBlank() } ?: "Guest"
            val phone = bill.customerPhone?.takeIf { it.isNotBlank() } ?: "N/A"
            b.rowTwoColumns("Client: $name", "Mob: $phone")
        }
        b.divider()

        // Column Headers
        b.rowItem("SERVICE / STYLIST", "QTY", "AMOUNT (Rs)")
        b.divider()

        // Items
        items.forEach { item ->
            val desc = if (!item.stylistName.isNullOrBlank()) {
                "${item.serviceName} (${item.stylistName})"
            } else {
                item.serviceName
            }
            val amountFormatted = String.format(Locale.ENGLISH, "%.2f", item.totalAmount)
            b.rowItem(desc, "x${item.quantity}", amountFormatted)
        }
        b.divider()

        // Financial Summary
        b.alignRight()
        b.rowTwoColumns("Subtotal:", String.format(Locale.ENGLISH, "Rs. %.2f", bill.subtotal))
        if (bill.discountAmount > 0) {
            val discLabel = if (bill.discountPercent > 0) "Discount (${bill.discountPercent.toInt()}%):" else "Discount:"
            b.rowTwoColumns(discLabel, String.format(Locale.ENGLISH, "-Rs. %.2f", bill.discountAmount))
        }
        if (bill.cgstAmount > 0 || bill.sgstAmount > 0) {
            b.rowTwoColumns("CGST (9.0%):", String.format(Locale.ENGLISH, "Rs. %.2f", bill.cgstAmount))
            b.rowTwoColumns("SGST (9.0%):", String.format(Locale.ENGLISH, "Rs. %.2f", bill.sgstAmount))
        }
        if (bill.roundOff != 0.0) {
            b.rowTwoColumns("Round Off:", String.format(Locale.ENGLISH, "%+.2f", bill.roundOff))
        }
        b.doubleDivider()

        // Grand Total
        b.setBold(true)
        b.setDoubleHeight(true)
        b.rowTwoColumns("NET AMOUNT:", String.format(Locale.ENGLISH, "Rs. %.2f", bill.grandTotal))
        b.setDoubleHeight(false)
        b.setBold(false)
        b.doubleDivider()

        // Footer & WhatsApp info
        b.alignCenter()
        b.textLine(branch.receiptFooter.ifBlank { "Thank you! Visit us again." })
        b.textLine("Digital invoice & rewards sent via WhatsApp")
        b.newLine()
        b.cutPaper(supportCut)

        return b.build()
    }

    /**
     * Formats a thermal receipt for MOZZ / Starters4U Restaurant Customer Bill.
     */
    fun formatRestaurantBillBytes(
        order: RestaurantOrderEntity,
        items: List<RestaurantOrderItemEntity>,
        branch: Branch,
        paperWidth: PaperWidth = PaperWidth.WIDTH_80MM,
        supportCut: Boolean = true
    ): ByteArray {
        val b = EscPosBuilder(paperWidth)

        // Header
        b.alignCenter()
        b.setBold(true)
        b.setDoubleSize(true)
        b.textLine("MOZZ / STARTERS4U")
        b.setDoubleSize(false)
        b.textLine("Diner & Flame Kitchen")
        b.setBold(false)
        b.textLine(branch.name)
        b.textLine("Ph: ${branch.phone} | GSTIN: ${branch.gstin}")
        b.doubleDivider()

        // Metadata
        b.alignLeft()
        b.setBold(true)
        b.rowTwoColumns("ORDER: ${order.orderNumber}", "TOKEN: #${order.tokenNumber}")
        b.setBold(false)
        b.rowTwoColumns("Table/Counter: ${order.tableOrCounter}", "Type: ${order.orderType.uppercase(Locale.ENGLISH)}")
        b.rowTwoColumns("Date: ${BillIdGenerator.getFormattedDateTime(order.createdAtLocal)}", "Pay: ${order.paymentMode.uppercase(Locale.ENGLISH)}")
        if (!order.customerPhone.isNullOrBlank()) {
            b.textLine("Customer: ${order.customerName ?: "Valued Guest"} (${order.customerPhone})")
        }
        b.divider()

        // Items
        b.rowItem("ITEM / VARIANT", "QTY", "AMOUNT (Rs)")
        b.divider()

        items.forEach { item ->
            val nameWithVar = if (!item.variantName.isNullOrBlank()) {
                "${item.itemName} [${item.variantName}]"
            } else {
                item.itemName
            }
            val amountFormatted = String.format(Locale.ENGLISH, "%.2f", item.totalPrice)
            b.rowItem(nameWithVar, "x${item.quantity}", amountFormatted)
        }
        b.divider()

        // Totals
        b.rowTwoColumns("Subtotal:", String.format(Locale.ENGLISH, "Rs. %.2f", order.subtotal))
        if (order.discountAmount > 0) {
            b.rowTwoColumns("Discount:", String.format(Locale.ENGLISH, "-Rs. %.2f", order.discountAmount))
        }
        if (order.totalTax > 0) {
            b.rowTwoColumns("CGST (2.5%):", String.format(Locale.ENGLISH, "Rs. %.2f", order.cgstAmount))
            b.rowTwoColumns("SGST (2.5%):", String.format(Locale.ENGLISH, "Rs. %.2f", order.sgstAmount))
        }
        b.doubleDivider()

        // Grand Total
        b.setBold(true)
        b.setDoubleHeight(true)
        b.rowTwoColumns("TOTAL DUE:", String.format(Locale.ENGLISH, "Rs. %.2f", order.grandTotal))
        b.setDoubleHeight(false)
        b.setBold(false)
        b.doubleDivider()

        b.alignCenter()
        b.textLine("Thank you for dining with us!")
        b.textLine("Order online at starters4u.in")
        b.newLine()
        b.cutPaper(supportCut)

        return b.build()
    }

    /**
     * Formats Kitchen Order Ticket (KOT) - WITHOUT PRICES.
     */
    fun formatRestaurantKotBytes(
        order: RestaurantOrderEntity,
        items: List<RestaurantOrderItemEntity>,
        paperWidth: PaperWidth = PaperWidth.WIDTH_80MM,
        supportCut: Boolean = true
    ): ByteArray {
        val b = EscPosBuilder(paperWidth)

        b.alignCenter()
        b.setBold(true)
        b.setDoubleSize(true)
        b.textLine("*** KITCHEN ORDER TICKET ***")
        b.setDoubleSize(false)
        b.doubleDivider()

        b.alignLeft()
        b.setBold(true)
        b.rowTwoColumns("TOKEN: #${order.tokenNumber}", "TABLE: ${order.tableOrCounter}")
        b.setBold(false)
        b.rowTwoColumns("Order: ${order.orderNumber}", "Type: ${order.orderType.uppercase(Locale.ENGLISH)}")
        b.textLine("Time: ${BillIdGenerator.getFormattedDateTime(order.createdAtLocal)}")
        b.divider()

        // Columns: ITEM, QTY (NO PRICES)
        b.setBold(true)
        b.rowTwoColumns("ITEM & SPECIFICATION", "QUANTITY")
        b.setBold(false)
        b.divider()

        items.forEach { item ->
            b.setBold(true)
            val variantText = if (!item.variantName.isNullOrBlank()) " (${item.variantName})" else ""
            b.rowTwoColumns("${item.itemName}$variantText", "  [ ${item.quantity} ]  ")
            b.setBold(false)
            if (!item.notes.isNullOrBlank()) {
                b.textLine("  * NOTE: ${item.notes}")
            }
        }

        if (!order.specialInstructions.isNullOrBlank()) {
            b.divider()
            b.setBold(true)
            b.textLine("SPECIAL INSTRUCTIONS: ${order.specialInstructions}")
            b.setBold(false)
        }

        b.doubleDivider()
        b.alignCenter()
        b.textLine("--- END OF KOT ---")
        b.newLine()
        b.cutPaper(supportCut)

        return b.build()
    }
}
