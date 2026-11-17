package com.smav.printagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.local.entities.RestaurantOrderEntity
import com.smav.printagent.data.local.entities.RetailBillEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.repository.*
import com.smav.printagent.model.*
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.*
import com.smav.printagent.util.BillIdGenerator
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun PosBillingRouterScreen(
    session: StaffSession,
    catalogRepo: CatalogSyncRepository,
    billingRepo: BillingRepository,
    sessionManager: SessionManager,
    onOpenOutletSwitcher: () -> Unit,
    onOpenRecentBills: () -> Unit,
    onOpenPrinterSettings: () -> Unit,
    onUnauthorized: (String) -> Unit
) {
    if (session.businessType == BusinessType.OTHER) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            EmptyStateCard(
                title = "Select an Outlet for POS",
                subtitle = "You are currently in Central Enterprise Headquarters view. Choose a Salon, Restaurant, or Retail outlet to launch POS billing.",
                icon = Icons.Default.PointOfSale
            )
            SmavGradientButton(
                text = "Choose Authorized Outlet",
                icon = Icons.Default.SwapHoriz,
                onClick = onOpenOutletSwitcher,
                modifier = Modifier.fillMaxWidth()
            )
        }
        return
    }

    val scope = rememberCoroutineScope()
    var bundle by remember(session.businessId) { mutableStateOf<PosInitBundle?>(null) }
    var loading by remember(session.businessId) { mutableStateOf(true) }
    var errorMsg by remember(session.businessId) { mutableStateOf<String?>(null) }

    fun loadCatalog() {
        scope.launch {
            loading = true; errorMsg = null
            catalogRepo.loadPosData(session.businessId, session.businessType)
                .onSuccess { bundle = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(session.businessId, session.businessType) { loadCatalog() }

    val branch = remember(session) {
        Outlet(
            id = session.businessId,
            code = session.branchCode.ifBlank { "MAIN" },
            name = session.businessName,
            category = session.businessType.id,
            address = "",
            phone = "",
            gstin = "",
            receiptHeader = sessionManager.getReceiptHeader(session.businessId, session.businessName),
            receiptFooter = sessionManager.getReceiptFooter(session.businessId, "Thank you! Visit us again.")
        )
    }

    when (session.businessType) {
        BusinessType.SALON -> SalonPosScreen(
            session = session,
            branch = branch,
            bundle = bundle,
            loading = loading,
            loadError = errorMsg,
            onRefresh = { loadCatalog() },
            billingRepo = billingRepo,
            onOpenRecentBills = onOpenRecentBills,
            onOpenPrinterSettings = onOpenPrinterSettings
        )

        BusinessType.RESTAURANT -> RestaurantPosScreen(
            session = session,
            branch = branch,
            bundle = bundle,
            loading = loading,
            loadError = errorMsg,
            onRefresh = { loadCatalog() },
            billingRepo = billingRepo,
            onOpenRecentBills = onOpenRecentBills,
            onOpenPrinterSettings = onOpenPrinterSettings
        )

        BusinessType.RETAIL -> RetailPosScreen(
            session = session,
            branch = branch,
            bundle = bundle,
            loading = loading,
            loadError = errorMsg,
            onRefresh = { loadCatalog() },
            billingRepo = billingRepo,
            onOpenRecentBills = onOpenRecentBills,
            onOpenPrinterSettings = onOpenPrinterSettings
        )

        BusinessType.OTHER -> Unit
    }
}

// -------------------------------------------------------------------------------------------------
// 1. SALON POS SCREEN (GLOSSY LOOKS)
// -------------------------------------------------------------------------------------------------
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SalonPosScreen(
    session: StaffSession,
    branch: Outlet,
    bundle: PosInitBundle?,
    loading: Boolean,
    loadError: String?,
    onRefresh: () -> Unit,
    billingRepo: BillingRepository,
    onOpenRecentBills: () -> Unit,
    onOpenPrinterSettings: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var search by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("All") }
    var selectedSubcategory by remember { mutableStateOf("All") }

    var cart by remember { mutableStateOf<List<SalonCartItem>>(emptyList()) }
    var customerName by remember { mutableStateOf("") }
    var customerPhone by remember { mutableStateOf("") }
    var discountPercentText by remember { mutableStateOf("0") }
    var paymentMode by remember { mutableStateOf("upi") }

    var pendingServiceToPickStylist by remember { mutableStateOf<SalonService?>(null) }
    var showAppointmentsDialog by remember { mutableStateOf(false) }
    var showCartSheet by remember { mutableStateOf(false) }

    var busyBilling by remember { mutableStateOf(false) }
    var billingError by remember { mutableStateOf<String?>(null) }
    var completedBill by remember { mutableStateOf<SalonBillEntity?>(null) }
    var printFeedback by remember { mutableStateOf<String?>(null) }

    val services = bundle?.salonServices.orEmpty()
    val stylists = bundle?.stylists.orEmpty()
    val stylistWarning = bundle?.stylistWarning
        ?: if (!loading && bundle != null && stylists.isEmpty()) {
            "No active stylists returned for this outlet. Tap Retry to reload."
        } else null
    val appointments = bundle?.appointments.orEmpty()

    val categories = remember(services) {
        listOf("All") + services.map { it.category }.filter { it.isNotBlank() }.distinct().sorted()
    }
    val subcategories = remember(services, selectedCategory) {
        val base = if (selectedCategory == "All") services else services.filter { it.category == selectedCategory }
        val subs = base.map { it.subcategory }.filter { it.isNotBlank() }.distinct().sorted()
        if (subs.isEmpty()) emptyList() else listOf("All") + subs
    }

    val filteredServices = remember(services, search, selectedCategory, selectedSubcategory) {
        val q = search.trim().lowercase(Locale.ENGLISH)
        services.filter { s ->
            (selectedCategory == "All" || s.category == selectedCategory) &&
                (selectedSubcategory == "All" || s.subcategory == selectedSubcategory) &&
                (q.isBlank() || s.name.lowercase(Locale.ENGLISH).contains(q) || s.category.lowercase(Locale.ENGLISH).contains(q))
        }
    }

    val qtyByServiceId = remember(cart) {
        cart.groupBy { it.service.id }.mapValues { (_, items) -> items.sumOf { it.quantity } }
    }
    val stylistsByServiceId = remember(cart) {
        cart.groupBy { it.service.id }.mapValues { (_, items) ->
            items.mapNotNull { it.stylist?.name }.distinct().joinToString(", ")
        }
    }

    val discountPct = (discountPercentText.toDoubleOrNull() ?: 0.0).coerceIn(0.0, 100.0)
    val effectiveCart = remember(cart, discountPct) {
        cart.map { it.copy(discountPercent = discountPct) }
    }
    val grandTotal = remember(effectiveCart) {
        Math.round(effectiveCart.sumOf { it.totalAmount }).toDouble()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 14.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmavSecondaryButton(
                        text = "Sync Catalog (${services.size})",
                        icon = Icons.Default.Refresh,
                        enabled = !loading,
                        onClick = onRefresh
                    )
                    if (appointments.isNotEmpty()) {
                        SmavSecondaryButton(
                            text = "Appointments (${appointments.size})",
                            icon = Icons.Default.CalendarToday,
                            onClick = { showAppointmentsDialog = true }
                        )
                    }
                    SmavSecondaryButton(
                        text = "Recent Bills",
                        icon = Icons.Default.ReceiptLong,
                        onClick = onOpenRecentBills
                    )
                }
            }

            if (bundle?.fromCache == true) {
                item {
                    SmavWarningBannerCard("Using offline cached catalog (${services.size} services).")
                }
            }

            if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
            if (loadError != null) item { ErrorBannerCard(loadError, onRetry = onRefresh) }
            if (stylistWarning != null) item { ErrorBannerCard(stylistWarning, onRetry = onRefresh) }
            if (billingError != null) item { ErrorBannerCard(billingError!!) }

            item { SearchField(search, { search = it }, "Search hair, skin, spa services...") }

            if (categories.size > 1) {
                item {
                    FilterFlowRow(categories, selectedCategory, { it }, {
                        selectedCategory = it
                        selectedSubcategory = "All"
                    })
                }
            }
            if (subcategories.isNotEmpty()) {
                item {
                    FilterFlowRow(subcategories, selectedSubcategory, { it }, { selectedSubcategory = it })
                }
            }

            if (!loading && filteredServices.isEmpty()) {
                item { EmptyStateCard("No Services Found", "Try clearing your search or refreshing the outlet catalog.", Icons.Default.ContentCut) }
            }

            items(filteredServices, key = { it.id }) { srv ->
                val qty = qtyByServiceId[srv.id] ?: 0
                val assignedStylistNames = stylistsByServiceId[srv.id].orEmpty()
                SmavItemCard(
                    title = srv.name,
                    subtitle = "${srv.category}${if (srv.subcategory.isNotBlank()) " • ${srv.subcategory}" else ""}",
                    meta = "+${srv.gstPercent.toInt()}% GST",
                    price = srv.price,
                    quantity = qty,
                    enabled = !loading && stylists.isNotEmpty(),
                    disabledReason = if (!loading && stylists.isEmpty()) "Active stylist required" else null,
                    onIncrement = {
                        if (stylists.isEmpty()) {
                            billingError = stylistWarning ?: "No active stylists available. Tap Retry to load stylists."
                        } else {
                            billingError = null
                            val lastIdx = cart.indexOfLast { it.service.id == srv.id }
                            if (lastIdx >= 0) {
                                cart = cart.toMutableList().also { list ->
                                    list[lastIdx] = list[lastIdx].copy(quantity = list[lastIdx].quantity + 1)
                                }
                            } else {
                                pendingServiceToPickStylist = srv
                            }
                        }
                    },
                    onDecrement = {
                        val lastIdx = cart.indexOfLast { it.service.id == srv.id }
                        if (lastIdx >= 0) {
                            val current = cart[lastIdx]
                            cart = if (current.quantity <= 1) {
                                cart.toMutableList().also { it.removeAt(lastIdx) }
                            } else {
                                cart.toMutableList().also { it[lastIdx] = current.copy(quantity = current.quantity - 1) }
                            }
                        }
                    },
                    footer = if (qty > 0 && assignedStylistNames.isNotBlank()) {
                        {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Stylist: $assignedStylistNames",
                                    color = SmavColors.StepperGreen,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.weight(1f)
                                )
                                TextButton(
                                    onClick = { pendingServiceToPickStylist = srv },
                                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                                ) {
                                    Text("Add / Change Stylist", color = SmavColors.AccentPink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    } else null
                )
            }
        }

        SmavCheckoutBottomBar(
            countLabel = "${cart.sumOf { it.quantity }} service(s) in cart",
            totalAmount = grandTotal,
            ctaText = "Review & Bill",
            ctaEnabled = cart.isNotEmpty(),
            ctaIcon = Icons.Default.ShoppingCartCheckout,
            onCtaClick = { showCartSheet = true }
        )
    }

    pendingServiceToPickStylist?.let { srv ->
        MobileFormDialog(
            title = "Select Stylist",
            onDismiss = { pendingServiceToPickStylist = null },
            confirmText = "Cancel",
            onConfirm = { pendingServiceToPickStylist = null }
        ) {
            Text(srv.name, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text("Choose required stylist for this service:", color = SmavColors.TextSecondary, fontSize = 12.sp)
            stylists.forEach { stylist ->
                SmavSecondaryButton(
                    text = "${stylist.name}${if (stylist.specialty.isNotBlank()) " (${stylist.specialty})" else ""}",
                    icon = Icons.Default.Person,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        val existingIdx = cart.indexOfFirst { it.service.id == srv.id && it.stylist?.id == stylist.id }
                        cart = if (existingIdx >= 0) {
                            cart.toMutableList().also { list ->
                                list[existingIdx] = list[existingIdx].copy(quantity = list[existingIdx].quantity + 1)
                            }
                        } else {
                            cart + SalonCartItem(service = srv, stylist = stylist, quantity = 1)
                        }
                        pendingServiceToPickStylist = null
                    }
                )
            }
        }
    }

    if (showAppointmentsDialog) {
        MobileFormDialog(
            title = "Upcoming Appointments",
            onDismiss = { showAppointmentsDialog = false },
            confirmText = "Close",
            onConfirm = { showAppointmentsDialog = false }
        ) {
            appointments.forEach { appt ->
                SmavCard(
                    onClick = {
                        customerName = appt.customerName
                        customerPhone = appt.customerPhone
                        val matchedSrv = services.firstOrNull { it.id == appt.serviceId }
                        val matchedStylist = stylists.firstOrNull { it.id == appt.stylistId } ?: stylists.firstOrNull()
                        if (matchedSrv != null && matchedStylist != null) {
                            cart = cart + SalonCartItem(matchedSrv, matchedStylist, 1)
                        }
                        showAppointmentsDialog = false
                    }
                ) {
                    Text("${appt.customerName} (${appt.customerPhone})", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                    Text("${appt.serviceName} • ${appt.appointmentTime}", color = SmavColors.InfoText, fontSize = 12.sp)
                    Text("Tap to load into POS bill", color = SmavColors.StepperGreen, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    if (showCartSheet) {
        MobileFormDialog(
            title = "Finalize Salon Bill",
            onDismiss = { showCartSheet = false },
            confirmText = "Generate & Print Bill",
            confirmEnabled = effectiveCart.isNotEmpty() && !busyBilling && stylists.isNotEmpty() && effectiveCart.none { it.stylist == null || it.stylist.id.isBlank() },
            isSaving = busyBilling,
            onConfirm = {
                if (!busyBilling) {
                    if (effectiveCart.any { it.stylist == null || it.stylist.id.isBlank() }) {
                        billingError = "Select a stylist for every salon service before printing."
                    } else {
                        busyBilling = true
                        billingError = null
                        scope.launch {
                            val res = billingRepo.createSalonBill(
                                cartItems = effectiveCart,
                                customerName = customerName,
                                customerPhone = customerPhone,
                                paymentMode = paymentMode,
                                branch = branch,
                                cashierName = session.userName,
                                shouldPrint = false
                            )
                            res.onSuccess { bill ->
                                completedBill = bill
                                cart = emptyList()
                                customerName = ""
                                customerPhone = ""
                                discountPercentText = "0"
                                showCartSheet = false

                                val printRes = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                                printFeedback = printRes.fold(
                                    { "Bill ${bill.billNumber} saved and printed via Bluetooth ESC/POS." },
                                    { err -> "Bill ${bill.billNumber} saved, but Bluetooth print failed (${err.message ?: "Printer unavailable"}). Tap Reprint after connecting printer." }
                                )
                            }.onFailure { err ->
                                billingError = err.message ?: "Failed to generate bill."
                            }
                            busyBilling = false
                        }
                    }
                }
            }
        ) {
            effectiveCart.forEachIndexed { idx, item ->
                SmavCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                            Text(item.service.name, color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("Stylist: ${item.stylist?.name ?: "Staff"}", color = SmavColors.InfoText, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                            Text(
                                text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", item.totalAmount)}",
                                style = SmavNumericStyles.Price,
                                color = SmavColors.StepperGreen
                            )
                        }
                        SmavQuantityStepper(
                            quantity = item.quantity,
                            itemName = item.service.name,
                            onDecrement = {
                                cart = if (item.quantity <= 1) {
                                    cart.toMutableList().also { it.removeAt(idx) }
                                } else {
                                    cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity - 1) }
                                }
                            },
                            onIncrement = {
                                cart = cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                            }
                        )
                    }
                }
            }

            OutlinedTextField(
                value = customerName,
                onValueChange = { customerName = it },
                label = { Text("Customer Name (Optional)") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = customerPhone,
                onValueChange = { customerPhone = it },
                label = { Text("Customer Phone (Optional)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = discountPercentText,
                onValueChange = { discountPercentText = it },
                label = { Text("Discount (%)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            Text("Payment Mode", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            FilterFlowRow(
                items = listOf("upi", "cash", "card", "split"),
                selected = paymentMode,
                labelOf = { it.uppercase(Locale.ENGLISH) },
                onSelect = { paymentMode = it }
            )
            SummaryStatCard("Net Payable (incl. GST)", "Rs. ${String.format(Locale.ENGLISH, "%.0f", grandTotal)}", accent = SmavColors.StepperGreen)
        }
    }

    completedBill?.let { bill ->
        AlertDialog(
            onDismissRequest = { completedBill = null },
            containerColor = SmavColors.Surface,
            title = { Text("Bill Generated", color = SmavColors.StepperGreen, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Bill No: ${bill.billNumber}", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                    Text("Amount: Rs. ${String.format(Locale.ENGLISH, "%.2f", bill.grandTotal)}", style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
                    Text("Payment: ${bill.paymentMode.uppercase(Locale.ENGLISH)}", color = SmavColors.TextSecondary)
                    if (printFeedback != null) Text(printFeedback!!, color = SmavColors.InfoText, fontSize = 12.sp)
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        scope.launch {
                            val res = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                            printFeedback = res.fold(
                                { "Receipt reprinted via Bluetooth." },
                                { "Printer unavailable (${it.message}). Check Printer Settings." }
                            )
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = SmavColors.AccentPink, contentColor = Color.White)
                ) { Text("Reprint", fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers", color = SmavColors.InfoText) }
                    TextButton(onClick = { completedBill = null }) { Text("Done", color = SmavColors.TextSecondary) }
                }
            }
        )
    }
}

// -------------------------------------------------------------------------------------------------
// 2. RESTAURANT POS SCREEN (MOZZ / STARTERS4U)
// -------------------------------------------------------------------------------------------------
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RestaurantPosScreen(
    session: StaffSession,
    branch: Outlet,
    bundle: PosInitBundle?,
    loading: Boolean,
    loadError: String?,
    onRefresh: () -> Unit,
    billingRepo: BillingRepository,
    onOpenRecentBills: () -> Unit,
    onOpenPrinterSettings: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var search by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("All") }
    var vegOnly by remember { mutableStateOf(false) }

    var orderType by remember { mutableStateOf(OrderType.DINE_IN) }
    var selectedTable by remember { mutableStateOf("Table 1") }
    var cart by remember { mutableStateOf<List<RestaurantCartItem>>(emptyList()) }
    var customerName by remember { mutableStateOf("") }
    var customerPhone by remember { mutableStateOf("") }
    var specialInstructions by remember { mutableStateOf("") }
    var paymentMode by remember { mutableStateOf("upi") }

    var pendingVariantItem by remember { mutableStateOf<RestaurantMenuItem?>(null) }
    var showCartSheet by remember { mutableStateOf(false) }
    var busyOrder by remember { mutableStateOf(false) }
    var orderError by remember { mutableStateOf<String?>(null) }
    var completedOrder by remember { mutableStateOf<RestaurantOrderEntity?>(null) }
    var printFeedback by remember { mutableStateOf<String?>(null) }

    val menu = bundle?.menuItems.orEmpty()
    val tables = bundle?.tables.orEmpty().ifEmpty { (1..6).map { RestaurantTable("Table $it") } }

    val categories = remember(menu) {
        listOf("All") + menu.map { it.category }.filter { it.isNotBlank() }.distinct().sorted()
    }

    val filteredMenu = remember(menu, search, selectedCategory, vegOnly) {
        val q = search.trim().lowercase(Locale.ENGLISH)
        menu.filter { m ->
            (!vegOnly || m.isVeg) &&
                (selectedCategory == "All" || m.category == selectedCategory) &&
                (q.isBlank() || m.name.lowercase(Locale.ENGLISH).contains(q) || m.category.lowercase(Locale.ENGLISH).contains(q))
        }
    }

    val qtyByMenuId = remember(cart) {
        cart.groupBy { it.item.id }.mapValues { (_, items) -> items.sumOf { it.quantity } }
    }

    val subtotal = cart.sumOf { it.subtotal }
    val estimatedGrandTotal = Math.round(subtotal * 1.05).toDouble()

    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = 14.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmavSecondaryButton(
                        text = "Sync Menu (${menu.size})",
                        icon = Icons.Default.Refresh,
                        enabled = !loading,
                        onClick = onRefresh
                    )
                    SmavSecondaryButton(
                        text = "Orders & Reprint",
                        icon = Icons.Default.ReceiptLong,
                        onClick = onOpenRecentBills
                    )
                    FilterChip(
                        selected = vegOnly,
                        onClick = { vegOnly = !vegOnly },
                        label = { Text("Veg Only", fontWeight = FontWeight.SemiBold) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = SmavColors.StepperGreen,
                            selectedLabelColor = Color.White,
                            containerColor = SmavColors.Surface,
                            labelColor = SmavColors.TextSecondary
                        )
                    )
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Order Mode", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    FilterFlowRow(OrderType.entries, orderType, { it.label }, {
                        orderType = it
                        if (it != OrderType.DINE_IN) selectedTable = it.label else if (!selectedTable.startsWith("Table")) selectedTable = tables.first().tableNumber
                    })
                }
            }

            if (orderType == OrderType.DINE_IN) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Table", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        FilterFlowRow(tables.map { it.tableNumber }, selectedTable, { it }, { selectedTable = it })
                    }
                }
            }

            if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentOrange) }
            if (loadError != null) item { ErrorBannerCard(loadError, onRetry = onRefresh) }
            if (orderError != null) item { ErrorBannerCard(orderError!!) }

            item { SearchField(search, { search = it }, "Search dishes, starters, drinks...") }
            if (categories.size > 1) {
                item { FilterFlowRow(categories, selectedCategory, { it }, { selectedCategory = it }) }
            }

            if (!loading && filteredMenu.isEmpty()) {
                item { EmptyStateCard("No Menu Items Found", "Try another search or refresh the restaurant menu.", Icons.Default.RestaurantMenu) }
            }

            items(filteredMenu, key = { it.id }) { m ->
                val qty = qtyByMenuId[m.id] ?: 0
                SmavItemCard(
                    title = m.name,
                    subtitle = m.category,
                    badgeText = if (m.isVeg) "VEG" else "NON-VEG",
                    badgeColor = if (m.isVeg) SmavColors.StepperGreen else Color(0xFFE11D48),
                    price = m.basePrice,
                    quantity = qty,
                    onIncrement = {
                        if (m.variants.isNotEmpty()) {
                            pendingVariantItem = m
                        } else {
                            val idx = cart.indexOfFirst { it.item.id == m.id && it.selectedVariant == null }
                            cart = if (idx >= 0) {
                                cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                            } else {
                                cart + RestaurantCartItem(m)
                            }
                        }
                    },
                    onDecrement = {
                        val lastIdx = cart.indexOfLast { it.item.id == m.id }
                        if (lastIdx >= 0) {
                            val current = cart[lastIdx]
                            cart = if (current.quantity <= 1) {
                                cart.toMutableList().also { it.removeAt(lastIdx) }
                            } else {
                                cart.toMutableList().also { it[lastIdx] = current.copy(quantity = current.quantity - 1) }
                            }
                        }
                    }
                )
            }
        }

        SmavCheckoutBottomBar(
            countLabel = "${cart.sumOf { it.quantity }} item(s) • $selectedTable",
            totalAmount = estimatedGrandTotal,
            ctaText = "KOT & Bill",
            ctaEnabled = cart.isNotEmpty(),
            ctaIcon = Icons.Default.Kitchen,
            onCtaClick = { showCartSheet = true }
        )
    }

    pendingVariantItem?.let { item ->
        var note by remember { mutableStateOf("") }
        MobileFormDialog(
            title = "Select Portion / Variant",
            onDismiss = { pendingVariantItem = null },
            confirmText = "Cancel",
            onConfirm = { pendingVariantItem = null }
        ) {
            Text(item.name, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            OutlinedTextField(
                value = note,
                onValueChange = { note = it },
                label = { Text("Kitchen Note (optional)") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            item.variants.forEach { variant ->
                SmavSecondaryButton(
                    text = "${variant.name} (Rs. ${String.format(Locale.ENGLISH, "%.0f", item.basePrice + variant.priceDelta)})",
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        cart = cart + RestaurantCartItem(item, variant, 1, note)
                        pendingVariantItem = null
                    }
                )
            }
        }
    }

    if (showCartSheet) {
        MobileFormDialog(
            title = "Send KOT & Print Bill",
            onDismiss = { showCartSheet = false },
            confirmText = "Confirm Order & Print",
            confirmEnabled = cart.isNotEmpty() && !busyOrder,
            isSaving = busyOrder,
            onConfirm = {
                busyOrder = true; orderError = null
                scope.launch {
                    billingRepo.createRestaurantOrder(
                        cartItems = cart,
                        customerName = customerName,
                        customerPhone = customerPhone,
                        tableOrCounter = selectedTable,
                        orderType = orderType.code,
                        paymentMode = paymentMode,
                        branch = branch,
                        specialInstructions = specialInstructions,
                        printKot = true,
                        printCustomerBill = true
                    ).onSuccess { order ->
                        completedOrder = order
                        printFeedback = "Order #${order.tokenNumber} saved offline & KOT/Bill print queued."
                        cart = emptyList()
                        specialInstructions = ""
                        customerName = ""
                        customerPhone = ""
                        showCartSheet = false
                    }.onFailure { err ->
                        orderError = err.message ?: "Failed to create order."
                    }
                    busyOrder = false
                }
            }
        ) {
            cart.forEachIndexed { idx, c ->
                SmavCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                            Text("${c.item.name}${c.selectedVariant?.let { " [${it.name}]" } ?: ""}", color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text(
                                text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", c.subtotal)}",
                                style = SmavNumericStyles.Price,
                                color = SmavColors.StepperGreen
                            )
                        }
                        SmavQuantityStepper(
                            quantity = c.quantity,
                            itemName = c.item.name,
                            onDecrement = {
                                cart = if (c.quantity <= 1) cart.toMutableList().also { it.removeAt(idx) }
                                else cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity - 1) }
                            },
                            onIncrement = {
                                cart = cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                            }
                        )
                    }
                }
            }
            OutlinedTextField(
                value = specialInstructions,
                onValueChange = { specialInstructions = it },
                label = { Text("Kitchen Instructions (optional)") },
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = customerName,
                onValueChange = { customerName = it },
                label = { Text("Customer Name (optional)") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = customerPhone,
                onValueChange = { customerPhone = it },
                label = { Text("Customer Phone (optional)") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            FilterFlowRow(listOf("upi", "cash", "card"), paymentMode, { it.uppercase(Locale.ENGLISH) }, { paymentMode = it })
            SummaryStatCard("Grand Total (incl. 5% GST)", "Rs. ${String.format(Locale.ENGLISH, "%.0f", estimatedGrandTotal)}", accent = SmavColors.StepperGreen)
        }
    }

    completedOrder?.let { ord ->
        AlertDialog(
            onDismissRequest = { completedOrder = null },
            containerColor = SmavColors.Surface,
            title = { Text("Order #${ord.tokenNumber} Created", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Order No: ${ord.orderNumber}", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                    Text("Table/Counter: ${ord.tableOrCounter}", color = SmavColors.TextSecondary)
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.2f", ord.grandTotal)}", style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
                    if (printFeedback != null) Text(printFeedback!!, color = SmavColors.InfoText, fontSize = 12.sp)
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = {
                        scope.launch {
                            val r = billingRepo.reprintRestaurantKot(ord.id)
                            printFeedback = r.fold({ "KOT reprinted." }, { "KOT printer offline: ${it.message}" })
                        }
                    }) { Text("Reprint KOT", color = SmavColors.TextPrimary) }
                    Button(
                        onClick = {
                            scope.launch {
                                val r = billingRepo.reprintRestaurantBill(ord.id, branch)
                                printFeedback = r.fold({ "Bill reprinted." }, { "Bill printer offline: ${it.message}" })
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = SmavColors.AccentPink, contentColor = Color.White)
                    ) { Text("Reprint Bill") }
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers", color = SmavColors.InfoText) }
                    TextButton(onClick = { completedOrder = null }) { Text("Done", color = SmavColors.TextSecondary) }
                }
            }
        )
    }
}

