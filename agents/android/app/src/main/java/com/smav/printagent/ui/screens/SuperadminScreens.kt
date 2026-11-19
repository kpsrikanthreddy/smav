package com.smav.printagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import com.smav.printagent.data.repository.AdminNetworkRepository
import com.smav.printagent.model.*
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.SmavColors
import com.smav.printagent.ui.theme.SmavNumericStyles
import kotlinx.coroutines.launch
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SuperadminOutletsScreen(
    session: StaffSession,
    adminRepo: AdminNetworkRepository,
    onSessionUpdated: (StaffSession) -> Unit,
    onLaunchPosSuccess: (StaffSession) -> Unit,
    onUnauthorized: (String) -> Unit,
    onOpenRoute: (SmavRoute) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var outlets by remember { mutableStateOf<List<AdminOutletItem>>(emptyList()) }
    var admins by remember { mutableStateOf<List<OutletAdminItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var busyAction by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var statusBanner by remember { mutableStateOf<String?>(null) }

    var searchQuery by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("all") }

    var showOutletForm by remember { mutableStateOf(false) }
    var editingOutlet by remember { mutableStateOf<AdminOutletItem?>(null) }
    var confirmToggleOutlet by remember { mutableStateOf<AdminOutletItem?>(null) }

    fun loadData() {
        scope.launch {
            loading = true
            errorMsg = null
            val outletsRes = adminRepo.getSuperadminOutlets()
            val adminsRes = adminRepo.getSuperadminAdmins()
            outletsRes.onSuccess { outlets = it }.onFailure { err ->
                if (err is UnauthorizedSessionException) {
                    onUnauthorized(err.message ?: "Session expired.")
                    return@launch
                }
                errorMsg = SmavApiClient.friendlyThrowable(err, "Failed to load outlets.")
            }
            adminsRes.onSuccess { admins = it }
            loading = false
        }
    }

    LaunchedEffect(Unit) { loadData() }

    val filteredOutlets = remember(outlets, searchQuery, selectedCategory) {
        outlets.filter { outlet ->
            val matchesCat = selectedCategory == "all" || outlet.businessType.id == selectedCategory
            val q = searchQuery.trim().lowercase(Locale.ENGLISH)
            val matchesQuery = q.isBlank() ||
                outlet.name.lowercase(Locale.ENGLISH).contains(q) ||
                outlet.code.lowercase(Locale.ENGLISH).contains(q) ||
                outlet.address.lowercase(Locale.ENGLISH).contains(q)
            matchesCat && matchesQuery
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SmavCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Enterprise Multi-Outlet Network", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                        Text("Select any outlet to inspect, edit, or launch Auditor POS", color = SmavColors.TextSecondary, fontSize = 12.sp)
                    }
                    IconButton(onClick = { loadData() }, enabled = !loading, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh outlets", tint = SmavColors.InfoText)
                    }
                }

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SmavGradientButton(
                        text = "Add New Outlet",
                        icon = Icons.Default.AddBusiness,
                        onClick = { editingOutlet = null; showOutletForm = true }
                    )
                    SmavSecondaryButton(
                        text = "Admins (${admins.size})",
                        icon = Icons.Default.PersonAdd,
                        onClick = { onOpenRoute(SmavRoute.SUPERADMIN_ADMINS) }
                    )
                    SmavSecondaryButton(
                        text = "Integrations",
                        icon = Icons.Default.SettingsInputComponent,
                        onClick = { onOpenRoute(SmavRoute.INTEGRATION_DIAGNOSTICS) }
                    )
                }
            }
        }

        item {
            SearchField(
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                placeholder = "Search outlets by name, code, or address"
            )
        }

        item {
            FilterFlowRow(
                items = listOf("all", "salon", "restaurant", "retail", "other"),
                selected = selectedCategory,
                labelOf = {
                    when (it) {
                        "all" -> "All (${outlets.size})"
                        "salon" -> "Salons"
                        "restaurant" -> "Restaurants"
                        "retail" -> "Retail"
                        else -> "Other"
                    }
                },
                onSelect = { selectedCategory = it }
            )
        }

        if (statusBanner != null) {
            item { SmavSuccessBannerCard(statusBanner!!) }
        }

        if (errorMsg != null) {
            item { ErrorBannerCard(errorMsg!!, onRetry = { loadData() }) }
        }

        if (loading || busyAction) {
            item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        }

        if (!loading && filteredOutlets.isEmpty()) {
            item {
                EmptyStateCard(
                    title = "No Outlets Found",
                    subtitle = "No outlets match your filter criteria.",
                    icon = Icons.Default.Store
                )
            }
        }

        items(filteredOutlets, key = { it.id }) { outlet ->
            val adminCount = admins.count { admin ->
                admin.memberships.any { it.outletId == outlet.id || it.outletCode.equals(outlet.code, true) }
            }
            val isSelected = session.businessId == outlet.id

            SmavCard(
                highlighted = isSelected,
                highlightColor = SmavColors.InfoText
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                        Text(
                            text = outlet.name,
                            color = SmavColors.TextPrimary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        )
                        Text(
                            text = "${outlet.businessType.displayName} • Code: ${outlet.code.uppercase(Locale.ENGLISH)}",
                            color = SmavColors.InfoText,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    StatusBadgeChip(
                        text = if (outlet.isActive) "Active" else "Disabled",
                        color = if (outlet.isActive) SmavColors.StepperGreen else SmavColors.DangerText
                    )
                }

                if (outlet.address.isNotBlank()) {
                    Text(outlet.address, color = SmavColors.TextSecondary, fontSize = 12.sp)
                }

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    StatusBadgeChip(text = "Admins: $adminCount", color = SmavColors.TextSecondary)
                    if (outlet.supabaseUrl.isNotBlank()) {
                        StatusBadgeChip(text = "Supabase Linked", color = SmavColors.StepperGreen)
                    }
                    if (isSelected) {
                        StatusBadgeChip(text = "Active Context", color = SmavColors.InfoText)
                    }
                }

                HorizontalDivider(color = SmavColors.Border)

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SmavGradientButton(
                        text = "Launch POS",
                        icon = Icons.Default.PointOfSale,
                        enabled = !busyAction && outlet.isActive && outlet.businessType != BusinessType.OTHER,
                        onClick = {
                            busyAction = true
                            errorMsg = null
                            scope.launch {
                                adminRepo.launchSuperadminPos(outlet.id)
                                    .onSuccess { updated ->
                                        onSessionUpdated(updated)
                                        onLaunchPosSuccess(updated)
                                    }
                                    .onFailure { err ->
                                        if (err is UnauthorizedSessionException) {
                                            onUnauthorized(err.message ?: "Session expired.")
                                        } else {
                                            errorMsg = SmavApiClient.friendlyThrowable(err)
                                        }
                                    }
                                busyAction = false
                            }
                        }
                    )

                    SmavSecondaryButton(
                        text = "Select Context",
                        enabled = !busyAction && outlet.isActive,
                        onClick = {
                            busyAction = true
                            scope.launch {
                                adminRepo.switchOutlet(outlet.id)
                                    .onSuccess { updated ->
                                        onSessionUpdated(updated)
                                        statusBanner = "Active outlet set to ${outlet.name}."
                                    }
                                    .onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                                busyAction = false
                            }
                        }
                    )

                    SmavSecondaryButton(
                        text = "Edit",
                        icon = Icons.Default.Edit,
                        enabled = !busyAction,
                        onClick = { editingOutlet = outlet; showOutletForm = true }
                    )

                    SmavSecondaryButton(
                        text = if (outlet.isActive) "Disable" else "Enable",
                        enabled = !busyAction,
                        textColor = if (outlet.isActive) SmavColors.DangerText else SmavColors.StepperGreen,
                        onClick = { confirmToggleOutlet = outlet }
                    )
                }
            }
        }
    }

    if (showOutletForm) {
        OutletEditorDialog(
            initial = editingOutlet,
            onDismiss = { showOutletForm = false },
            onSave = { name, code, cat, addr, phone, gstin, header, footer ->
                scope.launch {
                    val result = if (editingOutlet == null) {
                        adminRepo.createSuperadminOutlet(name, code, cat, addr, phone, gstin, header, footer)
                    } else {
                        adminRepo.updateSuperadminOutlet(editingOutlet!!.id, name, code, cat, addr, phone, gstin, header, footer)
                    }
                    result.onSuccess {
                        showOutletForm = false
                        statusBanner = if (editingOutlet == null) "Outlet \"$name\" created." else "Outlet \"$name\" updated."
                        loadData()
                    }.onFailure { err ->
                        errorMsg = SmavApiClient.friendlyThrowable(err)
                    }
                }
            }
        )
    }

    confirmToggleOutlet?.let { target ->
        AlertDialog(
            onDismissRequest = { confirmToggleOutlet = null },
            containerColor = SmavColors.Surface,
            title = {
                Text(
                    if (target.isActive) "Disable ${target.name}?" else "Enable ${target.name}?",
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    if (target.isActive) "Staff and POS terminals assigned to this outlet will be blocked from signing in until re-enabled."
                    else "This outlet will become active for billing and authentication.",
                    color = SmavColors.TextSecondary
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        val nextState = !target.isActive
                        confirmToggleOutlet = null
                        busyAction = true
                        scope.launch {
                            adminRepo.setSuperadminOutletStatus(target.id, nextState)
                                .onSuccess {
                                    statusBanner = "${target.name} is now ${if (nextState) "active" else "disabled"}."
                                    loadData()
                                }
                                .onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                            busyAction = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (target.isActive) SmavColors.DangerText else SmavColors.StepperGreen,
                        contentColor = Color.White
                    )
                ) { Text(if (target.isActive) "Disable" else "Enable", fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmToggleOutlet = null }) {
                    Text("Cancel", color = SmavColors.TextSecondary)
                }
            }
        )
    }
}

