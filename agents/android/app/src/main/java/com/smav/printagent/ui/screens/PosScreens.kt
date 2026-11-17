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
import androidx.compose.ui.text.style.TextOverflow
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
            Button(
                onClick = onOpenOutletSwitcher,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
            ) {
                Icon(Icons.Default.SwapHoriz, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Choose Authorized Outlet", fontWeight = FontWeight.Bold)
            }
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
    val stylists = remember(bundle?.stylists, session.userId, session.userName) {
        val remote = bundle?.stylists.orEmpty()
        if (remote.isNotEmpty()) remote else listOf(
            Stylist(id = session.userId.ifBlank { "front_desk" }, name = session.userName.ifBlank { "Front Desk" }, specialty = "General")
        )
    }
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
                    OutlinedButton(onClick = onRefresh, enabled = !loading, modifier = Modifier.heightIn(min = 44.dp)) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Sync Catalog (${services.size})")
                    }
                    if (appointments.isNotEmpty()) {
                        OutlinedButton(onClick = { showAppointmentsDialog = true }, modifier = Modifier.heightIn(min = 44.dp)) {
                            Icon(Icons.Default.CalendarToday, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Appointments (${appointments.size})")
                        }
                    }
                    OutlinedButton(onClick = onOpenRecentBills, modifier = Modifier.heightIn(min = 44.dp)) {
                        Icon(Icons.Default.ReceiptLong, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Recent Bills")
                    }
                }
            }

            if (bundle?.fromCache == true) {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = Amber500.copy(alpha = 0.16f))) {
                        Text("Using offline cached catalog (${services.size} services).", color = Amber500, fontSize = 12.sp, modifier = Modifier.padding(10.dp))
                    }
                }
            }

            if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
            if (loadError != null) item { ErrorBannerCard(loadError, onRetry = onRefresh) }
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
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                    border = BorderStroke(1.dp, Color(0xFF252E54)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(srv.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(
                                "${srv.category}${if (srv.subcategory.isNotBlank()) " • ${srv.subcategory}" else ""}",
                                color = Color(0xFF94A3B8),
                                fontSize = 11.sp
                            )
                            Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", srv.price)} (+${srv.gstPercent.toInt()}% GST)", color = Emerald500, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        }
                        Button(
                            onClick = { pendingServiceToPickStylist = srv },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Add")
                        }
                    }
                }
            }
        }

        // Bottom Checkout Bar
        Surface(
            color = Color(0xFF121629),
            tonalElevation = 6.dp,
            border = BorderStroke(1.dp, Color(0xFF2B355F)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("${cart.sumOf { it.quantity }} service(s) in cart", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.0f", grandTotal)}", color = Emerald500, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                }
                Button(
                    onClick = { showCartSheet = true },
                    enabled = cart.isNotEmpty(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Default.ShoppingCartCheckout, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("Review & Bill", fontWeight = FontWeight.Bold)
                }
            }
        }
    }

    pendingServiceToPickStylist?.let { srv ->
        MobileFormDialog(
            title = "Select Stylist",
            onDismiss = { pendingServiceToPickStylist = null },
            confirmText = "Cancel",
            onConfirm = { pendingServiceToPickStylist = null }
        ) {
            Text(srv.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text("Choose stylist for this service:", color = Color(0xFF94A3B8), fontSize = 12.sp)
            stylists.forEach { stylist ->
                Button(
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
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E2646)),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                ) {
                    Text("${stylist.name}${if (stylist.specialty.isNotBlank()) " (${stylist.specialty})" else ""}", color = Color.White)
                }
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
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF181E3B)),
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
                    Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("${appt.customerName} (${appt.customerPhone})", color = Color.White, fontWeight = FontWeight.Bold)
                        Text("${appt.serviceName} • ${appt.appointmentTime}", color = Sky400, fontSize = 12.sp)
                        Text("Tap to load into POS bill", color = Emerald500, fontSize = 11.sp)
                    }
                }
            }
        }
    }

    if (showCartSheet) {
        MobileFormDialog(
            title = "Finalize Salon Bill",
            onDismiss = { showCartSheet = false },
            confirmText = "Generate & Print Bill",
            confirmEnabled = effectiveCart.isNotEmpty() && !busyBilling,
            isSaving = busyBilling,
            onConfirm = {
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
                        shouldPrint = true
                    )
                    res.onSuccess { bill ->
                        completedBill = bill
                        printFeedback = "Saved offline & queued for cloud sync."
                        cart = emptyList()
                        customerName = ""
                        customerPhone = ""
                        discountPercentText = "0"
                        showCartSheet = false
                    }.onFailure { err ->
                        billingError = err.message ?: "Failed to generate bill."
                    }
                    busyBilling = false
                }
            }
        ) {
            effectiveCart.forEachIndexed { idx, item ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF181E3B))) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(item.service.name, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("Stylist: ${item.stylist?.name ?: "Staff"}", color = Sky400, fontSize = 11.sp)
                            Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", item.totalAmount)}", color = Emerald500, fontSize = 12.sp)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = {
                                cart = if (item.quantity <= 1) {
                                    cart.toMutableList().also { it.removeAt(idx) }
                                } else {
                                    cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity - 1) }
                                }
                            }) { Icon(Icons.Default.Remove, contentDescription = "Decrease") }
                            Text("${item.quantity}", color = Color.White, fontWeight = FontWeight.Bold)
                            IconButton(onClick = {
                                cart = cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                            }) { Icon(Icons.Default.Add, contentDescription = "Increase") }
                        }
                    }
                }
            }

            OutlinedTextField(value = customerName, onValueChange = { customerName = it }, label = { Text("Customer Name (Optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = customerPhone,
                onValueChange = { customerPhone = it },
                label = { Text("Customer Phone (Optional)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = discountPercentText,
                onValueChange = { discountPercentText = it },
                label = { Text("Discount (%)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Text("Payment Mode", color = Color(0xFFCBD5E1), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            FilterFlowRow(
                items = listOf("upi", "cash", "card", "split"),
                selected = paymentMode,
                labelOf = { it.uppercase(Locale.ENGLISH) },
                onSelect = { paymentMode = it }
            )
            SummaryStatCard("Net Payable (incl. GST)", "Rs. ${String.format(Locale.ENGLISH, "%.0f", grandTotal)}", accent = Emerald500)
        }
    }

    completedBill?.let { bill ->
        AlertDialog(
            onDismissRequest = { completedBill = null },
            containerColor = Color(0xFF121629),
            title = { Text("Bill Generated", color = Emerald500, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Bill No: ${bill.billNumber}", color = Color.White, fontWeight = FontWeight.Bold)
                    Text("Amount: Rs. ${String.format(Locale.ENGLISH, "%.2f", bill.grandTotal)}", color = Emerald500)
                    Text("Payment: ${bill.paymentMode.uppercase(Locale.ENGLISH)}", color = Color(0xFFCBD5E1))
                    if (printFeedback != null) Text(printFeedback!!, color = Sky400, fontSize = 12.sp)
                }
            },
            confirmButton = {
                Button(onClick = {
                    scope.launch {
                        val res = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                        printFeedback = res.fold(
                            { "Receipt reprinted via Bluetooth." },
                            { "Printer unavailable (${it.message}). Check Printer Settings." }
                        )
                    }
                }) { Text("Reprint") }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers") }
                    TextButton(onClick = { completedBill = null }) { Text("Done") }
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
                    OutlinedButton(onClick = onRefresh, enabled = !loading, modifier = Modifier.heightIn(min = 44.dp)) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Sync Menu (${menu.size})")
                    }
                    OutlinedButton(onClick = onOpenRecentBills, modifier = Modifier.heightIn(min = 44.dp)) {
                        Icon(Icons.Default.ReceiptLong, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Orders & Reprint")
                    }
                    FilterChip(
                        selected = vegOnly,
                        onClick = { vegOnly = !vegOnly },
                        label = { Text("Veg Only") }
                    )
                }
            }

            item {
                Text("Order Mode", color = Color(0xFFCBD5E1), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                FilterFlowRow(OrderType.entries, orderType, { it.label }, {
                    orderType = it
                    if (it != OrderType.DINE_IN) selectedTable = it.label else if (!selectedTable.startsWith("Table")) selectedTable = tables.first().tableNumber
                })
            }

            if (orderType == OrderType.DINE_IN) {
                item {
                    Text("Table", color = Color(0xFFCBD5E1), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    FilterFlowRow(tables.map { it.tableNumber }, selectedTable, { it }, { selectedTable = it })
                }
            }

            if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Amber500) }
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
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                    border = BorderStroke(1.dp, Color(0xFF252E54)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                StatusBadgeChip(
                                    text = if (m.isVeg) "VEG" else "NON-VEG",
                                    color = if (m.isVeg) Emerald500 else Rose600
                                )
                                Text(m.category, color = Color(0xFF94A3B8), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(m.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
                            Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", m.basePrice)}", color = Amber500, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                        Button(
                            onClick = {
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
                            colors = ButtonDefaults.buttonColors(containerColor = Amber500, contentColor = Color.Black),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Add", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        Surface(
            color = Color(0xFF121629),
            border = BorderStroke(1.dp, Color(0xFF2B355F)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("${cart.sumOf { it.quantity }} item(s) • $selectedTable", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.0f", estimatedGrandTotal)}", color = Amber500, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                }
                Button(
                    onClick = { showCartSheet = true },
                    enabled = cart.isNotEmpty(),
                    colors = ButtonDefaults.buttonColors(containerColor = Amber500, contentColor = Color.Black),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Default.Kitchen, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("KOT & Bill", fontWeight = FontWeight.Bold)
                }
            }
        }
    }

    pendingVariantItem?.let { item ->
        var note by remember { mutableStateOf("") }
        MobileFormDialog(
            title = "Select Portion / Variant",
            onDismiss = { pendingVariantItem = null },
            confirmText = "Cancel",
            onConfirm = { pendingVariantItem = null }
        ) {
            Text(item.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("Kitchen Note (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            item.variants.forEach { variant ->
                Button(
                    onClick = {
                        cart = cart + RestaurantCartItem(item, variant, 1, note)
                        pendingVariantItem = null
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                ) {
                    Text("${variant.name} (Rs. ${String.format(Locale.ENGLISH, "%.0f", item.basePrice + variant.priceDelta)})")
                }
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
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF181E3B))) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(10.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("${c.item.name}${c.selectedVariant?.let { " [${it.name}]" } ?: ""}", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", c.subtotal)}", color = Amber500, fontSize = 12.sp)
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = {
                                cart = if (c.quantity <= 1) cart.toMutableList().also { it.removeAt(idx) }
                                else cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity - 1) }
                            }) { Icon(Icons.Default.Remove, contentDescription = "Decrease") }
                            Text("${c.quantity}", color = Color.White, fontWeight = FontWeight.Bold)
                            IconButton(onClick = {
                                cart = cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                            }) { Icon(Icons.Default.Add, contentDescription = "Increase") }
                        }
                    }
                }
            }
            OutlinedTextField(value = specialInstructions, onValueChange = { specialInstructions = it }, label = { Text("Kitchen Instructions (optional)") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = customerName, onValueChange = { customerName = it }, label = { Text("Customer Name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = customerPhone, onValueChange = { customerPhone = it }, label = { Text("Customer Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FilterFlowRow(listOf("upi", "cash", "card"), paymentMode, { it.uppercase(Locale.ENGLISH) }, { paymentMode = it })
            SummaryStatCard("Grand Total (incl. 5% GST)", "Rs. ${String.format(Locale.ENGLISH, "%.0f", estimatedGrandTotal)}", accent = Amber500)
        }
    }

    completedOrder?.let { ord ->
        AlertDialog(
            onDismissRequest = { completedOrder = null },
            containerColor = Color(0xFF121629),
            title = { Text("Order #${ord.tokenNumber} Created", color = Amber500, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Order No: ${ord.orderNumber}", color = Color.White, fontWeight = FontWeight.Bold)
                    Text("Table/Counter: ${ord.tableOrCounter}", color = Color(0xFFCBD5E1))
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.2f", ord.grandTotal)}", color = Emerald500)
                    if (printFeedback != null) Text(printFeedback!!, color = Sky400, fontSize = 12.sp)
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(onClick = {
                        scope.launch {
                            val r = billingRepo.reprintRestaurantKot(ord.id)
                            printFeedback = r.fold({ "KOT reprinted." }, { "KOT printer offline: ${it.message}" })
                        }
                    }) { Text("Reprint KOT") }
                    Button(onClick = {
                        scope.launch {
                            val r = billingRepo.reprintRestaurantBill(ord.id, branch)
                            printFeedback = r.fold({ "Bill reprinted." }, { "Bill printer offline: ${it.message}" })
                        }
                    }) { Text("Reprint Bill") }
                }
            },
            dismissButton = {
                TextButton(onClick = { completedOrder = null }) { Text("Done") }
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
                    OutlinedButton(onClick = onRefresh, enabled = !loading, modifier = Modifier.heightIn(min = 44.dp)) {
                        Text("Refresh (${products.size})")
                    }
                    OutlinedButton(onClick = onOpenRecentBills, modifier = Modifier.heightIn(min = 44.dp)) {
                        Text("Recent Bills")
                    }
                }
            }
            if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
            if (loadError != null) item { ErrorBannerCard(loadError, onRetry = onRefresh) }
            item { SearchField(search, { search = it }, "Search retail products or SKU...") }
            if (categories.size > 1) item { FilterFlowRow(categories, selectedCat, { it }, { selectedCat = it }) }
            if (!loading && filtered.isEmpty()) {
                item { EmptyStateCard("No Products Found", "Add products from Outlet Admin Catalog or check filter.", Icons.Default.ShoppingBag) }
            }
            items(filtered, key = { it.id }) { p ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)), border = BorderStroke(1.dp, Color(0xFF252E54))) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(p.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text("${p.category} • Stock: ${p.stockQuantity}", color = Color(0xFF94A3B8), fontSize = 11.sp)
                            Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", p.price)}", color = Sky400, fontWeight = FontWeight.Bold)
                        }
                        Button(
                            onClick = {
                                val idx = cart.indexOfFirst { it.product.id == p.id }
                                cart = if (idx >= 0) cart.toMutableList().also { it[idx] = it[idx].copy(quantity = it[idx].quantity + 1) }
                                else cart + RetailCartItem(p)
                            },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) { Text("Add") }
                    }
                }
            }
        }

        Surface(color = Color(0xFF121629), border = BorderStroke(1.dp, Color(0xFF2B355F)), modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("${cart.sumOf { it.quantity }} item(s)", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.0f", grandTotal)}", color = Sky400, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                }
                Button(
                    onClick = { showCheckout = true },
                    enabled = cart.isNotEmpty(),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text("Checkout & Print") }
            }
        }
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
            OutlinedTextField(value = customerName, onValueChange = { customerName = it }, label = { Text("Customer Name (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = customerPhone, onValueChange = { customerPhone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FilterFlowRow(listOf("upi", "cash", "card"), paymentMode, { it.uppercase(Locale.ENGLISH) }, { paymentMode = it })
            SummaryStatCard("Total Due", "Rs. ${String.format(Locale.ENGLISH, "%.0f", grandTotal)}", accent = Sky400)
        }
    }

    completedBill?.let { b ->
        AlertDialog(
            onDismissRequest = { completedBill = null },
            containerColor = Color(0xFF121629),
            title = { Text("Retail Receipt Saved", color = Sky400, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Bill No: ${b.billNumber}", color = Color.White, fontWeight = FontWeight.Bold)
                    Text("Total: Rs. ${String.format(Locale.ENGLISH, "%.2f", b.grandTotal)}", color = Emerald500)
                    if (msg != null) Text(msg!!, color = Amber500, fontSize = 12.sp)
                }
            },
            confirmButton = {
                Button(onClick = {
                    scope.launch { billingRepo.reprintRetailBill(b.id, branch, session.userName) }
                }) { Text("Reprint") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers") }
                    TextButton(onClick = { completedBill = null }) { Text("Done") }
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
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF161D3B))) {
                    Text(feedback!!, color = Sky400, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }

        when (session.businessType) {
            BusinessType.SALON -> {
                if (salonBills.isEmpty()) {
                    item { EmptyStateCard("No Salon Bills Yet", "Bills generated on this device for ${session.businessName} appear here.") }
                } else {
                    items(salonBills, key = { it.id }) { bill ->
                        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)), border = BorderStroke(1.dp, Color(0xFF252E54))) {
                            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(bill.billNumber, color = Color.White, fontWeight = FontWeight.Bold)
                                    StatusBadgeChip(bill.syncStatus, if (bill.syncStatus == "SYNCED") Emerald500 else Amber500)
                                }
                                Text(
                                    "${bill.customerName ?: "Walk-in Guest"} • ${BillIdGenerator.getFormattedDateTime(bill.createdAtLocal)}",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 12.sp
                                )
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", bill.grandTotal)} (${bill.paymentMode.uppercase(Locale.ENGLISH)})", color = Emerald500, fontWeight = FontWeight.Bold)
                                    OutlinedButton(onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                                            feedback = r.fold({ "Reprinted ${bill.billNumber}" }, { "Print failed: ${it.message}" })
                                        }
                                    }, modifier = Modifier.heightIn(min = 44.dp)) {
                                        Icon(Icons.Default.Print, contentDescription = null, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text("Reprint")
                                    }
                                }
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
                        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)), border = BorderStroke(1.dp, Color(0xFF252E54))) {
                            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("${ord.orderNumber} (Token #${ord.tokenNumber})", color = Color.White, fontWeight = FontWeight.Bold)
                                    StatusBadgeChip(ord.syncStatus, if (ord.syncStatus == "SYNCED") Emerald500 else Amber500)
                                }
                                Text("${ord.tableOrCounter} • ${BillIdGenerator.getFormattedDateTime(ord.createdAtLocal)}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                                Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", ord.grandTotal)}", color = Amber500, fontWeight = FontWeight.Bold)
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRestaurantKot(ord.id)
                                            feedback = r.fold({ "KOT reprinted for ${ord.orderNumber}" }, { "KOT print failed: ${it.message}" })
                                        }
                                    }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Reprint KOT") }
                                    OutlinedButton(onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRestaurantBill(ord.id, branch)
                                            feedback = r.fold({ "Bill reprinted for ${ord.orderNumber}" }, { "Bill print failed: ${it.message}" })
                                        }
                                    }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Reprint Bill") }
                                }
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
                        Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)), border = BorderStroke(1.dp, Color(0xFF252E54))) {
                            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(b.billNumber, color = Color.White, fontWeight = FontWeight.Bold)
                                    StatusBadgeChip(b.syncStatus, if (b.syncStatus == "SYNCED") Emerald500 else Amber500)
                                }
                                Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", b.grandTotal)}", color = Sky400, fontWeight = FontWeight.Bold)
                                OutlinedButton(onClick = {
                                    scope.launch {
                                        val r = billingRepo.reprintRetailBill(b.id, branch, session.userName)
                                        feedback = r.fold({ "Reprinted ${b.billNumber}" }, { "Print failed: ${it.message}" })
                                    }
                                }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Reprint Receipt") }
                            }
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
            accent = if (pendingSyncCount == 0) Emerald500 else Amber500
        )

        Button(
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
            },
            enabled = !syncing,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
            modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)
        ) {
            Icon(Icons.Default.CloudSync, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(if (syncing) "Synchronizing..." else "Sync Pending Bills Now", fontWeight = FontWeight.Bold)
        }

        if (syncing) LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82))
        if (message != null) {
            Card(colors = CardDefaults.cardColors(containerColor = Emerald500.copy(alpha = 0.16f))) {
                Text(message!!, color = Emerald500, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
            }
        }
        if (errorMsg != null) ErrorBannerCard(errorMsg!!)
    }
}