// -------------------------------------------------------------------------------------------------
// 3. RETAIL POS SCREEN
// -------------------------------------------------------------------------------------------------
@Composable
private fun RetailPosScreen(
    session: StaffSession,
    branch: Outlet,
    bundle: PosInitBundle?,
    loading: Boolean,
    loadError: String?,
    onRefresh: () -> Unit,
    billingRepo: BillingRepository,
    onOpenRecentBills: () -> Unit,
    onOpenPrinterSettings: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var search by remember { mutableStateOf("") }
    var selectedCat by remember { mutableStateOf("All") }
    var cart by remember { mutableStateOf<List<RetailCartItem>>(emptyList()) }
    var customerName by remember { mutableStateOf("") }
    var customerPhone by remember { mutableStateOf("") }
    var paymentMode by remember { mutableStateOf("upi") }
    var showCheckout by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var completedBill by remember { mutableStateOf<RetailBillEntity?>(null) }
    var msg by remember { mutableStateOf<String?>(null) }

    val products = bundle?.retailProducts.orEmpty()
    val categories = remember(products) { listOf("All") + products.map { it.category }.filter { it.isNotBlank() }.distinct().sorted() }
    val filtered = remember(products, search, selectedCat) {
        val q = search.trim().lowercase(Locale.ENGLISH)
        products.filter {
            (selectedCat == "All" || it.category == selectedCat) &&
                (q.isBlank() || it.name.lowercase(Locale.ENGLISH).contains(q) || it.sku.lowercase(Locale.ENGLISH).contains(q))
        }
    }
    val qtyByProductId = remember(cart) {
        cart.associate { it.product.id to it.quantity }
    }
    val grandTotal = Math.round(cart.sumOf { it.totalAmount }).toDouble()

    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).padding(horizontal = 14.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmavSecondaryButton(
                        text = "Refresh (${products.size})",
                        icon = Icons.Default.Refresh,
                        enabled = !loading,
                        onClick = onRefresh
                    )
                    SmavSecondaryButton(
                        text = "Recent Bills",
                        icon = Icons.Default.ReceiptLong,
                        onClick = onOpenRecentBills
                    )
                }
            }
            if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
            if (loadError != null) item { ErrorBannerCard(loadError, onRetry = onRefresh) }
            item { SearchField(search, { search = it }, "Search retail products or SKU...") }
            if (categories.size > 1) item { FilterFlowRow(categories, selectedCat, { it }, { selectedCat = it }) }
            if (!loading && filtered.isEmpty()) {
                item { EmptyStateCard("No Products Found", "Add products from Outlet Admin Catalog or check filter.", Icons.Default.ShoppingBag) }
            }
            items(filtered, key = { it.id }) { p ->
                val qty = qtyByProductId[p.id] ?: 0
                SmavItemCard(
                    title = p.name,
                    subtitle = p.category,
                    meta = "Stock: ${p.stockQuantity}",
                    price = p.price,
                    quantity = qty,
                    onIncrement = {
                        val idx = cart.indexOfFirst { it.product.id == p.id }
                        cart = if (idx >= 0) cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                        else cart + RetailCartItem(p)
                    },
                    onDecrement = {
                        val idx = cart.indexOfFirst { it.product.id == p.id }
                        if (idx >= 0) {
                            val current = cart[idx]
                            cart = if (current.quantity <= 1) cart.toMutableList().also { it.removeAt(idx) }
                            else cart.toMutableList().also { it[idx] = current.copy(quantity = current.quantity - 1) }
                        }
                    }
                )
            }
        }

        SmavCheckoutBottomBar(
            countLabel = "${cart.sumOf { it.quantity }} item(s)",
            totalAmount = grandTotal,
            ctaText = "Checkout & Print",
            ctaEnabled = cart.isNotEmpty(),
            ctaIcon = Icons.Default.ShoppingCartCheckout,
            onCtaClick = { showCheckout = true }
        )
    }

    if (showCheckout) {
        MobileFormDialog(
            title = "Complete Retail Bill",
            onDismiss = { showCheckout = false },
            confirmText = "Generate & Print",
            isSaving = busy,
            onConfirm = {
                busy = true
                scope.launch {
                    billingRepo.createRetailBill(cart, customerName, customerPhone, paymentMode, branch, session.userName, true)
                        .onSuccess { b ->
                            completedBill = b
                            msg = "Saved locally on device (cloud retail sync endpoint pending)."
                            cart = emptyList(); customerName = ""; customerPhone = ""; showCheckout = false
                        }
                        .onFailure { msg = it.message }
                    busy = false
                }
            }
        ) {
            OutlinedTextField(
                value = customerName,
                onValueChange = { customerName = it },
                label = { Text("Customer Name (optional)") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = customerPhone,
                onValueChange = { customerPhone = it },
                label = { Text("Phone (optional)") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            FilterFlowRow(listOf("upi", "cash", "card"), paymentMode, { it.uppercase(Locale.ENGLISH) }, { paymentMode = it })
            SummaryStatCard("Total Due", "Rs. ${String.format(Locale.ENGLISH, "%.0f", grandTotal)}", accent = SmavColors.StepperGreen)
        }
    }

    completedBill?.let { b ->
        AlertDialog(
            onDismissRequest = { completedBill = null },
            containerColor = SmavColors.Surface,
            title = { Text("Retail Receipt Saved", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Bill No: ${b.billNumber}", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.2f", b.grandTotal)}", style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
                    if (msg != null) Text(msg!!, color = SmavColors.WarningText, fontSize = 12.sp)
                }
            },
            confirmButton = {
                Button(
                    onClick = { scope.launch { billingRepo.reprintRetailBill(b.id, branch, session.userName) } },
                    colors = ButtonDefaults.buttonColors(containerColor = SmavColors.AccentPink, contentColor = Color.White)
                ) { Text("Reprint") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers", color = SmavColors.InfoText) }
                    TextButton(onClick = { completedBill = null }) { Text("Done", color = SmavColors.TextSecondary) }
                }
            }
        )
    }
}

