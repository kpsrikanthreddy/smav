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
import com.smav.printagent.data.local.entities.RestaurantOrderItemEntity
import com.smav.printagent.data.local.entities.RetailBillEntity
import com.smav.printagent.data.local.entities.RetailBillItemEntity
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
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
    onUnauthorized: (String) -> Unit,
    onCartSummaryChange: (Int, Double) -> Unit = { _, _ -> },
    openCartSignal: Int = 0
) {
    if (session.businessType == BusinessType.OTHER) {
        LaunchedEffect(Unit) { onCartSummaryChange(0, 0.0) }
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
            onOpenPrinterSettings = onOpenPrinterSettings,
            onCartSummaryChange = onCartSummaryChange,
            openCartSignal = openCartSignal
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
            onOpenPrinterSettings = onOpenPrinterSettings,
            onCartSummaryChange = onCartSummaryChange,
            openCartSignal = openCartSignal
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
            onOpenPrinterSettings = onOpenPrinterSettings,
            onCartSummaryChange = onCartSummaryChange,
            openCartSignal = openCartSignal
        )

        BusinessType.OTHER -> Unit
    }
}

// -------------------------------------------------------------------------------------------------
// 1. SALON POS SCREEN (Implemented in SalonPosRedesign.kt)
// -------------------------------------------------------------------------------------------------

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
    onOpenPrinterSettings: () -> Unit,
    onCartSummaryChange: (Int, Double) -> Unit = { _, _ -> },
    openCartSignal: Int = 0
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
    val cartCount = cart.sumOf { it.quantity }

    LaunchedEffect(cartCount, estimatedGrandTotal) {
        onCartSummaryChange(cartCount, estimatedGrandTotal)
    }
    LaunchedEffect(openCartSignal) {
        if (openCartSignal > 0) showCartSheet = true
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
                        text = "Sync Menu (${menu.size})",
                        icon = Icons.Default.Refresh,
                        enabled = !loading,
                        onClick = onRefresh
                    )
                    SmavSecondaryButton(
                        text = "Today's Ledger",
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
                                printFeedback = r.fold({ "Print Copy sent." }, { "Bill printer offline: ${it.message}" })
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = SmavColors.AccentPink, contentColor = Color.White)
                    ) { Text("Print Copy") }
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers", color = SmavColors.InfoText) }
                    TextButton(onClick = {
                        cart = emptyList()
                        specialInstructions = ""
                        customerName = ""
                        customerPhone = ""
                        completedOrder = null
                        printFeedback = null
                    }) { Text("Clear", color = SmavColors.TextSecondary, fontWeight = FontWeight.SemiBold) }
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
    onOpenPrinterSettings: () -> Unit,
    onCartSummaryChange: (Int, Double) -> Unit = { _, _ -> },
    openCartSignal: Int = 0
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
    val cartCount = cart.sumOf { it.quantity }

    LaunchedEffect(cartCount, grandTotal) {
        onCartSummaryChange(cartCount, grandTotal)
    }
    LaunchedEffect(openCartSignal) {
        if (openCartSignal > 0) showCheckout = true
    }

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
                        text = "Today's Ledger",
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
                ) { Text("Print Copy") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers", color = SmavColors.InfoText) }
                    TextButton(onClick = {
                        cart = emptyList()
                        customerName = ""
                        customerPhone = ""
                        completedBill = null
                        msg = null
                    }) { Text("Clear", color = SmavColors.TextSecondary, fontWeight = FontWeight.SemiBold) }
                }
            }
        )
    }
}

// -------------------------------------------------------------------------------------------------
// 4. TODAY'S TRANSACTION LEDGER (OUTLET-LOCAL TODAY ONLY, NO STATUS COLUMN, ROLE-GATED EDIT/VOID)
// -------------------------------------------------------------------------------------------------
private data class LedgerDetailDialogState(
    val billNumber: String,
    val customerName: String,
    val customerPhone: String,
    val paymentMode: String,
    val amount: Double,
    val dateTime: String,
    val lines: List<LedgerDetailLine>
)

