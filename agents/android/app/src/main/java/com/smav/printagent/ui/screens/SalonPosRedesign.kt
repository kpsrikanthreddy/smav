package com.smav.printagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.smav.printagent.data.local.entities.SalonBillEntity
import com.smav.printagent.data.local.entities.SalonBillItemEntity
import com.smav.printagent.data.repository.BillingRepository
import com.smav.printagent.data.repository.PosInitBundle
import com.smav.printagent.model.*
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.*
import com.smav.printagent.util.BillIdGenerator
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID

private val ServiceCardTints = listOf(
    Color(0xFFFFF5F8),
    Color(0xFFFFF8EC),
    Color(0xFFF2FBF6),
    Color(0xFFF4F7FF)
)

@Composable
internal fun SalonPosScreen(
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
    val menuListState = rememberLazyListState()
    val cartListState = rememberLazyListState()

    var activeTab by remember { mutableStateOf(SalonPosTab.MENU) }
    var search by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("All") }
    var expandedSubcategories by remember { mutableStateOf<Map<String, Boolean>>(emptyMap()) }

    var cartLines by remember { mutableStateOf<List<SalonCartLine>>(emptyList()) }
    var customerName by remember { mutableStateOf("") }
    var customerPhone by remember { mutableStateOf("") }
    var discountPercentText by remember { mutableStateOf("0") }
    var paymentMode by remember { mutableStateOf("upi") }

    // Branch is ALWAYS blank by default and never auto-selected.
    var selectedBranch by remember(branch.id) { mutableStateOf<BranchOption?>(null) }

    var stylistPickerLineId by remember { mutableStateOf<String?>(null) }
    var highlightedMissingStylistLineId by remember { mutableStateOf<String?>(null) }
    var stylistValidationMessage by remember { mutableStateOf<String?>(null) }
    var noticeMessage by remember { mutableStateOf<String?>(null) }

    var showAppointmentsDialog by remember { mutableStateOf(false) }
    var showFinalizeDialog by remember { mutableStateOf(false) }

    var busyBilling by remember { mutableStateOf(false) }
    var billingError by remember { mutableStateOf<String?>(null) }
    var completedBill by remember { mutableStateOf<SalonBillEntity?>(null) }
    var printFeedback by remember { mutableStateOf<String?>(null) }
    var checkoutAttemptFingerprint by remember(branch.id) { mutableStateOf<String?>(null) }
    var checkoutAttemptId by remember(branch.id) { mutableStateOf(UUID.randomUUID().toString()) }

    val services = bundle?.salonServices.orEmpty()
    val stylists = bundle?.stylists.orEmpty()
    val permittedBranches = remember(bundle?.branches) {
        bundle?.branches.orEmpty().filter { it.isActive }
    }
    val isBillingBlocked = bundle != null && !loading && (bundle.billingBlocked || permittedBranches.isEmpty())
    val branchAuthMessage = bundle?.branchAuthorizationMessage
        ?: "No active branch is assigned to your account. Contact an administrator before billing."

    // Clear selectedBranch only if it is no longer among active permitted branches. Never auto-select.
    LaunchedEffect(permittedBranches, isBillingBlocked) {
        if (isBillingBlocked) {
            selectedBranch = null
        } else if (selectedBranch != null && permittedBranches.none { it.id == selectedBranch?.id }) {
            selectedBranch = null
        }
    }

    val stylistWarning = bundle?.stylistWarning
        ?: if (!loading && bundle != null && stylists.isEmpty()) {
            "No active stylists returned for this outlet. Tap Retry to reload."
        } else null
    val appointments = bundle?.appointments.orEmpty()

    val categories = remember(services) { buildSalonCategories(services) }

    LaunchedEffect(categories) {
        if (categories.none { it.equals(selectedCategory, ignoreCase = true) }) {
            selectedCategory = "All"
        }
    }

    val subcategoryGroups = remember(services, selectedCategory, search) {
        filterAndGroupSalonServices(
            services = services,
            selectedCategory = selectedCategory,
            searchQuery = search
        )
    }
    val defaultExpandedSubcategory = remember(subcategoryGroups) {
        subcategoryGroups.firstOrNull()?.subcategory
    }

    val qtyByServiceId = remember(cartLines) {
        cartLines.groupBy { it.item.service.id }.mapValues { (_, lines) -> lines.sumOf { it.item.quantity } }
    }
    val stylistsByServiceId = remember(cartLines) {
        cartLines.groupBy { it.item.service.id }.mapValues { (_, lines) ->
            lines.mapNotNull { it.item.stylist?.name?.takeIf { n -> n.isNotBlank() } }
                .map(::formatSalonStaffName)
                .distinct()
                .joinToString(", ")
        }
    }
    val missingStylistServiceIds = remember(cartLines) {
        cartLines
            .filter { it.item.stylist == null || it.item.stylist.id.isBlank() }
            .map { it.item.service.id }
            .toSet()
    }

    val discountPct = (discountPercentText.toDoubleOrNull() ?: 0.0).coerceIn(0.0, 100.0)
    val effectiveCart = remember(cartLines, discountPct) {
        cartLines.map { it.item.copy(discountPercent = discountPct) }
    }
    val subtotalAmount = remember(effectiveCart) { effectiveCart.sumOf { it.subtotal } }
    val totalGstAmount = remember(effectiveCart) { effectiveCart.sumOf { it.gstAmount } }
    val grandTotal = remember(effectiveCart) {
        Math.round(effectiveCart.sumOf { it.totalAmount }).toDouble()
    }
    val cartCount = remember(cartLines) { cartLines.sumOf { it.item.quantity } }

    LaunchedEffect(cartCount, grandTotal) {
        onCartSummaryChange(cartCount, grandTotal)
    }

    LaunchedEffect(noticeMessage) {
        if (noticeMessage != null) {
            delay(3500)
            noticeMessage = null
        }
    }

    fun showEmptyCartAndReturnToMenu() {
        activeTab = SalonPosTab.MENU
        showFinalizeDialog = false
        stylistValidationMessage = null
        highlightedMissingStylistLineId = null
        noticeMessage = EMPTY_CART_MESSAGE
    }

    // Top bar cart button signal
    LaunchedEffect(openCartSignal) {
        if (openCartSignal > 0) {
            if (cartLines.isEmpty()) {
                showEmptyCartAndReturnToMenu()
            } else {
                activeTab = SalonPosTab.CART
            }
        }
    }

    // If cart becomes empty while viewing Cart, automatically return to Menu with empty notice.
    LaunchedEffect(cartLines.isEmpty(), activeTab) {
        if (cartLines.isEmpty() && activeTab == SalonPosTab.CART) {
            showEmptyCartAndReturnToMenu()
        }
    }

    fun openReviewAndPrint() {
        if (cartLines.isEmpty()) {
            showEmptyCartAndReturnToMenu()
            return
        }
        val missingLine = findFirstMissingStylistLine(cartLines)
        if (missingLine != null) {
            highlightedMissingStylistLineId = missingLine.lineId
            stylistValidationMessage = "Select a stylist for ${missingLine.item.service.name} before Review & Print."
            activeTab = SalonPosTab.CART
            val targetIdx = cartLines.indexOfFirst { it.lineId == missingLine.lineId }
            if (targetIdx >= 0) {
                scope.launch {
                    cartListState.animateScrollToItem(targetIdx)
                }
            }
            return
        }
        highlightedMissingStylistLineId = null
        stylistValidationMessage = null
        billingError = null
        showFinalizeDialog = true
    }

    fun addOrIncrementService(srv: SalonService) {
        if (stylists.isEmpty()) {
            billingError = stylistWarning ?: "No active stylists available. Tap Retry to load stylists."
            return
        }
        billingError = null
        noticeMessage = null
        val existingIdx = cartLines.indexOfLast { it.item.service.id == srv.id }
        if (existingIdx >= 0) {
            val existing = cartLines[existingIdx]
            cartLines = cartLines.toMutableList().also { list ->
                list[existingIdx] = existing.copy(item = existing.item.copy(quantity = existing.item.quantity + 1))
            }
            if (existing.item.stylist == null || existing.item.stylist.id.isBlank()) {
                stylistPickerLineId = existing.lineId
            }
        } else {
            val newLine = SalonCartLine(
                lineId = UUID.randomUUID().toString(),
                item = SalonCartItem(service = srv, stylist = null, quantity = 1)
            )
            cartLines = cartLines + newLine
            stylistPickerLineId = newLine.lineId
        }
    }

    fun decrementService(srvId: String) {
        val lastIdx = cartLines.indexOfLast { it.item.service.id == srvId }
        if (lastIdx >= 0) {
            val target = cartLines[lastIdx]
            cartLines = if (target.item.quantity <= 1) {
                cartLines.toMutableList().also { it.removeAt(lastIdx) }
            } else {
                cartLines.toMutableList().also { list ->
                    list[lastIdx] = target.copy(item = target.item.copy(quantity = target.item.quantity - 1))
                }
            }
            if (cartLines.none { it.lineId == highlightedMissingStylistLineId }) {
                highlightedMissingStylistLineId = null
                stylistValidationMessage = null
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(SmavColors.Background)) {
        // 1. STICKY HEADER AREA (Menu tab shows sticky search + ordered categories without Spa)
        if (activeTab == SalonPosTab.MENU) {
            Surface(
                color = SmavColors.Surface,
                shadowElevation = 2.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedTextField(
                            value = search,
                            onValueChange = { search = it },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            leadingIcon = {
                                Icon(
                                    Icons.Default.Search,
                                    contentDescription = null,
                                    tint = SmavColors.TextMuted,
                                    modifier = Modifier.size(20.dp)
                                )
                            },
                            trailingIcon = if (search.isNotEmpty()) {
                                {
                                    IconButton(onClick = { search = "" }) {
                                        Icon(
                                            Icons.Default.Close,
                                            contentDescription = "Clear search",
                                            tint = SmavColors.TextSecondary,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            } else null,
                            placeholder = {
                                Text(
                                    "Search service or subcategory...",
                                    color = SmavColors.TextMuted,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            },
                            shape = RoundedCornerShape(12.dp),
                            colors = smavOutlinedFieldColors()
                        )

                        if (appointments.isNotEmpty()) {
                            Surface(
                                color = SmavColors.SurfaceSubtle,
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, SmavColors.Border),
                                modifier = Modifier
                                    .size(50.dp)
                                    .clickable { showAppointmentsDialog = true }
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        Icons.Default.CalendarToday,
                                        contentDescription = "Appointments",
                                        tint = SmavColors.TextPrimary,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Box(
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(5.dp)
                                            .size(16.dp)
                                            .clip(CircleShape)
                                            .background(SmavColors.AccentPink),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(
                                            text = "${appointments.size}",
                                            color = Color.White,
                                            fontSize = 9.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                            }
                        }
                    }

                    if (categories.size > 1) {
                        LazyRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(categories, key = { it }) { cat ->
                                val isSelected = selectedCategory.equals(cat, ignoreCase = true)
                                Surface(
                                    onClick = { selectedCategory = cat },
                                    shape = RoundedCornerShape(10.dp),
                                    color = if (isSelected) SmavColors.TextPrimary else SmavColors.Surface,
                                    border = BorderStroke(
                                        1.dp,
                                        if (isSelected) SmavColors.TextPrimary else SmavColors.Border
                                    )
                                ) {
                                    Text(
                                        text = cat,
                                        color = if (isSelected) Color.White else SmavColors.TextPrimary,
                                        fontSize = 13.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                        maxLines = 1,
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
            HorizontalDivider(color = SmavColors.Border)
        }

        if (loading) {
            LinearProgressIndicator(
                modifier = Modifier.fillMaxWidth(),
                color = SmavColors.AccentPink
            )
        }

        // Transient banners (empty cart notice, validation, errors)
        noticeMessage?.let { msg ->
            Surface(
                color = SmavColors.WarningBg,
                border = BorderStroke(1.dp, SmavColors.WarningBorder),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = SmavColors.WarningText,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = msg,
                        color = SmavColors.WarningText,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        stylistValidationMessage?.let { msg ->
            Surface(
                color = SmavColors.DangerBg,
                border = BorderStroke(1.dp, SmavColors.DangerBorder),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.Warning,
                        contentDescription = null,
                        tint = SmavColors.DangerText,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = msg,
                        color = SmavColors.DangerText,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        // 2. MAIN CONTENT AREA (MENU or SELECTED SERVICES / CART)
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (activeTab) {
                SalonPosTab.MENU -> {
                    LazyColumn(
                        state = menuListState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (isBillingBlocked) {
                            item(key = "billing_blocked") {
                                ErrorBannerCard(branchAuthMessage, onRetry = onRefresh)
                            }
                        }
                        if (loadError != null) {
                            item(key = "load_error") {
                                ErrorBannerCard(loadError, onRetry = onRefresh)
                            }
                        }
                        if (stylistWarning != null) {
                            item(key = "stylist_warning") {
                                ErrorBannerCard(stylistWarning, onRetry = onRefresh)
                            }
                        }
                        if (billingError != null) {
                            item(key = "billing_error") {
                                ErrorBannerCard(billingError!!)
                            }
                        }

                        if (!loading && subcategoryGroups.isEmpty()) {
                            item(key = "empty_services") {
                                EmptyStateCard(
                                    title = "No Services Found",
                                    subtitle = "Try a different service name or subcategory search.",
                                    icon = Icons.Default.ContentCut
                                )
                            }
                        } else {
                            subcategoryGroups.forEachIndexed { groupIdx, group ->
                                val expanded = isSubcategoryExpanded(
                                    subcategory = group.subcategory,
                                    expandedState = expandedSubcategories,
                                    searchQuery = search,
                                    defaultExpandedSubcategory = defaultExpandedSubcategory
                                )

                                item(key = "header_${group.subcategory}") {
                                    Surface(
                                        color = SmavColors.Surface,
                                        shape = RoundedCornerShape(10.dp),
                                        border = BorderStroke(1.dp, SmavColors.Border),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                if (search.isBlank()) {
                                                    expandedSubcategories = expandedSubcategories.toMutableMap().apply {
                                                        put(group.subcategory, !expanded)
                                                    }
                                                }
                                            }
                                    ) {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(horizontal = 12.dp, vertical = 10.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                                modifier = Modifier.weight(1f)
                                            ) {
                                                Text(
                                                    text = group.subcategory,
                                                    color = SmavColors.TextPrimary,
                                                    fontSize = 14.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                Text(
                                                    text = "(${group.services.size})",
                                                    color = SmavColors.TextSecondary,
                                                    fontSize = 12.sp,
                                                    fontWeight = FontWeight.Medium
                                                )
                                            }
                                            Icon(
                                                imageVector = if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                                                contentDescription = if (expanded) "Collapse" else "Expand",
                                                tint = SmavColors.TextSecondary
                                            )
                                        }
                                    }
                                }

                                if (expanded) {
                                    val serviceRows = group.services.chunked(2)
                                    itemsIndexed(
                                        items = serviceRows,
                                        key = { rowIdx, row -> "row_${group.subcategory}_${rowIdx}_${row.first().id}" }
                                    ) { rowIdx, rowServices ->
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                                        ) {
                                            rowServices.forEachIndexed { colIdx, srv ->
                                                val qty = qtyByServiceId[srv.id] ?: 0
                                                val assignedStylists = stylistsByServiceId[srv.id].orEmpty()
                                                val missingStylist = srv.id in missingStylistServiceIds
                                                val tintColor = ServiceCardTints[(groupIdx + rowIdx + colIdx) % ServiceCardTints.size]

                                                SalonServiceGridCard(
                                                    service = srv,
                                                    quantity = qty,
                                                    selectedStylistLabel = assignedStylists,
                                                    missingStylist = missingStylist,
                                                    tintColor = tintColor,
                                                    enabled = !loading && stylists.isNotEmpty(),
                                                    onAddOrIncrement = { addOrIncrementService(srv) },
                                                    onDecrement = { decrementService(srv.id) },
                                                    onPickStylist = {
                                                        val targetLine = cartLines.lastOrNull { it.item.service.id == srv.id }
                                                        if (targetLine != null) {
                                                            stylistPickerLineId = targetLine.lineId
                                                        }
                                                    },
                                                    modifier = Modifier.weight(1f)
                                                )
                                            }
                                            if (rowServices.size == 1) {
                                                Spacer(modifier = Modifier.weight(1f))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                SalonPosTab.CART -> {
                    LazyColumn(
                        state = cartListState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        item(key = "cart_header") {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Selected Services ($cartCount)",
                                    color = SmavColors.TextPrimary,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "Subtotal: ${formatSalonRupee(subtotalAmount)}",
                                    color = SmavColors.StepperGreen,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        items(cartLines, key = { it.lineId }) { line ->
                            val hasStylist = line.item.stylist != null && line.item.stylist.id.isNotBlank()
                            val isHighlightedMissing = !hasStylist &&
                                (highlightedMissingStylistLineId == line.lineId || stylistValidationMessage != null)
                            val lineTotal = line.item.copy(discountPercent = discountPct).totalAmount

                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(
                                    containerColor = if (isHighlightedMissing) SmavColors.DangerBg else SmavColors.Surface
                                ),
                                border = BorderStroke(
                                    width = if (isHighlightedMissing) 1.8.dp else 1.dp,
                                    color = if (isHighlightedMissing) SmavColors.DangerText else SmavColors.Border
                                ),
                                shape = RoundedCornerShape(14.dp)
                            ) {
                                Column(
                                    modifier = Modifier.padding(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.Top
                                    ) {
                                        Column(
                                            modifier = Modifier
                                                .weight(1f)
                                                .padding(end = 8.dp),
                                            verticalArrangement = Arrangement.spacedBy(2.dp)
                                        ) {
                                            Text(
                                                text = line.item.service.name,
                                                color = SmavColors.TextPrimary,
                                                fontSize = 14.sp,
                                                fontWeight = FontWeight.Bold,
                                                maxLines = 2,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Text(
                                                text = "${formatSalonRupee(line.item.unitPrice)} × ${line.item.quantity} (+${line.item.service.gstPercent.toInt()}% GST)",
                                                color = SmavColors.TextSecondary,
                                                fontSize = 11.sp
                                            )
                                            Text(
                                                text = formatSalonRupee(lineTotal),
                                                style = SmavNumericStyles.Price,
                                                color = SmavColors.StepperGreen
                                            )
                                        }

                                        SmavQuantityStepper(
                                            quantity = line.item.quantity,
                                            itemName = line.item.service.name,
                                            onDecrement = {
                                                val idx = cartLines.indexOfFirst { it.lineId == line.lineId }
                                                if (idx >= 0) {
                                                    cartLines = if (line.item.quantity <= 1) {
                                                        cartLines.toMutableList().also { it.removeAt(idx) }
                                                    } else {
                                                        cartLines.toMutableList().also {
                                                            it[idx] = line.copy(item = line.item.copy(quantity = line.item.quantity - 1))
                                                        }
                                                    }
                                                }
                                            },
                                            onIncrement = {
                                                val idx = cartLines.indexOfFirst { it.lineId == line.lineId }
                                                if (idx >= 0) {
                                                    cartLines = cartLines.toMutableList().also {
                                                        it[idx] = line.copy(item = line.item.copy(quantity = line.item.quantity + 1))
                                                    }
                                                }
                                            }
                                        )
                                    }

                                    HorizontalDivider(color = SmavColors.Border)

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        if (hasStylist) {
                                            Text(
                                                text = "Stylist: ${formatSalonStaffName(line.item.stylist!!.name)}",
                                                color = SmavColors.StepperGreen,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                modifier = Modifier.weight(1f)
                                            )
                                            TextButton(
                                                onClick = { stylistPickerLineId = line.lineId },
                                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                                            ) {
                                                Text(
                                                    "Change Stylist",
                                                    color = SmavColors.AccentPink,
                                                    fontSize = 12.sp,
                                                    fontWeight = FontWeight.SemiBold
                                                )
                                            }
                                        } else {
                                            Text(
                                                text = "Stylist required before billing",
                                                color = SmavColors.DangerText,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Bold,
                                                modifier = Modifier.weight(1f)
                                            )
                                            Button(
                                                onClick = { stylistPickerLineId = line.lineId },
                                                colors = ButtonDefaults.buttonColors(
                                                    containerColor = SmavColors.AccentPink,
                                                    contentColor = Color.White
                                                ),
                                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                                shape = RoundedCornerShape(8.dp),
                                                modifier = Modifier.height(34.dp)
                                            ) {
                                                Text("Select Stylist", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        item(key = "cart_totals") {
                            SmavCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Subtotal", color = SmavColors.TextSecondary, fontSize = 13.sp)
                                    Text(formatSalonRupee(subtotalAmount), color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("GST", color = SmavColors.TextSecondary, fontSize = 13.sp)
                                    Text(formatSalonRupee(totalGstAmount), color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                }
                                HorizontalDivider(color = SmavColors.Border)
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Grand Total", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                    Text(formatSalonRupee(grandTotal), style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
                                }
                            }
                        }
                    }
                }
            }
        }

        // 3. GRAND TOTAL BAR (like SS2, shown when cart has items)
        if (cartCount > 0) {
            Surface(
                color = SmavColors.AccentPink,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { openReviewAndPrint() }
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Grand Total",
                        color = Color.White,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = formatSalonRupee(grandTotal),
                            color = Color.White,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Icon(
                            imageVector = Icons.Default.ChevronRight,
                            contentDescription = "Review & Print",
                            tint = Color.White,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }

        // 4. FIXED 3-SECTION BOTTOM NAVIGATION BAR (Menu, Selected Services / Cart, Review & Print)
        HorizontalDivider(color = SmavColors.Border)
        Surface(
            color = SmavColors.Surface,
            shadowElevation = 6.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(60.dp)
                    .padding(horizontal = 6.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                SalonBottomNavItem(
                    label = "Menu",
                    icon = Icons.Default.MenuBook,
                    selected = activeTab == SalonPosTab.MENU && !showFinalizeDialog,
                    badgeCount = 0,
                    onClick = { activeTab = SalonPosTab.MENU },
                    modifier = Modifier.weight(1f)
                )
                SalonBottomNavItem(
                    label = if (cartCount > 0) "Cart ($cartCount)" else "Cart",
                    icon = Icons.Default.ShoppingBag,
                    selected = activeTab == SalonPosTab.CART && !showFinalizeDialog,
                    badgeCount = cartCount,
                    onClick = {
                        if (cartLines.isEmpty()) {
                            showEmptyCartAndReturnToMenu()
                        } else {
                            activeTab = SalonPosTab.CART
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
                SalonBottomNavItem(
                    label = "Review & Print",
                    icon = Icons.Default.Print,
                    selected = showFinalizeDialog,
                    badgeCount = 0,
                    onClick = { openReviewAndPrint() },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }

    // STYLIST SELECTION POPUP DIALOG (opens immediately on adding a service or tapping Stylist)
    val targetLineForStylist = stylistPickerLineId?.let { id -> cartLines.firstOrNull { it.lineId == id } }
    if (targetLineForStylist != null) {
        MobileFormDialog(
            title = "Select Stylist",
            onDismiss = { stylistPickerLineId = null },
            confirmText = "Close",
            showConfirmButton = false,
            onConfirm = { stylistPickerLineId = null }
        ) {
            Text(
                text = targetLineForStylist.item.service.name,
                color = SmavColors.TextPrimary,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp
            )
            Text(
                text = "Choose a stylist for this service:",
                color = SmavColors.TextSecondary,
                fontSize = 12.sp
            )
            stylists.forEach { stylist ->
                val isCurrentStylist = targetLineForStylist.item.stylist?.id == stylist.id
                SmavCard(
                    highlighted = isCurrentStylist,
                    highlightColor = SmavColors.AccentPink,
                    onClick = {
                        cartLines = cartLines.map { line ->
                            if (line.lineId == targetLineForStylist.lineId) {
                                line.copy(item = line.item.copy(stylist = stylist))
                            } else line
                        }
                        if (highlightedMissingStylistLineId == targetLineForStylist.lineId) {
                            highlightedMissingStylistLineId = null
                        }
                        if (findFirstMissingStylistLine(cartLines) == null) {
                            stylistValidationMessage = null
                        }
                        stylistPickerLineId = null
                    }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            Icons.Default.Person,
                            contentDescription = null,
                            tint = if (isCurrentStylist) SmavColors.AccentPink else SmavColors.TextPrimary
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = formatSalonStaffName(stylist.name),
                                color = SmavColors.TextPrimary,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 14.sp
                            )
                            if (stylist.specialty.isNotBlank()) {
                                Text(
                                    text = stylist.specialty.trim(),
                                    color = SmavColors.TextSecondary,
                                    fontSize = 12.sp
                                )
                            }
                        }
                        if (isCurrentStylist) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = "Selected",
                                tint = SmavColors.AccentPink,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    // UPCOMING APPOINTMENTS DIALOG
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
                        customerPhone = sanitizeMobileNumberInput(appt.customerPhone)
                        val matchedSrv = services.firstOrNull { it.id == appt.serviceId }
                        val matchedStylist = stylists.firstOrNull { it.id == appt.stylistId }
                        if (matchedSrv != null) {
                            val newLine = SalonCartLine(
                                lineId = UUID.randomUUID().toString(),
                                item = SalonCartItem(matchedSrv, matchedStylist, 1)
                            )
                            cartLines = cartLines + newLine
                            if (matchedStylist == null) {
                                stylistPickerLineId = newLine.lineId
                            }
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

    // FINALIZE SALON BILL MODAL (Compact single-viewport layout, dropdown branch, inline validation + focus)
    if (showFinalizeDialog) {
        FinalizeSalonBillDialog(
            permittedBranches = permittedBranches,
            isBillingBlocked = isBillingBlocked,
            branchAuthMessage = branchAuthMessage,
            selectedBranch = selectedBranch,
            onSelectBranch = { chosen ->
                selectedBranch = chosen
                billingError = null
                checkoutAttemptFingerprint = null
            },
            cartItems = effectiveCart,
            subtotalAmount = subtotalAmount,
            totalGstAmount = totalGstAmount,
            grandTotal = grandTotal,
            customerName = customerName,
            onCustomerNameChange = { customerName = it },
            customerPhone = customerPhone,
            onCustomerPhoneChange = { customerPhone = it },
            discountPercentText = discountPercentText,
            onDiscountPercentChange = { discountPercentText = it },
            paymentMode = paymentMode,
            onPaymentModeChange = { paymentMode = it },
            busyBilling = busyBilling,
            serverError = billingError,
            onDismiss = { if (!busyBilling) showFinalizeDialog = false },
            onGenerateAndPrint = { activeBranch ->
                if (!busyBilling) {
                    busyBilling = true
                    billingError = null
                    val fingerprint = "${branch.id}|${activeBranch.id}|${activeBranch.branchCode}|${customerName.trim()}|${customerPhone.trim()}|$paymentMode|" +
                        effectiveCart.joinToString(",") { "${it.service.id}:${it.quantity}:${it.stylist?.id}:${it.discountPercent}" }
                    if (checkoutAttemptFingerprint != fingerprint) {
                        checkoutAttemptFingerprint = fingerprint
                        checkoutAttemptId = UUID.randomUUID().toString()
                    }
                    val attemptId = checkoutAttemptId
                    scope.launch {
                        val res = billingRepo.createSalonBill(
                            cartItems = effectiveCart,
                            customerName = customerName,
                            customerPhone = customerPhone,
                            paymentMode = paymentMode,
                            branch = branch,
                            selectedBranch = activeBranch,
                            cashierName = session.userName,
                            checkoutAttemptId = attemptId,
                            shouldPrint = false
                        )
                        res.onSuccess { bill ->
                            completedBill = bill
                            checkoutAttemptFingerprint = null
                            checkoutAttemptId = UUID.randomUUID().toString()
                            cartLines = emptyList()
                            selectedBranch = null
                            customerName = ""
                            customerPhone = ""
                            discountPercentText = "0"
                            activeTab = SalonPosTab.MENU
                            showFinalizeDialog = false

                            val printRes = billingRepo.reprintSalonBill(bill.id, branch, session.userName)
                            printFeedback = printRes.fold(
                                { "Bill ${bill.billNumber} (${activeBranch.displayName}) saved and printed via Bluetooth ESC/POS." },
                                { err -> "Bill ${bill.billNumber} (${activeBranch.displayName}) saved, but Bluetooth print failed (${err.message ?: "Printer unavailable"}). Tap Print Copy after connecting printer." }
                            )
                        }.onFailure { err ->
                            billingError = err.message ?: "Failed to generate bill."
                        }
                        busyBilling = false
                    }
                }
            }
        )
    }

    // BILL GENERATED COMPLETION DIALOG (Preserves Print Copy + Clear behavior)
    completedBill?.let { bill ->
        AlertDialog(
            onDismissRequest = { completedBill = null },
            containerColor = SmavColors.Surface,
            title = { Text("Bill Generated", color = SmavColors.StepperGreen, fontWeight = FontWeight.Bold) },
            text = {
                val resolvedBranchName = bill.branchName?.takeIf { it.isNotBlank() } ?: bill.branchCode
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (resolvedBranchName.isNotBlank()) {
                        Text("Branch: $resolvedBranchName (${bill.branchCode})", color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    Text("Bill No: ${bill.billNumber}", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold)
                    Text("Amount: ${formatSalonRupee(bill.grandTotal)}", style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
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
                                { "Print Copy sent via Bluetooth ESC/POS." },
                                { "Printer unavailable (${it.message}). Check Printer Settings." }
                            )
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = SmavColors.AccentPink, contentColor = Color.White)
                ) { Text("Print Copy", fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TextButton(onClick = onOpenPrinterSettings) { Text("Printers", color = SmavColors.InfoText) }
                    TextButton(onClick = {
                        cartLines = emptyList()
                        selectedBranch = null
                        customerName = ""
                        customerPhone = ""
                        discountPercentText = "0"
                        completedBill = null
                        printFeedback = null
                    }) { Text("Clear", color = SmavColors.TextSecondary, fontWeight = FontWeight.SemiBold) }
                }
            }
        )
    }
}

@Composable
private fun SalonServiceGridCard(
    service: SalonService,
    quantity: Int,
    selectedStylistLabel: String,
    missingStylist: Boolean,
    tintColor: Color,
    enabled: Boolean,
    onAddOrIncrement: () -> Unit,
    onDecrement: () -> Unit,
    onPickStylist: () -> Unit,
    modifier: Modifier = Modifier
) {
    val borderColor = when {
        quantity > 0 && missingStylist -> SmavColors.DangerText
        quantity > 0 -> SmavColors.AccentPink
        else -> SmavColors.Border
    }

    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
        border = BorderStroke(if (quantity > 0) 1.5.dp else 1.dp, borderColor),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Soft tinted title block (clean SS2 style, 2-line wrap without premature truncation)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 66.dp)
                    .background(tintColor)
                    .clickable(enabled = enabled) { onAddOrIncrement() }
                    .padding(horizontal = 10.dp, vertical = 10.dp)
            ) {
                Text(
                    text = service.name,
                    color = SmavColors.TextPrimary,
                    fontSize = 13.sp,
                    lineHeight = 17.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    softWrap = true,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(end = if (quantity > 0) 24.dp else 0.dp)
                )

                if (quantity > 0) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (missingStylist) SmavColors.DangerText else SmavColors.AccentPink)
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = "$quantity",
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }

            // Price + compact Add / Qty control
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formatSalonRupee(service.price),
                    color = SmavColors.TextPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1
                )

                if (quantity <= 0) {
                    Surface(
                        onClick = onAddOrIncrement,
                        enabled = enabled,
                        color = SmavColors.Surface,
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(
                            1.dp,
                            if (enabled) SmavColors.StepperGreen else SmavColors.BorderStrong
                        )
                    ) {
                        Text(
                            text = "+ Add",
                            color = if (enabled) SmavColors.StepperGreen else SmavColors.TextMuted,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                } else {
                    Surface(
                        color = SmavColors.StepperGreen,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(26.dp)
                                    .clickable(enabled = enabled, onClick = onDecrement),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.Remove,
                                    contentDescription = "Decrease ${service.name}",
                                    tint = Color.White,
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                            Text(
                                text = "$quantity",
                                color = Color.White,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 2.dp)
                            )
                            Box(
                                modifier = Modifier
                                    .size(26.dp)
                                    .clickable(enabled = enabled, onClick = onAddOrIncrement),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.Add,
                                    contentDescription = "Increase ${service.name}",
                                    tint = Color.White,
                                    modifier = Modifier.size(14.dp)
                                )
                            }
                        }
                    }
                }
            }

            // Bottom stylist name — shown ONLY after stylist selection (or subtle required tap if dismissed)
            if (quantity > 0 && selectedStylistLabel.isNotBlank()) {
                HorizontalDivider(color = SmavColors.Border)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(SmavColors.StepperGreenSoft)
                        .clickable { onPickStylist() }
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = "Stylist: $selectedStylistLabel",
                        color = SmavColors.StepperGreen,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                }
            } else if (quantity > 0 && missingStylist) {
                HorizontalDivider(color = SmavColors.DangerBorder)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(SmavColors.DangerBg)
                        .clickable { onPickStylist() }
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Select stylist *",
                        color = SmavColors.DangerText,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

@Composable
private fun SalonBottomNavItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    badgeCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val contentColor = if (selected) SmavColors.AccentPink else SmavColors.TextSecondary
    Column(
        modifier = modifier
            .fillMaxHeight()
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(contentAlignment = Alignment.TopEnd) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = contentColor,
                modifier = Modifier
                    .padding(horizontal = 6.dp, vertical = 1.dp)
                    .size(22.dp)
            )
            if (badgeCount > 0) {
                Box(
                    modifier = Modifier
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(SmavColors.AccentPink),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (badgeCount > 99) "99" else "$badgeCount",
                        color = Color.White,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
        Text(
            text = label,
            color = contentColor,
            fontSize = 11.sp,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FinalizeSalonBillDialog(
    permittedBranches: List<BranchOption>,
    isBillingBlocked: Boolean,
    branchAuthMessage: String,
    selectedBranch: BranchOption?,
    onSelectBranch: (BranchOption) -> Unit,
    cartItems: List<SalonCartItem>,
    subtotalAmount: Double,
    totalGstAmount: Double,
    grandTotal: Double,
    customerName: String,
    onCustomerNameChange: (String) -> Unit,
    customerPhone: String,
    onCustomerPhoneChange: (String) -> Unit,
    discountPercentText: String,
    onDiscountPercentChange: (String) -> Unit,
    paymentMode: String,
    onPaymentModeChange: (String) -> Unit,
    busyBilling: Boolean,
    serverError: String?,
    onDismiss: () -> Unit,
    onGenerateAndPrint: (BranchOption) -> Unit
) {
    var branchMenuExpanded by remember { mutableStateOf(false) }
    var branchError by remember { mutableStateOf<String?>(null) }
    var customerNameError by remember { mutableStateOf<String?>(null) }
    var customerPhoneError by remember { mutableStateOf<String?>(null) }

    val branchFocusRequester = remember { FocusRequester() }
    val customerNameFocusRequester = remember { FocusRequester() }
    val customerPhoneFocusRequester = remember { FocusRequester() }

    val isPhoneValid = isValidTenDigitMobile(customerPhone)
    var phoneHasInteracted by remember { mutableStateOf(customerPhone.isNotEmpty()) }
    val activePhoneError = customerPhoneError ?: if ((phoneHasInteracted || customerPhone.isNotEmpty()) && !isPhoneValid) {
        INVALID_MOBILE_NUMBER_MESSAGE
    } else null

    LaunchedEffect(Unit) {
        if (customerPhone.isNotEmpty() && !isValidTenDigitMobile(customerPhone)) {
            customerPhoneError = INVALID_MOBILE_NUMBER_MESSAGE
            customerPhoneFocusRequester.requestFocus()
        }
    }

    Dialog(
        onDismissRequest = { if (!busyBilling) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp)
                .imePadding(),
            colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
            border = BorderStroke(1.dp, SmavColors.Border),
            shape = RoundedCornerShape(18.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                // Compact Title Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Finalize Salon Bill",
                        color = SmavColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    IconButton(
                        onClick = { if (!busyBilling) onDismiss() },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = "Close",
                            tint = SmavColors.TextSecondary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
                HorizontalDivider(color = SmavColors.Border)

                // Compact Non-Scrolling Body designed to fit entirely in mobile viewport
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (isBillingBlocked) {
                        ErrorBannerCard(branchAuthMessage)
                    } else {
                        // 1. Branch Dropdown (blank by default: "Select Branch *")
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            ExposedDropdownMenuBox(
                                expanded = branchMenuExpanded,
                                onExpandedChange = {
                                    if (!busyBilling) branchMenuExpanded = !branchMenuExpanded
                                }
                            ) {
                                OutlinedTextField(
                                    value = selectedBranch?.let { "${it.displayName} (${it.branchCode})" } ?: "",
                                    onValueChange = {},
                                    readOnly = true,
                                    singleLine = true,
                                    label = { Text("Select Branch *", fontSize = 12.sp) },
                                    placeholder = { Text("Select Branch *", fontSize = 13.sp, color = SmavColors.TextMuted) },
                                    isError = branchError != null,
                                    trailingIcon = {
                                        ExposedDropdownMenuDefaults.TrailingIcon(expanded = branchMenuExpanded)
                                    },
                                    colors = smavOutlinedFieldColors(),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .menuAnchor()
                                        .focusRequester(branchFocusRequester)
                                )
                                ExposedDropdownMenu(
                                    expanded = branchMenuExpanded,
                                    onDismissRequest = { branchMenuExpanded = false },
                                    modifier = Modifier.background(SmavColors.Surface)
                                ) {
                                    permittedBranches.forEach { branchOption ->
                                        DropdownMenuItem(
                                            text = {
                                                Text(
                                                    text = "${branchOption.displayName} (${branchOption.branchCode})",
                                                    color = SmavColors.TextPrimary,
                                                    fontSize = 13.sp,
                                                    fontWeight = if (selectedBranch?.id == branchOption.id) FontWeight.Bold else FontWeight.Medium
                                                )
                                            },
                                            onClick = {
                                                onSelectBranch(branchOption)
                                                branchError = null
                                                branchMenuExpanded = false
                                            }
                                        )
                                    }
                                }
                            }
                            if (branchError != null) {
                                Text(
                                    text = branchError!!,
                                    color = SmavColors.DangerText,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(start = 4.dp)
                                )
                            }
                        }
                    }

                    // 2. Compact Selected Services Box (bounded height if multiple items)
                    Surface(
                        color = SmavColors.SurfaceSubtle,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, SmavColors.Border),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 92.dp)
                                .verticalScroll(rememberScrollState())
                                .padding(horizontal = 10.dp, vertical = 7.dp),
                            verticalArrangement = Arrangement.spacedBy(5.dp)
                        ) {
                            cartItems.forEachIndexed { idx, item ->
                                if (idx > 0) HorizontalDivider(color = SmavColors.Border.copy(alpha = 0.6f))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f).padding(end = 6.dp)) {
                                        Text(
                                            text = item.service.name,
                                            color = SmavColors.TextPrimary,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = "Stylist: ${formatSalonStaffName(item.stylist?.name ?: "—")} • ×${item.quantity}",
                                            color = SmavColors.InfoText,
                                            fontSize = 11.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    Text(
                                        text = formatSalonRupee(item.totalAmount),
                                        color = SmavColors.StepperGreen,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }

                    // 3. Mandatory Customer Name & Phone with inline errors + focus
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        OutlinedTextField(
                            value = customerName,
                            onValueChange = {
                                onCustomerNameChange(it)
                                if (customerNameError != null) customerNameError = null
                            },
                            label = { Text("Customer Name *", fontSize = 12.sp) },
                            singleLine = true,
                            isError = customerNameError != null,
                            colors = smavOutlinedFieldColors(),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(customerNameFocusRequester)
                        )
                        if (customerNameError != null) {
                            Text(
                                text = customerNameError!!,
                                color = SmavColors.DangerText,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }

                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        OutlinedTextField(
                            value = customerPhone,
                            onValueChange = { rawInput ->
                                val digitsOnly = sanitizeMobileNumberInput(rawInput)
                                phoneHasInteracted = true
                                onCustomerPhoneChange(digitsOnly)
                                if (digitsOnly.isEmpty() || !isValidTenDigitMobile(digitsOnly)) {
                                    customerPhoneError = INVALID_MOBILE_NUMBER_MESSAGE
                                    customerPhoneFocusRequester.requestFocus()
                                } else {
                                    customerPhoneError = null
                                }
                            },
                            label = { Text("Customer Phone *", fontSize = 12.sp) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                            isError = activePhoneError != null,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = SmavColors.TextPrimary,
                                unfocusedTextColor = SmavColors.TextPrimary,
                                disabledTextColor = SmavColors.TextSecondary,
                                focusedContainerColor = SmavColors.Surface,
                                unfocusedContainerColor = SmavColors.Surface,
                                errorContainerColor = Color(0xFFFEF2F2),
                                disabledContainerColor = SmavColors.SurfaceSubtle,
                                focusedBorderColor = SmavColors.AccentPink,
                                unfocusedBorderColor = SmavColors.Border,
                                errorBorderColor = SmavColors.DangerText,
                                focusedLabelColor = SmavColors.AccentPink,
                                unfocusedLabelColor = SmavColors.TextSecondary,
                                errorLabelColor = SmavColors.DangerText,
                                focusedPlaceholderColor = SmavColors.TextMuted,
                                unfocusedPlaceholderColor = SmavColors.TextMuted,
                                cursorColor = SmavColors.AccentPink,
                                errorCursorColor = SmavColors.DangerText
                            ),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(customerPhoneFocusRequester)
                        )
                        if (activePhoneError != null) {
                            Text(
                                text = activePhoneError,
                                color = SmavColors.DangerText,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }

                    // 4. Compact Discount (%) + Payment Mode on one tight horizontal row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedTextField(
                            value = discountPercentText,
                            onValueChange = onDiscountPercentChange,
                            label = { Text("Disc %", fontSize = 11.sp) },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            colors = smavOutlinedFieldColors(),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.width(86.dp)
                        )

                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = "Payment Mode",
                                color = SmavColors.TextSecondary,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                listOf("upi", "cash", "card", "split").forEach { mode ->
                                    val selected = paymentMode == mode
                                    Surface(
                                        onClick = { onPaymentModeChange(mode) },
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (selected) SmavColors.TextPrimary else SmavColors.Surface,
                                        border = BorderStroke(
                                            1.dp,
                                            if (selected) SmavColors.TextPrimary else SmavColors.Border
                                        ),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Text(
                                            text = mode.uppercase(Locale.ENGLISH),
                                            color = if (selected) Color.White else SmavColors.TextPrimary,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            textAlign = TextAlign.Center,
                                            maxLines = 1,
                                            modifier = Modifier.padding(vertical = 8.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // 5. Compact Totals Summary Strip
                    Surface(
                        color = SmavColors.StepperGreenSoft,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, SmavColors.SuccessBorder),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 9.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Net Payable (incl. GST)",
                                    color = SmavColors.TextPrimary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = "Sub ${formatSalonRupee(subtotalAmount)} + GST ${formatSalonRupee(totalGstAmount)}",
                                    color = SmavColors.TextSecondary,
                                    fontSize = 10.sp
                                )
                            }
                            Text(
                                text = formatSalonRupee(grandTotal),
                                style = SmavNumericStyles.PriceLarge,
                                color = SmavColors.StepperGreen
                            )
                        }
                    }

                    if (!serverError.isNullOrBlank()) {
                        Text(
                            text = serverError,
                            color = SmavColors.DangerText,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }

                // 6. Fixed Bottom Action Row with Untruncated "Generate & Print" Button
                HorizontalDivider(color = SmavColors.Border)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SmavSecondaryButton(
                        text = "Cancel",
                        onClick = onDismiss,
                        enabled = !busyBilling,
                        modifier = Modifier.weight(0.36f)
                    )
                    SmavGradientButton(
                        text = "Generate & Print",
                        enabled = !busyBilling && !isBillingBlocked && cartItems.isNotEmpty() && isPhoneValid,
                        busy = busyBilling,
                        modifier = Modifier.weight(0.64f),
                        onClick = {
                            val validation = validateSalonFinalizeForm(
                                selectedBranch = selectedBranch,
                                customerName = customerName,
                                customerPhone = customerPhone
                            )
                            branchError = validation.branchError
                            customerNameError = validation.customerNameError
                            customerPhoneError = validation.customerPhoneError

                            if (!validation.isValid) {
                                when (validation.firstInvalidField) {
                                    SalonFinalizeField.BRANCH -> {
                                        branchFocusRequester.requestFocus()
                                        branchMenuExpanded = true
                                    }
                                    SalonFinalizeField.CUSTOMER_NAME -> {
                                        customerNameFocusRequester.requestFocus()
                                    }
                                    SalonFinalizeField.CUSTOMER_PHONE -> {
                                        customerPhoneFocusRequester.requestFocus()
                                    }
                                    null -> Unit
                                }
                            } else {
                                onGenerateAndPrint(selectedBranch!!)
                            }
                        }
                    )
                }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// SALON BILLS & REPRINT VIEW (UNIFIED CENTRAL LEDGER — TODAY FOR POS_BILLING; TODAY/HISTORY/DELETED FOR ADMINS)
// -------------------------------------------------------------------------------------------------
@Composable
internal fun SalonBillsReprintScreenContent(
    salonBills: List<SalonBillEntity>,
    salonItemsByBill: Map<String, List<SalonBillItemEntity>>,
    businessName: String,
    canModify: Boolean,
    activeScope: String = "today",
    isRefreshing: Boolean = false,
    branches: List<BranchOption> = emptyList(),
    selectedBranchId: String = "",
    fromDate: String = "",
    toDate: String = "",
    feedback: String?,
    errorBanner: String?,
    onRefresh: () -> Unit = {},
    onScopeChange: (String) -> Unit = {},
    onBranchFilterChange: (String) -> Unit = {},
    onDateRangeChange: (String, String) -> Unit = { _, _ -> },
    onReprint: (SalonBillEntity) -> Unit,
    onEdit: (SalonBillEntity, List<SalonBillItemEntity>) -> Unit,
    onVoid: (SalonBillEntity) -> Unit,
    onRestore: (SalonBillEntity) -> Unit = {}
) {
    var searchQuery by remember { mutableStateOf("") }
    var selectedBillForDetails by remember { mutableStateOf<SalonBillEntity?>(null) }
    var fromInput by remember(fromDate) { mutableStateOf(fromDate) }
    var toInput by remember(toDate) { mutableStateOf(toDate) }

    val effectiveScope = if (canModify) activeScope else "today"

    // For Today scope, strictly enforce Asia/Kolkata today + active-only filter.
    // For History/Deleted (admin-only), filter locally by search query while preserving newest-first order.
    val displayedBills = remember(salonBills, searchQuery, effectiveScope, salonItemsByBill) {
        if (effectiveScope == "today") {
            filterTodaySalonBillsAsiaKolkata(
                bills = salonBills,
                nowMs = System.currentTimeMillis(),
                searchQuery = searchQuery
            ).sortedByDescending { it.createdAtLocal }
        } else {
            val q = searchQuery.trim().lowercase(Locale.ENGLISH)
            salonBills.filter { bill ->
                if (q.isBlank()) return@filter true
                val itemsText = salonItemsByBill[bill.id].orEmpty()
                    .joinToString(" ") { "${it.serviceName} ${it.stylistName.orEmpty()}" }
                    .lowercase(Locale.ENGLISH)
                bill.billNumber.lowercase(Locale.ENGLISH).contains(q) ||
                    (bill.customerName ?: "").lowercase(Locale.ENGLISH).contains(q) ||
                    (bill.customerPhone ?: "").lowercase(Locale.ENGLISH).contains(q) ||
                    (bill.branchName ?: bill.branchCode).lowercase(Locale.ENGLISH).contains(q) ||
                    itemsText.contains(q)
            }.sortedByDescending { it.createdAtLocal }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SmavColors.Background)
    ) {
        Surface(
            color = SmavColors.Surface,
            shadowElevation = 1.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(modifier = Modifier.weight(1f)) {
                        SearchField(
                            query = searchQuery,
                            onQueryChange = { searchQuery = it },
                            placeholder = "Search bill, customer, phone..."
                        )
                    }
                    OutlinedButton(
                        onClick = onRefresh,
                        enabled = !isRefreshing,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, SmavColors.Border),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp),
                        modifier = Modifier.height(44.dp)
                    ) {
                        if (isRefreshing) {
                            CircularProgressIndicator(
                                strokeWidth = 2.dp,
                                color = SmavColors.AccentPink,
                                modifier = Modifier.size(16.dp)
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Refresh Ledger",
                                tint = SmavColors.AccentPink,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }

                // Role-gated Today | History | Deleted switcher (strictly hidden for POS_BILLING)
                if (canModify) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(
                            "today" to "Today",
                            "history" to "History",
                            "deleted" to "Deleted"
                        ).forEach { (scopeId, label) ->
                            val selected = effectiveScope == scopeId
                            Surface(
                                onClick = { onScopeChange(scopeId) },
                                shape = RoundedCornerShape(10.dp),
                                color = if (selected) SmavColors.TextPrimary else SmavColors.Background,
                                border = BorderStroke(1.dp, if (selected) SmavColors.TextPrimary else SmavColors.Border),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    text = label,
                                    color = if (selected) Color.White else SmavColors.TextSecondary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.padding(vertical = 8.dp)
                                )
                            }
                        }
                    }
                }

                // Optional multi-branch filter chips
                if (branches.size > 1) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        item(key = "branch_all") {
                            val selected = selectedBranchId.isBlank()
                            Surface(
                                onClick = { onBranchFilterChange("") },
                                shape = RoundedCornerShape(10.dp),
                                color = if (selected) SmavColors.AccentPink else SmavColors.Background,
                                border = BorderStroke(1.dp, if (selected) SmavColors.AccentPink else SmavColors.Border)
                            ) {
                                Text(
                                    text = "All Branches",
                                    color = if (selected) Color.White else SmavColors.TextSecondary,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                )
                            }
                        }
                        items(branches, key = { it.id }) { b ->
                            val selected = selectedBranchId == b.id
                            Surface(
                                onClick = { onBranchFilterChange(b.id) },
                                shape = RoundedCornerShape(10.dp),
                                color = if (selected) SmavColors.AccentPink else SmavColors.Background,
                                border = BorderStroke(1.dp, if (selected) SmavColors.AccentPink else SmavColors.Border)
                            ) {
                                Text(
                                    text = "${b.displayName} (${b.branchCode})",
                                    color = if (selected) Color.White else SmavColors.TextSecondary,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                )
                            }
                        }
                    }
                }

                // Date range inputs (YYYY-MM-DD in IST) for authorized History / Deleted tabs
                if (canModify && effectiveScope != "today") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = fromInput,
                            onValueChange = { fromInput = it.take(10) },
                            placeholder = { Text("From YYYY-MM-DD", fontSize = 11.sp) },
                            singleLine = true,
                            textStyle = LocalTextStyle.current.copy(fontSize = 12.sp),
                            shape = RoundedCornerShape(10.dp),
                            colors = smavOutlinedFieldColors(),
                            modifier = Modifier.weight(1f)
                        )
                        OutlinedTextField(
                            value = toInput,
                            onValueChange = { toInput = it.take(10) },
                            placeholder = { Text("To YYYY-MM-DD", fontSize = 11.sp) },
                            singleLine = true,
                            textStyle = LocalTextStyle.current.copy(fontSize = 12.sp),
                            shape = RoundedCornerShape(10.dp),
                            colors = smavOutlinedFieldColors(),
                            modifier = Modifier.weight(1f)
                        )
                        Button(
                            onClick = { onDateRangeChange(fromInput.trim(), toInput.trim()) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SmavColors.TextPrimary,
                                contentColor = Color.White
                            ),
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                            modifier = Modifier.height(44.dp)
                        ) {
                            Text("Go", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = SmavColors.Border)

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            contentPadding = PaddingValues(vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (feedback != null) {
                item(key = "feedback_banner") { SmavSuccessBannerCard(feedback) }
            }
            if (errorBanner != null) {
                item(key = "error_banner") { ErrorBannerCard(errorBanner) }
            }

            if (displayedBills.isEmpty()) {
                item(key = "empty_ledger_bills") {
                    EmptyStateCard(
                        title = when (effectiveScope) {
                            "history" -> "No Historical Bills Found"
                            "deleted" -> "No Deleted Bills"
                            else -> "No Bills Today"
                        },
                        subtitle = when (effectiveScope) {
                            "history" -> "Adjust date range, branch, or search to inspect earlier bills for $businessName."
                            "deleted" -> "Soft-deleted bills for $businessName appear here for authorized admins."
                            else -> "Today's active bills for $businessName (IST) across all platforms appear here."
                        },
                        icon = Icons.Default.ReceiptLong
                    )
                }
            } else {
                items(displayedBills, key = { "${effectiveScope}_${it.id}_${it.billNumber}" }) { bill ->
                    val displayCustomer = bill.customerName?.trim()?.takeIf { it.isNotBlank() } ?: "Walk-in Guest"
                    val displayPhone = bill.customerPhone?.trim()?.takeIf { it.isNotBlank() }
                    val lineItems = salonItemsByBill[bill.id].orEmpty()
                    val stylistsText = lineItems.mapNotNull { it.stylistName?.trim()?.takeIf { n -> n.isNotBlank() } }
                        .distinct()
                        .joinToString(", ") { formatSalonStaffName(it) }
                    val servicesText = lineItems.joinToString(", ") {
                        if (it.quantity > 1) "${it.serviceName} ×${it.quantity}" else it.serviceName
                    }
                    val resolvedBranch = bill.branchName?.takeIf { it.isNotBlank() } ?: bill.branchCode

                    Card(
                        onClick = { selectedBillForDetails = bill },
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
                        border = BorderStroke(
                            1.dp,
                            if (bill.isVoided) SmavColors.DangerText.copy(alpha = 0.45f) else SmavColors.Border
                        ),
                        shape = RoundedCornerShape(14.dp),
                        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = bill.billNumber + if (bill.isVoided) " • DELETED" else "",
                                    color = if (bill.isVoided) SmavColors.DangerText else SmavColors.TextPrimary,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f).padding(end = 8.dp)
                                )
                                Text(
                                    text = formatSalonRupee(bill.grandTotal),
                                    style = SmavNumericStyles.Price,
                                    fontSize = 16.sp,
                                    color = if (bill.isVoided) SmavColors.TextSecondary else SmavColors.TextPrimary
                                )
                            }

                            Text(
                                text = buildString {
                                    append(BillIdGenerator.getFormattedDateTime(bill.createdAtLocal))
                                    if (resolvedBranch.isNotBlank()) append(" • $resolvedBranch")
                                    append(" • ${bill.paymentMode.uppercase(Locale.ENGLISH)}")
                                },
                                color = SmavColors.TextSecondary,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )

                            if (servicesText.isNotBlank()) {
                                Text(
                                    text = servicesText,
                                    color = SmavColors.TextPrimary,
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }

                            if (stylistsText.isNotBlank()) {
                                Text(
                                    text = "Stylist: $stylistsText",
                                    color = SmavColors.InfoText,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }

                            if (bill.isVoided && !bill.voidReason.isNullOrBlank()) {
                                Text(
                                    text = "Delete reason: ${bill.voidReason}",
                                    color = SmavColors.DangerText,
                                    fontSize = 11.sp,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = if (displayPhone != null) "$displayCustomer • $displayPhone" else "Customer: $displayCustomer",
                                    color = SmavColors.TextPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier
                                        .weight(1f)
                                        .padding(end = 10.dp)
                                        .clickable { selectedBillForDetails = bill }
                                )

                                if (bill.isVoided && canModify) {
                                    Button(
                                        onClick = { onRestore(bill) },
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = SmavColors.StepperGreen,
                                            contentColor = Color.White
                                        ),
                                        shape = RoundedCornerShape(10.dp),
                                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                                        modifier = Modifier.height(36.dp)
                                    ) {
                                        Text(
                                            text = "Restore",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                } else if (!bill.isVoided) {
                                    Button(
                                        onClick = { onReprint(bill) },
                                        colors = ButtonDefaults.buttonColors(
                                            containerColor = SmavColors.AccentPink,
                                            contentColor = Color.White
                                        ),
                                        shape = RoundedCornerShape(10.dp),
                                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                                        modifier = Modifier.height(36.dp)
                                    ) {
                                        Text(
                                            text = "Reprint",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // SEPARATE BILL DETAILS DIALOG (services, stylist, payment mode, branch, taxes, totals)
    selectedBillForDetails?.let { bill ->
        val lineItems = salonItemsByBill[bill.id].orEmpty()
        val resolvedBranch = bill.branchName?.takeIf { it.isNotBlank() } ?: bill.branchCode
        val displayCustomer = bill.customerName?.trim()?.takeIf { it.isNotBlank() } ?: "Walk-in Guest"
        val displayPhone = bill.customerPhone?.trim()?.takeIf { it.isNotBlank() } ?: "—"

        AlertDialog(
            onDismissRequest = { selectedBillForDetails = null },
            containerColor = SmavColors.Surface,
            title = {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = bill.billNumber + if (bill.isVoided) " (DELETED)" else "",
                        color = if (bill.isVoided) SmavColors.DangerText else SmavColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text(
                        text = BillIdGenerator.getFormattedDateTime(bill.createdAtLocal),
                        color = SmavColors.TextSecondary,
                        fontSize = 12.sp
                    )
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Customer: $displayCustomer ($displayPhone)",
                        color = SmavColors.TextPrimary,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp
                    )
                    if (resolvedBranch.isNotBlank()) {
                        Text(
                            text = "Branch: $resolvedBranch (${bill.branchCode})",
                            color = SmavColors.TextSecondary,
                            fontSize = 12.sp
                        )
                    }
                    Text(
                        text = "Payment Mode: ${bill.paymentMode.uppercase(Locale.ENGLISH)}",
                        color = SmavColors.TextSecondary,
                        fontSize = 12.sp
                    )
                    if (bill.isVoided && !bill.voidReason.isNullOrBlank()) {
                        SmavWarningBannerCard("Deleted reason: ${bill.voidReason}")
                    }

                    HorizontalDivider(color = SmavColors.Border)

                    Text(
                        text = "Services (${lineItems.size})",
                        color = SmavColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp
                    )

                    lineItems.forEach { line ->
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = line.serviceName,
                                    color = SmavColors.TextPrimary,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                    modifier = Modifier.weight(1f).padding(end = 8.dp)
                                )
                                Text(
                                    text = formatSalonRupee(line.totalAmount),
                                    color = SmavColors.StepperGreen,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 13.sp
                                )
                            }
                            Text(
                                text = "Qty: ${line.quantity} × ${formatSalonRupee(line.unitPrice)}" +
                                    (line.stylistName?.takeIf { it.isNotBlank() }?.let { " • Stylist: ${formatSalonStaffName(it)}" } ?: ""),
                                color = SmavColors.InfoText,
                                fontSize = 11.sp
                            )
                        }
                    }

                    HorizontalDivider(color = SmavColors.Border)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Subtotal", color = SmavColors.TextSecondary, fontSize = 12.sp)
                        Text(formatSalonRupee(bill.subtotal), color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                    if (bill.discountAmount > 0.0) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("Discount", color = SmavColors.TextSecondary, fontSize = 12.sp)
                            Text("-${formatSalonRupee(bill.discountAmount)}", color = SmavColors.DangerText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Taxes (CGST + SGST)", color = SmavColors.TextSecondary, fontSize = 12.sp)
                        Text(formatSalonRupee(bill.totalTax), color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Grand Total", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text(formatSalonRupee(bill.grandTotal), style = SmavNumericStyles.Price, color = SmavColors.StepperGreen)
                    }

                    if (!bill.conflictMessage.isNullOrBlank()) {
                        SmavWarningBannerCard("Sync note: ${bill.conflictMessage}")
                    }
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (bill.isVoided && canModify) {
                        Button(
                            onClick = {
                                selectedBillForDetails = null
                                onRestore(bill)
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SmavColors.StepperGreen,
                                contentColor = Color.White
                            )
                        ) {
                            Text("Restore", fontWeight = FontWeight.Bold)
                        }
                    } else if (!bill.isVoided) {
                        if (canModify) {
                            TextButton(onClick = {
                                selectedBillForDetails = null
                                onEdit(bill, lineItems)
                            }) {
                                Text("Edit", color = SmavColors.InfoText, fontWeight = FontWeight.SemiBold)
                            }
                            TextButton(onClick = {
                                selectedBillForDetails = null
                                onVoid(bill)
                            }) {
                                Text("Void", color = SmavColors.DangerText, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        Button(
                            onClick = {
                                onReprint(bill)
                                selectedBillForDetails = null
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = SmavColors.AccentPink,
                                contentColor = Color.White
                            )
                        ) {
                            Text("Reprint", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { selectedBillForDetails = null }) {
                    Text("Close", color = SmavColors.TextSecondary)
                }
            }
        )
    }
}