// -------------------------------------------------------------------------------------------------
// 4. RECENT BILLS & REPRINT SCREEN (BRANCH-ISOLATED)
// -------------------------------------------------------------------------------------------------
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RecentBillsScreen(
    session: StaffSession,
    database: AppDatabase,
    billingRepo: BillingRepository,
    sessionManager: SessionManager
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var feedback by remember { mutableStateOf<String?>(null) }

    val salonBills by database.salonBillDao().getBillsForBranch(session.businessId).collectAsState(initial = emptyList())
    val restOrders by database.restaurantOrderDao().getOrdersForBranch(session.businessId).collectAsState(initial = emptyList())
    val retailBills by database.retailBillDao().getBillsForOutlet(session.businessId).collectAsState(initial = emptyList())

    val branch = remember(session) {
        Outlet(
            id = session.businessId,
            code = session.branchCode.ifBlank { "MAIN" },
            name = session.businessName,
            category = session.businessType.id,
            address = "",
            phone = "",
            gstin = "",
            receiptHeader = sessionManager.getReceiptHeader(session.businessId, session.businessName),
            receiptFooter = sessionManager.getReceiptFooter(session.businessId, "Thank you! Visit us again.")
        )
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (feedback != null) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = SmavColors.InfoBg),
                    border = BorderStroke(1.dp, SmavColors.InfoBorder),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(feedback!!, color = SmavColors.InfoText, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(12.dp))
                }
            }
        }

        when (session.businessType) {
            BusinessType.SALON -> {
                if (salonBills.isEmpty()) {
                    item { EmptyStateCard("No Salon Bills Yet", "Bills generated on this device for ${session.businessName} appear here.") }
                } else {
                    items(salonBills, key = { it.id }) { bill ->
                        SmavCard {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(bill.billNumber, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                                StatusBadgeChip(bill.syncStatus, if (bill.syncStatus == "SYNCED") SmavColors.StepperGreen else SmavColors.WarningText)
                            }
                            Text(
                                "${bill.customerName ?: "Walk-in Guest"} • ${BillIdGenerator.getFormattedDateTime(bill.createdAtLocal)}",
                                color = SmavColors.TextSecondary,
                                fontSize = 12.sp
                            )
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", bill.grandTotal)} (${bill.paymentMode.uppercase(Locale.ENGLISH)})",
                                    style = SmavNumericStyles.Price,
                                    color = SmavColors.StepperGreen
                                )
                                SmavSecondaryButton(
                                    text = "Reprint",
                                    icon = Icons.Default.Print,
                                    onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                                            feedback = r.fold({ "Reprinted ${bill.billNumber}" }, { "Print failed: ${it.message}" })
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            BusinessType.RESTAURANT -> {
                if (restOrders.isEmpty()) {
                    item { EmptyStateCard("No Restaurant Orders Yet", "Orders generated on this device for ${session.businessName} appear here.") }
                } else {
                    items(restOrders, key = { it.id }) { ord ->
                        SmavCard {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${ord.orderNumber} (Token #${ord.tokenNumber})", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                                StatusBadgeChip(ord.syncStatus, if (ord.syncStatus == "SYNCED") SmavColors.StepperGreen else SmavColors.WarningText)
                            }
                            Text("${ord.tableOrCounter} • ${BillIdGenerator.getFormattedDateTime(ord.createdAtLocal)}", color = SmavColors.TextSecondary, fontSize = 12.sp)
                            Text(
                                text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", ord.grandTotal)}",
                                style = SmavNumericStyles.Price,
                                color = SmavColors.StepperGreen
                            )
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                SmavSecondaryButton(
                                    text = "Reprint KOT",
                                    onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRestaurantKot(ord.id)
                                            feedback = r.fold({ "KOT reprinted for ${ord.orderNumber}" }, { "KOT print failed: ${it.message}" })
                                        }
                                    }
                                )
                                SmavSecondaryButton(
                                    text = "Reprint Bill",
                                    onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRestaurantBill(ord.id, branch)
                                            feedback = r.fold({ "Bill reprinted for ${ord.orderNumber}" }, { "Bill print failed: ${it.message}" })
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            BusinessType.RETAIL -> {
                if (retailBills.isEmpty()) {
                    item { EmptyStateCard("No Retail Bills Yet", "Retail receipts generated on this device appear here.") }
                } else {
                    items(retailBills, key = { it.id }) { b ->
                        SmavCard {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(b.billNumber, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                                StatusBadgeChip(b.syncStatus, if (b.syncStatus == "SYNCED") SmavColors.StepperGreen else SmavColors.WarningText)
                            }
                            Text(
                                text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", b.grandTotal)}",
                                style = SmavNumericStyles.Price,
                                color = SmavColors.StepperGreen
                            )
                            SmavSecondaryButton(
                                text = "Reprint Receipt",
                                icon = Icons.Default.Print,
                                onClick = {
                                    scope.launch {
                                        val r = billingRepo.reprintRetailBill(b.id, branch, session.userName)
                                        feedback = r.fold({ "Reprinted ${b.billNumber}" }, { "Print failed: ${it.message}" })
                                    }
                                }
                            )
                        }
                    }
                }
            }

            BusinessType.OTHER -> {
                item { EmptyStateCard("No Active POS Outlet", "Switch to an outlet to inspect local device bills.") }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// 5. SAFE OFFLINE SYNC SCREEN (FOR POS_BILLING & GENERAL USERS)
// -------------------------------------------------------------------------------------------------
@Composable
fun OfflineSyncStatusScreen(
    session: StaffSession,
    pendingSyncCount: Int,
    syncRepo: SyncRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var syncing by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        SummaryStatCard(
            title = "Pending Cloud Sync (${session.businessName})",
            value = "$pendingSyncCount bill(s)",
            subtitle = if (pendingSyncCount == 0) "All offline bills for this outlet are synced." else "Bills stay safe on this device until uploaded.",
            accent = if (pendingSyncCount == 0) SmavColors.StepperGreen else SmavColors.WarningText
        )

        SmavGradientButton(
            text = if (syncing) "Synchronizing..." else "Sync Pending Bills Now",
            icon = Icons.Default.CloudSync,
            enabled = !syncing,
            busy = syncing,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                syncing = true; message = null; errorMsg = null
                scope.launch {
                    syncRepo.syncAllPending()
                        .onSuccess { count ->
                            message = if (count > 0) "Successfully synced $count transaction(s)." else "No pending transactions uploaded."
                        }
                        .onFailure { err ->
                            if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                            else errorMsg = SmavApiClient.friendlyThrowable(err)
                        }
                    syncing = false
                }
            }
        )

        if (message != null) {
            SmavSuccessBannerCard(message!!)
        }
        if (errorMsg != null) ErrorBannerCard(errorMsg!!)
    }
}