private data class LedgerDetailLine(
    val name: String,
    val quantity: Int,
    val unitPrice: Double,
    val totalAmount: Double,
    val stylistName: String?
)

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
    var errorBanner by remember { mutableStateOf<String?>(null) }
    var detailDialog by remember { mutableStateOf<LedgerDetailDialogState?>(null) }

    val canModify = remember(session.role) { session.role.isAdminOrAbove() }
    val startOfTodayMs = remember(session.businessId) { BillIdGenerator.getStartOfTodayMillis() }

    val salonBills by database.salonBillDao()
        .getTodayActiveBillsForOutlet(session.businessId, startOfTodayMs)
        .collectAsState(initial = emptyList())
    val restOrders by database.restaurantOrderDao()
        .getTodayActiveOrdersForBranch(session.businessId, startOfTodayMs)
        .collectAsState(initial = emptyList())
    val retailBills by database.retailBillDao()
        .getTodayActiveBillsForOutlet(session.businessId, startOfTodayMs)
        .collectAsState(initial = emptyList())

    var salonItemsByBill by remember { mutableStateOf<Map<String, List<SalonBillItemEntity>>>(emptyMap()) }
    var restItemsByOrder by remember { mutableStateOf<Map<String, List<RestaurantOrderItemEntity>>>(emptyMap()) }
    var retailItemsByBill by remember { mutableStateOf<Map<String, List<RetailBillItemEntity>>>(emptyMap()) }

    LaunchedEffect(salonBills) {
        val loaded = mutableMapOf<String, List<SalonBillItemEntity>>()
        salonBills.forEach { bill ->
            loaded[bill.id] = database.salonBillDao().getItemsForBill(bill.id)
        }
        salonItemsByBill = loaded
    }

    LaunchedEffect(restOrders) {
        val loaded = mutableMapOf<String, List<RestaurantOrderItemEntity>>()
        restOrders.forEach { ord ->
            loaded[ord.id] = database.restaurantOrderDao().getItemsForOrder(ord.id)
        }
        restItemsByOrder = loaded
    }

    LaunchedEffect(retailBills) {
        val loaded = mutableMapOf<String, List<RetailBillItemEntity>>()
        retailBills.forEach { b ->
            loaded[b.id] = database.retailBillDao().getItemsForBill(b.id)
        }
        retailItemsByBill = loaded
    }

    // Role-gated Edit & Void dialog state (only reachable by SUPERADMIN / ADMIN / authorized MANAGER)
    var editingSalonBill by remember { mutableStateOf<SalonBillEntity?>(null) }
    var editCustomerName by remember { mutableStateOf("") }
    var editCustomerPhone by remember { mutableStateOf("") }
    var editPaymentMode by remember { mutableStateOf("upi") }
    var editDiscountText by remember { mutableStateOf("0") }
    var editReason by remember { mutableStateOf("") }
    var editItems by remember { mutableStateOf<List<SalonBillItemEntity>>(emptyList()) }
    var editConfirmed by remember { mutableStateOf(false) }
    var editSaving by remember { mutableStateOf(false) }

    var voidTargetId by remember { mutableStateOf<String?>(null) }
    var voidTargetNumber by remember { mutableStateOf("") }
    var voidTargetType by remember { mutableStateOf(BusinessType.SALON) }
    var voidReason by remember { mutableStateOf("") }
    var voidConfirmed by remember { mutableStateOf(false) }
    var voidSaving by remember { mutableStateOf(false) }

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

    if (session.businessType == BusinessType.SALON) {
        SalonBillsReprintScreenContent(
            salonBills = salonBills,
            salonItemsByBill = salonItemsByBill,
            businessName = session.businessName,
            canModify = canModify,
            feedback = feedback,
            errorBanner = errorBanner,
            onReprint = { bill ->
                scope.launch {
                    errorBanner = null
                    val r = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                    feedback = r.fold({ "Printed copy for ${bill.billNumber}" }, { null })
                    if (r.isFailure) errorBanner = "Print failed: ${r.exceptionOrNull()?.message}"
                }
            },
            onEdit = { bill, lineItems ->
                editingSalonBill = bill
                editCustomerName = bill.customerName.orEmpty()
                editCustomerPhone = bill.customerPhone.orEmpty()
                editPaymentMode = bill.paymentMode.lowercase(Locale.ENGLISH)
                editDiscountText = String.format(Locale.ENGLISH, "%.2f", bill.discountAmount)
                editItems = lineItems
                editReason = ""
                editConfirmed = false
            },
            onVoid = { bill ->
                voidTargetId = bill.id
                voidTargetNumber = bill.billNumber
                voidTargetType = BusinessType.SALON
                voidReason = ""
                voidConfirmed = false
            }
        )
    } else {
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            SmavCard {
                Text(
                    text = "Today's Transaction Ledger (${BillIdGenerator.getTodayDateString()})",
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
                Text(
                    text = "Showing today's active bills in outlet-local time (IST). Older bills remain preserved for reports.",
                    color = SmavColors.TextSecondary,
                    fontSize = 12.sp
                )
            }
        }

        if (feedback != null) {
            item { SmavSuccessBannerCard(feedback!!) }
        }
        if (errorBanner != null) {
            item { ErrorBannerCard(errorBanner!!) }
        }

        when (session.businessType) {
            BusinessType.SALON -> Unit

            BusinessType.RESTAURANT -> {
                if (restOrders.isEmpty()) {
                    item { EmptyStateCard("No Orders Today", "Today's active orders for ${session.businessName} appear here.") }
                } else {
                    items(restOrders, key = { it.id }) { ord ->
                        val lineItems = restItemsByOrder[ord.id].orEmpty()
                        val itemSummary = if (lineItems.isEmpty()) "View items" else lineItems.joinToString(", ") { "${it.itemName} ×${it.quantity}" }
                        SmavCard {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${ord.orderNumber} (#${ord.tokenNumber})", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                                Text(
                                    text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", ord.grandTotal)}",
                                    style = SmavNumericStyles.Price,
                                    color = SmavColors.StepperGreen
                                )
                            }
                            Text(
                                text = "Customer: ${ord.customerName ?: ord.tableOrCounter} • Phone: ${ord.customerPhone?.ifBlank { "—" } ?: "—"}",
                                color = SmavColors.TextPrimary,
                                fontSize = 12.sp
                            )
                            Text(
                                text = "Payment: ${ord.paymentMode.uppercase(Locale.ENGLISH)} • ${BillIdGenerator.getFormattedDateTime(ord.createdAtLocal)}",
                                color = SmavColors.TextSecondary,
                                fontSize = 12.sp
                            )
                            TextButton(
                                onClick = {
                                    detailDialog = LedgerDetailDialogState(
                                        billNumber = ord.orderNumber,
                                        customerName = ord.customerName ?: ord.tableOrCounter,
                                        customerPhone = ord.customerPhone ?: "—",
                                        paymentMode = ord.paymentMode.uppercase(Locale.ENGLISH),
                                        amount = ord.grandTotal,
                                        dateTime = BillIdGenerator.getFormattedDateTime(ord.createdAtLocal),
                                        lines = lineItems.map {
                                            LedgerDetailLine(
                                                name = it.itemName + (it.variantName?.let { v -> " [$v]" } ?: ""),
                                                quantity = it.quantity,
                                                unitPrice = it.unitPrice,
                                                totalAmount = it.totalPrice,
                                                stylistName = null
                                            )
                                        }
                                    )
                                },
                                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp)
                            ) {
                                Text("Items (${lineItems.size}): $itemSummary", color = SmavColors.AccentPink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            }
                            if (!ord.conflictMessage.isNullOrBlank()) {
                                SmavWarningBannerCard("Sync conflict: ${ord.conflictMessage}")
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                SmavSecondaryButton(
                                    text = "Print KOT",
                                    onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRestaurantKot(ord.id)
                                            feedback = r.fold({ "KOT printed for ${ord.orderNumber}" }, { "KOT print failed: ${it.message}" })
                                        }
                                    }
                                )
                                SmavSecondaryButton(
                                    text = "Print Copy",
                                    icon = Icons.Default.Print,
                                    onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRestaurantBill(ord.id, branch)
                                            feedback = r.fold({ "Printed copy for ${ord.orderNumber}" }, { "Bill print failed: ${it.message}" })
                                        }
                                    }
                                )
                                if (canModify) {
                                    SmavSecondaryButton(
                                        text = "Void",
                                        icon = Icons.Default.Delete,
                                        onClick = {
                                            voidTargetId = ord.id
                                            voidTargetNumber = ord.orderNumber
                                            voidTargetType = BusinessType.RESTAURANT
                                            voidReason = ""
                                            voidConfirmed = false
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            BusinessType.RETAIL -> {
                if (retailBills.isEmpty()) {
                    item { EmptyStateCard("No Retail Bills Today", "Today's active retail receipts appear here.") }
                } else {
                    items(retailBills, key = { it.id }) { b ->
                        val lineItems = retailItemsByBill[b.id].orEmpty()
                        val itemSummary = if (lineItems.isEmpty()) "View items" else lineItems.joinToString(", ") { "${it.productName} ×${it.quantity}" }
                        SmavCard {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(b.billNumber, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                                Text(
                                    text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", b.grandTotal)}",
                                    style = SmavNumericStyles.Price,
                                    color = SmavColors.StepperGreen
                                )
                            }
                            Text(
                                text = "Customer: ${b.customerName ?: "Walk-in Guest"} • Phone: ${b.customerPhone?.ifBlank { "—" } ?: "—"}",
                                color = SmavColors.TextPrimary,
                                fontSize = 12.sp
                            )
                            Text(
                                text = "Payment: ${b.paymentMode.uppercase(Locale.ENGLISH)} • ${BillIdGenerator.getFormattedDateTime(b.createdAtLocal)}",
                                color = SmavColors.TextSecondary,
                                fontSize = 12.sp
                            )
                            TextButton(
                                onClick = {
                                    detailDialog = LedgerDetailDialogState(
                                        billNumber = b.billNumber,
                                        customerName = b.customerName ?: "Walk-in Guest",
                                        customerPhone = b.customerPhone ?: "—",
                                        paymentMode = b.paymentMode.uppercase(Locale.ENGLISH),
                                        amount = b.grandTotal,
                                        dateTime = BillIdGenerator.getFormattedDateTime(b.createdAtLocal),
                                        lines = lineItems.map {
                                            LedgerDetailLine(
                                                name = it.productName,
                                                quantity = it.quantity,
                                                unitPrice = it.unitPrice,
                                                totalAmount = it.totalAmount,
                                                stylistName = null
                                            )
                                        }
                                    )
                                },
                                contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp)
                            ) {
                                Text("Items (${lineItems.size}): $itemSummary", color = SmavColors.AccentPink, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            }
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                SmavSecondaryButton(
                                    text = "Print Copy",
                                    icon = Icons.Default.Print,
                                    onClick = {
                                        scope.launch {
                                            val r = billingRepo.reprintRetailBill(b.id, branch, session.userName)
                                            feedback = r.fold({ "Printed copy for ${b.billNumber}" }, { "Print failed: ${it.message}" })
                                        }
                                    }
                                )
                                if (canModify) {
                                    SmavSecondaryButton(
                                        text = "Void",
                                        icon = Icons.Default.Delete,
                                        onClick = {
                                            voidTargetId = b.id
                                            voidTargetNumber = b.billNumber
                                            voidTargetType = BusinessType.RETAIL
                                            voidReason = ""
                                            voidConfirmed = false
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            BusinessType.OTHER -> {
                item { EmptyStateCard("No Active POS Outlet", "Switch to an outlet to inspect today's transaction ledger.") }
            }
        }
    }
    }

    // Clickable Services / Items Details Dialog
    detailDialog?.let { detail ->
        AlertDialog(
            onDismissRequest = { detailDialog = null },
            containerColor = SmavColors.Surface,
            title = { Text("Bill Details • ${detail.billNumber}", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${detail.customerName} (${detail.customerPhone})", color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Text("${detail.paymentMode} • ${detail.dateTime}", color = SmavColors.TextSecondary, fontSize = 12.sp)
                    HorizontalDivider(color = SmavColors.Border)
                    detail.lines.forEach { line ->
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(line.name, color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                                Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", line.totalAmount)}", color = SmavColors.StepperGreen, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                            Text(
                                text = "Qty: ${line.quantity} × Rs. ${String.format(Locale.ENGLISH, "%.2f", line.unitPrice)}" +
                                    (line.stylistName?.takeIf { it.isNotBlank() }?.let { " • Stylist: $it" } ?: ""),
                                color = SmavColors.TextSecondary,
                                fontSize = 11.sp
                            )
                        }
                    }
                    HorizontalDivider(color = SmavColors.Border)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Grand Total", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                        Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", detail.amount)}", style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { detailDialog = null }) { Text("Close", color = SmavColors.AccentPink, fontWeight = FontWeight.Bold) }
            }
        )
    }

    // Role-Gated Edit Bill Dialog (SUPERADMIN / ADMIN / Authorized MANAGER only)
    if (canModify && editingSalonBill != null) {
        val target = editingSalonBill!!
        val previewSubtotal = editItems.sumOf { it.unitPrice * it.quantity }
        val previewDiscount = (editDiscountText.toDoubleOrNull() ?: 0.0).coerceIn(0.0, previewSubtotal)
        val previewTaxable = (previewSubtotal - previewDiscount).coerceAtLeast(0.0)
        val previewTax = Math.round(previewTaxable * 0.18 * 100.0) / 100.0
        val previewGrand = Math.round((previewTaxable + previewTax) * 100.0) / 100.0

        MobileFormDialog(
            title = "Edit Bill • ${target.billNumber}",
            onDismiss = { if (!editSaving) editingSalonBill = null },
            confirmText = "Save Audited Edit",
            confirmEnabled = !editSaving && editConfirmed && editReason.trim().length >= 5 && editItems.isNotEmpty(),
            isSaving = editSaving,
            onConfirm = {
                editSaving = true
                errorBanner = null
                scope.launch {
                    val res = billingRepo.editSalonBillOfflineOrOnline(
                        billId = target.id,
                        customerName = editCustomerName,
                        customerPhone = editCustomerPhone,
                        paymentMode = editPaymentMode,
                        discountAmount = previewDiscount,
                        editedItems = editItems,
                        reason = editReason
                    )
                    res.onSuccess { updated ->
                        feedback = "Updated ${updated.billNumber} (Rs. ${String.format(Locale.ENGLISH, "%.2f", updated.grandTotal)})."
                        editingSalonBill = null
                    }.onFailure { err ->
                        errorBanner = err.message ?: "Unable to edit bill."
                    }
                    editSaving = false
                }
            }
        ) {
            OutlinedTextField(
                value = editCustomerName,
                onValueChange = { editCustomerName = it },
                label = { Text("Customer Name") },
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = editCustomerPhone,
                onValueChange = { editCustomerPhone = it },
                label = { Text("Customer Phone") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            Text("Payment Mode", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            FilterFlowRow(
                items = listOf("upi", "cash", "card", "split"),
                selected = editPaymentMode,
                labelOf = { it.uppercase(Locale.ENGLISH) },
                onSelect = { editPaymentMode = it }
            )
            OutlinedTextField(
                value = editDiscountText,
                onValueChange = { editDiscountText = it },
                label = { Text("Discount Amount (Rs.)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )

            editItems.forEachIndexed { idx, line ->
                SmavCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                            Text(line.serviceName, color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text(
                                text = "Rs. ${String.format(Locale.ENGLISH, "%.2f", line.unitPrice)} • Stylist: ${line.stylistName ?: "—"}",
                                color = SmavColors.TextSecondary,
                                fontSize = 11.sp
                            )
                        }
                        SmavQuantityStepper(
                            quantity = line.quantity,
                            itemName = line.serviceName,
                            onDecrement = {
                                if (line.quantity > 1) {
                                    editItems = editItems.toMutableList().also {
                                        it[idx] = line.copy(quantity = line.quantity - 1)
                                    }
                                }
                            },
                            onIncrement = {
                                editItems = editItems.toMutableList().also {
                                    it[idx] = line.copy(quantity = line.quantity + 1)
                                }
                            }
                        )
                    }
                }
            }

            SummaryStatCard(
                title = "Recalculated Total (incl. 18% GST)",
                value = "Rs. ${String.format(Locale.ENGLISH, "%.2f", previewGrand)}",
                subtitle = "Subtotal Rs. ${String.format(Locale.ENGLISH, "%.2f", previewSubtotal)} − Discount Rs. ${String.format(Locale.ENGLISH, "%.2f", previewDiscount)} + GST Rs. ${String.format(Locale.ENGLISH, "%.2f", previewTax)}",
                accent = SmavColors.StepperGreen
            )
            OutlinedTextField(
                value = editReason,
                onValueChange = { editReason = it },
                label = { Text("Audit Reason for Edit * (min 5 chars)") },
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = editConfirmed, onCheckedChange = { editConfirmed = it })
                Text("I confirm this audited bill edit preserves original bill number and history.", color = SmavColors.TextSecondary, fontSize = 12.sp)
            }
        }
    }

    // Role-Gated Audited Void / Soft-Delete Dialog
    if (canModify && voidTargetId != null) {
        MobileFormDialog(
            title = "Void Bill • $voidTargetNumber",
            onDismiss = { if (!voidSaving) voidTargetId = null },
            confirmText = "Confirm Void (Soft-Delete)",
            confirmEnabled = !voidSaving && voidConfirmed && voidReason.trim().length >= 5,
            isSaving = voidSaving,
            onConfirm = {
                voidSaving = true
                errorBanner = null
                val targetId = voidTargetId!!
                scope.launch {
                    val res = when (voidTargetType) {
                        BusinessType.SALON -> billingRepo.voidSalonBillOfflineOrOnline(targetId, voidReason)
                        BusinessType.RESTAURANT -> billingRepo.voidRestaurantOrderOfflineOrOnline(targetId, voidReason)
                        BusinessType.RETAIL -> billingRepo.voidRetailBillOfflineOrOnline(targetId, voidReason)
                        BusinessType.OTHER -> Result.failure(IllegalStateException("Unsupported outlet type"))
                    }
                    res.onSuccess { msgText ->
                        feedback = msgText
                        voidTargetId = null
                    }.onFailure { err ->
                        errorBanner = err.message ?: "Unable to void bill."
                    }
                    voidSaving = false
                }
            }
        ) {
            SmavWarningBannerCard("Audited soft-delete: bill $voidTargetNumber will be removed from today's active ledger and sales totals while preserving audit history.")
            OutlinedTextField(
                value = voidReason,
                onValueChange = { voidReason = it },
                label = { Text("Mandatory Void Reason * (min 5 chars)") },
                colors = smavOutlinedFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = voidConfirmed, onCheckedChange = { voidConfirmed = it })
                Text("I confirm voiding bill $voidTargetNumber with this audit reason.", color = SmavColors.TextSecondary, fontSize = 12.sp)
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