@Composable
private fun OutletEditorDialog(
    initial: AdminOutletItem?,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String, String, String, String, String) -> Unit
) {
    var name by remember { mutableStateOf(initial?.name ?: "") }
    var code by remember { mutableStateOf(initial?.code ?: "") }
    var category by remember { mutableStateOf(initial?.businessType?.id ?: "salon") }
    var address by remember { mutableStateOf(initial?.address ?: "") }
    var phone by remember { mutableStateOf(initial?.phone ?: "") }
    var gstin by remember { mutableStateOf(initial?.gstin ?: "") }
    var header by remember { mutableStateOf(initial?.receiptHeader ?: "") }
    var footer by remember { mutableStateOf(initial?.receiptFooter ?: "") }

    MobileFormDialog(
        title = if (initial == null) "Add New Outlet" else "Edit Outlet",
        onDismiss = onDismiss,
        confirmText = if (initial == null) "Create Outlet" else "Save Changes",
        confirmEnabled = name.isNotBlank() && code.isNotBlank(),
        onConfirm = { onSave(name, code, category, address, phone, gstin, header, footer) }
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Outlet Name") },
            singleLine = true,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            label = { Text("Outlet Code (e.g. glossylooks, mozz)") },
            singleLine = true,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        Text("Business Category", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        FilterFlowRow(
            items = listOf("salon", "restaurant", "retail", "other"),
            selected = category,
            labelOf = { BusinessType.fromRawCategory(it).displayName },
            onSelect = { category = it }
        )
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { Text("Address") },
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            label = { Text("Phone Number") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = gstin,
            onValueChange = { gstin = it },
            label = { Text("GSTIN (Optional)") },
            singleLine = true,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = header,
            onValueChange = { header = it },
            label = { Text("Receipt Header") },
            singleLine = true,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = footer,
            onValueChange = { footer = it },
            label = { Text("Receipt Footer") },
            singleLine = true,
            colors = smavOutlinedFieldColors(),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SuperadminAdminsScreen(
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var admins by remember { mutableStateOf<List<OutletAdminItem>>(emptyList()) }
    var outlets by remember { mutableStateOf<List<AdminOutletItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var banner by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }

    var showCreateDialog by remember { mutableStateOf(false) }
    var resetTarget by remember { mutableStateOf<OutletAdminItem?>(null) }
    var editTarget by remember { mutableStateOf<OutletAdminItem?>(null) }
    var confirmToggleAdmin by remember { mutableStateOf<OutletAdminItem?>(null) }

    fun load() {
        scope.launch {
            loading = true
            errorMsg = null
            adminRepo.getSuperadminAdmins()
                .onSuccess { admins = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) {
                        onUnauthorized(err.message ?: "Session expired.")
                        return@launch
                    }
                    errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            adminRepo.getSuperadminOutlets().onSuccess { outlets = it }
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    val filtered = remember(admins, search) {
        val q = search.trim().lowercase(Locale.ENGLISH)
        if (q.isBlank()) admins else admins.filter {
            it.fullName.lowercase(Locale.ENGLISH).contains(q) ||
                it.email.lowercase(Locale.ENGLISH).contains(q) ||
                it.username.lowercase(Locale.ENGLISH).contains(q)
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SmavGradientButton(
                    text = "Add Outlet Admin",
                    icon = Icons.Default.PersonAdd,
                    onClick = { showCreateDialog = true }
                )
                SmavSecondaryButton(
                    text = "Refresh",
                    icon = Icons.Default.Refresh,
                    enabled = !loading,
                    onClick = { load() }
                )
            }
        }

        item {
            SearchField(search, { search = it }, "Search administrators by name or email")
        }

        if (banner != null) {
            item { SmavSuccessBannerCard(banner!!) }
        }

        if (errorMsg != null) {
            item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }
        }

        if (loading || busy) {
            item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        }

        if (!loading && filtered.isEmpty()) {
            item { EmptyStateCard("No Administrators Found", "No outlet admin accounts matched your search.", Icons.Default.SupervisorAccount) }
        }

        items(filtered, key = { it.userId }) { admin ->
            val primaryOutletCode = admin.memberships.firstOrNull()?.outletCode ?: "glossylooks"
            SmavCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                        Text(admin.fullName, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(admin.email, color = SmavColors.TextSecondary, fontSize = 12.sp)
                        if (admin.username.isNotBlank()) {
                            Text("Username: ${admin.username}", color = SmavColors.InfoText, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                    StatusBadgeChip(
                        text = if (admin.isActive) "Active" else "Disabled",
                        color = if (admin.isActive) SmavColors.StepperGreen else SmavColors.DangerText
                    )
                }

                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    admin.memberships.forEach { m ->
                        StatusBadgeChip(text = "${m.outletName.ifBlank { m.outletCode }} (${m.role})", color = SmavColors.InfoText)
                    }
                    StatusBadgeChip(
                        text = "Sync: ${admin.syncStatus}",
                        color = if (admin.syncStatus == "synced") SmavColors.StepperGreen else SmavColors.WarningText
                    )
                    if (admin.mustChangePassword) {
                        StatusBadgeChip(text = "Temp Password Pending", color = SmavColors.WarningText)
                    }
                }

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmavSecondaryButton(
                        text = "Edit",
                        onClick = { editTarget = admin }
                    )
                    SmavSecondaryButton(
                        text = "Reset Password",
                        icon = Icons.Default.LockReset,
                        onClick = { resetTarget = admin }
                    )
                    SmavSecondaryButton(
                        text = if (admin.isActive) "Disable" else "Enable",
                        textColor = if (admin.isActive) SmavColors.DangerText else SmavColors.StepperGreen,
                        onClick = {
                            if (admin.isActive) {
                                confirmToggleAdmin = admin
                            } else {
                                busy = true
                                scope.launch {
                                    adminRepo.setOutletUserStatus(
                                        userId = admin.userId,
                                        email = admin.email,
                                        outletCode = primaryOutletCode,
                                        isActive = true
                                    ).onSuccess { msg ->
                                        banner = msg
                                        load()
                                    }.onFailure { err ->
                                        errorMsg = SmavApiClient.friendlyThrowable(err)
                                    }
                                    busy = false
                                }
                            }
                        }
                    )
                }
            }
        }
    }

    confirmToggleAdmin?.let { target ->
        val primaryOutletCode = target.memberships.firstOrNull()?.outletCode ?: "glossylooks"
        AlertDialog(
            onDismissRequest = { confirmToggleAdmin = null },
            containerColor = SmavColors.Surface,
            title = { Text("Disable ${target.fullName}?", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "This administrator will be blocked from signing in until re-enabled.",
                    color = SmavColors.TextSecondary
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        confirmToggleAdmin = null
                        busy = true
                        scope.launch {
                            adminRepo.setOutletUserStatus(
                                userId = target.userId,
                                email = target.email,
                                outletCode = primaryOutletCode,
                                isActive = false
                            ).onSuccess { msg ->
                                banner = msg
                                load()
                            }.onFailure { err ->
                                errorMsg = SmavApiClient.friendlyThrowable(err)
                            }
                            busy = false
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = SmavColors.DangerText, contentColor = Color.White)
                ) { Text("Disable") }
            },
            dismissButton = {
                TextButton(onClick = { confirmToggleAdmin = null }) {
                    Text("Cancel", color = SmavColors.TextSecondary)
                }
            }
        )
    }

    if (showCreateDialog) {
        var fullName by remember { mutableStateOf("") }
        var email by remember { mutableStateOf("") }
        var username by remember { mutableStateOf("") }
        var phone by remember { mutableStateOf("") }
        var selectedOutletCode by remember { mutableStateOf(outlets.firstOrNull()?.code ?: "glossylooks") }
        var initialPassword by remember { mutableStateOf("") }

        MobileFormDialog(
            title = "Add Outlet Administrator",
            onDismiss = { showCreateDialog = false },
            confirmText = "Create Admin",
            confirmEnabled = fullName.isNotBlank() && email.contains("@") && initialPassword.length >= 8,
            onConfirm = {
                scope.launch {
                    adminRepo.createSuperadminAdmin(fullName, email, username, phone, selectedOutletCode, initialPassword)
                        .onSuccess { msg ->
                            showCreateDialog = false
                            banner = msg
                            load()
                        }
                        .onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                }
            }
        ) {
            OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("Full Name") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email Address") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username (optional)") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            if (outlets.isNotEmpty()) {
                Text("Assign Outlet", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                FilterFlowRow(
                    items = outlets.map { it.code },
                    selected = selectedOutletCode,
                    labelOf = { code -> outlets.firstOrNull { it.code == code }?.name ?: code },
                    onSelect = { selectedOutletCode = it }
                )
            }
            SmavPasswordField(
                label = "Initial Password (min 8 chars)",
                value = initialPassword,
                onValueChange = { initialPassword = it },
                placeholder = "Minimum 8 characters"
            )
        }
    }

    editTarget?.let { target ->
        var fullName by remember { mutableStateOf(target.fullName) }
        var username by remember { mutableStateOf(target.username) }
        var phone by remember { mutableStateOf(target.phone) }
        val outletCode = target.memberships.firstOrNull()?.outletCode ?: "glossylooks"

        MobileFormDialog(
            title = "Edit Administrator",
            onDismiss = { editTarget = null },
            confirmText = "Save",
            confirmEnabled = fullName.isNotBlank(),
            onConfirm = {
                scope.launch {
                    adminRepo.createOrUpdateOutletUser(
                        existingUserId = target.userId,
                        fullName = fullName,
                        username = username,
                        email = target.email,
                        phone = phone,
                        role = "ADMIN",
                        outletCode = outletCode,
                        initialPassword = null
                    ).onSuccess { msg ->
                        editTarget = null
                        banner = msg
                        load()
                    }.onFailure { err ->
                        errorMsg = SmavApiClient.friendlyThrowable(err)
                    }
                }
            }
        ) {
            Text(target.email, color = SmavColors.InfoText, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("Full Name") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone") }, singleLine = true, colors = smavOutlinedFieldColors(), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth())
        }
    }

    resetTarget?.let { target ->
        var newPass by remember { mutableStateOf("") }
        val outletCode = target.memberships.firstOrNull()?.outletCode ?: "glossylooks"
        MobileFormDialog(
            title = "Reset Admin Password",
            onDismiss = { resetTarget = null },
            confirmText = "Reset Password",
            confirmEnabled = newPass.length >= 8,
            onConfirm = {
                scope.launch {
                    adminRepo.resetSuperadminAdminPassword(target.userId, target.email, outletCode, newPass)
                        .onSuccess { msg ->
                            resetTarget = null
                            banner = msg
                            load()
                        }
                        .onFailure { err ->
                            errorMsg = SmavApiClient.friendlyThrowable(err)
                        }
                }
            }
        ) {
            Text("Issue temporary password for ${target.fullName} (${target.email})", color = SmavColors.TextSecondary, fontSize = 13.sp)
            SmavPasswordField(
                label = "New Temporary Password (min 8 chars)",
                value = newPass,
                onValueChange = { newPass = it },
                placeholder = "Minimum 8 characters"
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SuperadminDiagnosticsScreen(
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var outlets by remember { mutableStateOf<List<AdminOutletItem>>(emptyList()) }
    var selectedOutletId by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var results by remember { mutableStateOf<List<CatalogDiagnosticItem>>(emptyList()) }

    LaunchedEffect(Unit) {
        adminRepo.getSuperadminOutlets()
            .onSuccess { list ->
                outlets = list
                if (selectedOutletId.isBlank() && list.isNotEmpty()) {
                    selectedOutletId = list.first().id
                }
            }
            .onFailure { err ->
                if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                else errorMsg = SmavApiClient.friendlyThrowable(err)
            }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            SmavCard {
                Text("Catalog Sync Diagnostics (Read-Only)", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Text(
                    "Inspect live upstream outlet catalogs, central Supabase preview counts, incremental revisions, and import preflight safely without writing production data.",
                    color = SmavColors.TextSecondary,
                    fontSize = 12.sp
                )

                if (outlets.isNotEmpty()) {
                    Text("Selected Outlet:", color = SmavColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    FilterFlowRow(
                        items = outlets.map { it.id },
                        selected = selectedOutletId,
                        labelOf = { id -> outlets.firstOrNull { it.id == id }?.name ?: id },
                        onSelect = { selectedOutletId = it }
                    )
                }

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmavSecondaryButton(
                        text = "Check Source Catalog",
                        enabled = !busy && selectedOutletId.isNotBlank(),
                        onClick = {
                            if (selectedOutletId.isBlank()) {
                                errorMsg = "Please select an outlet."
                            } else {
                                busy = true
                                errorMsg = null
                                scope.launch {
                                    adminRepo.runSourceCatalogCheck(selectedOutletId)
                                        .onSuccess { results = listOf(it) + results }
                                        .onFailure { errorMsg = SmavApiClient.friendlyThrowable(it) }
                                    busy = false
                                }
                            }
                        }
                    )

                    SmavSecondaryButton(
                        text = "Preview Central Catalog",
                        enabled = !busy && selectedOutletId.isNotBlank(),
                        onClick = {
                            if (selectedOutletId.isBlank()) {
                                errorMsg = "Please select an outlet."
                            } else {
                                busy = true
                                errorMsg = null
                                scope.launch {
                                    adminRepo.runCatalogPreviewCheck(selectedOutletId)
                                        .onSuccess { results = listOf(it) + results }
                                        .onFailure { errorMsg = SmavApiClient.friendlyThrowable(it) }
                                    busy = false
                                }
                            }
                        }
                    )

                    SmavSecondaryButton(
                        text = "Incremental Changes",
                        enabled = !busy && selectedOutletId.isNotBlank(),
                        onClick = {
                            if (selectedOutletId.isBlank()) {
                                errorMsg = "Please select an outlet."
                            } else {
                                busy = true
                                errorMsg = null
                                scope.launch {
                                    adminRepo.runCatalogChangesCheck(selectedOutletId)
                                        .onSuccess { results = listOf(it) + results }
                                        .onFailure { errorMsg = SmavApiClient.friendlyThrowable(it) }
                                    busy = false
                                }
                            }
                        }
                    )

                    SmavGradientButton(
                        text = "Run Catalog Import Preflight",
                        enabled = !busy && selectedOutletId.isNotBlank(),
                        onClick = {
                            if (selectedOutletId.isBlank()) {
                                errorMsg = "Please select an outlet."
                            } else {
                                busy = true
                                errorMsg = null
                                scope.launch {
                                    adminRepo.runCatalogImportPreflight(selectedOutletId)
                                        .onSuccess { results = listOf(it) + results }
                                        .onFailure { errorMsg = SmavApiClient.friendlyThrowable(it) }
                                    busy = false
                                }
                            }
                        }
                    )
                }
            }
        }

        if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!) }

        items(results) { item ->
            SmavCard {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(item.checkType, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    StatusBadgeChip(
                        text = if (item.fresh) "Fresh" else "Derived/Cache",
                        color = if (item.fresh) SmavColors.StepperGreen else SmavColors.WarningText
                    )
                }
                if (item.outletCode.isNotBlank() || item.source.isNotBlank()) {
                    Text("Outlet: ${item.outletCode} • Source: ${item.source}", color = SmavColors.InfoText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
                Text(item.summary, color = SmavColors.TextSecondary, fontSize = 13.sp)
                if (item.warning != null) {
                    Text("Warning: ${item.warning}", color = SmavColors.WarningText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
    }
}

@Composable
fun SuperadminReportsScreen(
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var report by remember { mutableStateOf<NetworkReportData?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var selectedRange by remember { mutableStateOf("All Time") }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            adminRepo.getSuperadminReports()
                .onSuccess { report = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Authorized Network Reports", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = SmavColors.InfoText)
                }
            }
        }

        item {
            FilterFlowRow(
                items = listOf("All Time", "Today", "This Week", "This Month"),
                selected = selectedRange,
                labelOf = { it },
                onSelect = { selectedRange = it }
            )
            if (selectedRange != "All Time") {
                Text(
                    "Note: Backend summary currently aggregates active synchronized totals across outlets.",
                    color = SmavColors.WarningText,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }

        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        report?.let { r ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SummaryStatCard("Registered / Active Outlets", "${r.activeOutlets} / ${r.totalOutlets}", accent = SmavColors.InfoText)
                    SummaryStatCard("Total Network Revenue", "Rs. ${String.format(Locale.ENGLISH, "%.2f", r.totalRevenue)}", accent = SmavColors.StepperGreen)
                    SummaryStatCard("Total Transactions", "${r.totalTransactions}", "Paired devices: ${r.pairedDevicesCount}", accent = SmavColors.TextPrimary)
                }
            }

            item {
                Text("Outlet Breakdown", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }

            items(r.breakdown, key = { it.id }) { item ->
                SmavCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                            Text(item.name, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text("${item.businessType.displayName} • ${item.code}", color = SmavColors.InfoText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        }
                        StatusBadgeChip(
                            text = if (item.supabaseConnected) "Live DB" else "Local/Unlinked",
                            color = if (item.supabaseConnected) SmavColors.StepperGreen else SmavColors.TextSecondary
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Revenue: Rs. ${String.format(Locale.ENGLISH, "%.2f", item.revenue)}",
                            style = SmavNumericStyles.Price,
                            color = SmavColors.StepperGreen
                        )
                        Text(
                            text = "Bills: ${item.transactionCount}",
                            style = SmavNumericStyles.Price.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
                            color = SmavColors.TextSecondary
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun SuperadminAuditLogsScreen(
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var logs by remember { mutableStateOf<List<AuditLogItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var expandedId by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            adminRepo.getSuperadminAuditLogs()
                .onSuccess { logs = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    val filtered = remember(logs, query) {
        val q = query.trim().lowercase(Locale.ENGLISH)
        if (q.isBlank()) logs else logs.filter {
            it.eventType.lowercase(Locale.ENGLISH).contains(q) ||
                it.actorEmail.lowercase(Locale.ENGLISH).contains(q)
        }
    }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Security Audit Logs", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = SmavColors.InfoText)
                }
            }
        }

        item { SearchField(query, { query = it }, "Filter logs by event type or actor") }
        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        items(filtered) { log ->
            val isExpanded = expandedId == log.id
            SmavCard(onClick = { expandedId = if (isExpanded) null else log.id }) {
                Text(log.eventType, color = SmavColors.AccentPink, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Text("Actor: ${log.actorEmail}", color = SmavColors.TextPrimary, fontSize = 12.sp)
                Text(log.timestamp, color = SmavColors.TextSecondary, fontSize = 11.sp)
                if (isExpanded && log.detailsJson.isNotBlank()) {
                    HorizontalDivider(color = SmavColors.Border, modifier = Modifier.padding(vertical = 4.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(SmavColors.SurfaceSubtle, RoundedCornerShape(8.dp))
                            .padding(8.dp)
                    ) {
                        Text(log.detailsJson, color = SmavColors.TextSecondary, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

@Composable
fun SuperadminSupabaseStatusScreen(
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var data by remember { mutableStateOf<CentralSupabaseStatusData?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            adminRepo.getCentralSupabaseStatus()
                .onSuccess { data = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    LazyColumn(
        state = listState,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp),
        contentPadding = PaddingValues(vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Central Supabase & RLS Status", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = SmavColors.InfoText)
                }
            }
        }

        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        data?.let { s ->
            item {
                SmavCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Connection Status", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        StatusBadgeChip(
                            text = if (s.connected) "Connected" else "Offline / Disconnected",
                            color = if (s.connected) SmavColors.StepperGreen else SmavColors.DangerText
                        )
                    }
                    if (s.projectUrl.isNotBlank()) {
                        Text("Project URL: ${s.projectUrl}", color = SmavColors.InfoText, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (s.publishableKeyPreview.isNotBlank()) {
                        Text("Publishable Key: ${s.publishableKeyPreview}", color = SmavColors.TextSecondary, fontSize = 12.sp)
                    }
                }
            }

            if (s.tableStatus.isNotEmpty()) {
                item {
                    SmavCard {
                        Text("Central RLS Tables", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        s.tableStatus.forEach { (table, ok) ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(table, color = SmavColors.TextSecondary, fontSize = 13.sp)
                                StatusBadgeChip(
                                    text = if (ok) "OK" else "Blocked/Error",
                                    color = if (ok) SmavColors.StepperGreen else SmavColors.DangerText
                                )
                            }
                        }
                    }
                }
            }

            if (s.profileEmail.isNotBlank()) {
                item {
                    SmavCard {
                        Text("Authenticated RLS Profile", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Text("Name: ${s.profileFullName}", color = SmavColors.TextPrimary, fontSize = 13.sp)
                        Text("Email: ${s.profileEmail}", color = SmavColors.TextSecondary, fontSize = 12.sp)
                        Text("Platform Role: ${s.profilePlatformRole}", color = SmavColors.InfoText, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                        if (s.profileSource.isNotBlank()) {
                            Text("Source: ${s.profileSource}", color = SmavColors.StepperGreen, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
        }
    }
}
