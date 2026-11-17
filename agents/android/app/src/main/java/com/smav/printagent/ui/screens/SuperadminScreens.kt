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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.data.repository.AdminNetworkRepository
import com.smav.printagent.model.*
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.*
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
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF141B36)),
                border = BorderStroke(1.dp, Color(0xFF2B355F)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Enterprise Multi-Outlet Network", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                            Text("Select any outlet to inspect, edit, or launch Auditor POS", color = Color(0xFF94A3B8), fontSize = 12.sp)
                        }
                        IconButton(onClick = { loadData() }, enabled = !loading) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh outlets", tint = Sky400)
                        }
                    }

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = { editingOutlet = null; showOutletForm = true },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.AddBusiness, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Add New Outlet", fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
                            onClick = { onOpenRoute(SmavRoute.SUPERADMIN_ADMINS) },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Admins (${admins.size})")
                        }
                    }
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
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Emerald500.copy(alpha = 0.16f)),
                    border = BorderStroke(1.dp, Emerald500.copy(alpha = 0.45f)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(statusBanner!!, color = Emerald500, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }

        if (errorMsg != null) {
            item { ErrorBannerCard(errorMsg!!, onRetry = { loadData() }) }
        }

        if (loading || busyAction) {
            item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
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

            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (isSelected) Color(0xFF1A2244) else Color(0xFF121629)
                ),
                border = BorderStroke(1.dp, if (isSelected) Sky400 else Color(0xFF252E54)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = outlet.name,
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            )
                            Text(
                                text = "${outlet.businessType.displayName} • Code: ${outlet.code.uppercase(Locale.ENGLISH)}",
                                color = Sky400,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        StatusBadgeChip(
                            text = if (outlet.isActive) "Active" else "Disabled",
                            color = if (outlet.isActive) Emerald500 else Rose600
                        )
                    }

                    if (outlet.address.isNotBlank()) {
                        Text(outlet.address, color = Color(0xFF94A3B8), fontSize = 12.sp)
                    }

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        StatusBadgeChip(text = "Admins: $adminCount", color = Color(0xFFCBD5E1))
                        if (outlet.supabaseUrl.isNotBlank()) {
                            StatusBadgeChip(text = "Supabase Linked", color = Emerald500)
                        }
                        if (isSelected) {
                            StatusBadgeChip(text = "Active Context", color = Sky400)
                        }
                    }

                    HorizontalDivider(color = Color(0xFF232C52))

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
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
                            },
                            enabled = !busyAction && outlet.isActive && outlet.businessType != BusinessType.OTHER,
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.PointOfSale, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Launch POS", fontWeight = FontWeight.Bold)
                        }

                        OutlinedButton(
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
                            },
                            enabled = !busyAction && outlet.isActive,
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Text("Select Context")
                        }

                        OutlinedButton(
                            onClick = { editingOutlet = outlet; showOutletForm = true },
                            enabled = !busyAction,
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Edit")
                        }

                        OutlinedButton(
                            onClick = { confirmToggleOutlet = outlet },
                            enabled = !busyAction,
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Text(
                                if (outlet.isActive) "Disable" else "Enable",
                                color = if (outlet.isActive) Rose600 else Emerald500
                            )
                        }
                    }
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
            containerColor = Color(0xFF121629),
            title = {
                Text(
                    if (target.isActive) "Disable ${target.name}?" else "Enable ${target.name}?",
                    color = Color.White,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    if (target.isActive) "Staff and POS terminals assigned to this outlet will be blocked from signing in until re-enabled."
                    else "This outlet will become active for billing and authentication.",
                    color = Color(0xFFCBD5E1)
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
                    colors = ButtonDefaults.buttonColors(containerColor = if (target.isActive) Rose600 else Emerald500)
                ) { Text(if (target.isActive) "Disable" else "Enable") }
            },
            dismissButton = {
                TextButton(onClick = { confirmToggleOutlet = null }) { Text("Cancel") }
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
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            label = { Text("Outlet Code (e.g. glossylooks, mozz)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Text("Business Category", color = Color(0xFFCBD5E1), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
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
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = phone,
            onValueChange = { phone = it },
            label = { Text("Phone Number") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = gstin,
            onValueChange = { gstin = it },
            label = { Text("GSTIN (Optional)") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = header,
            onValueChange = { header = it },
            label = { Text("Receipt Header") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = footer,
            onValueChange = { footer = it },
            label = { Text("Receipt Footer") },
            singleLine = true,
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
                Button(
                    onClick = { showCreateDialog = true },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Add Outlet Admin", fontWeight = FontWeight.Bold)
                }
                OutlinedButton(
                    onClick = { load() },
                    enabled = !loading,
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Refresh")
                }
            }
        }

        item {
            SearchField(search, { search = it }, "Search administrators by name or email")
        }

        if (banner != null) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Emerald500.copy(alpha = 0.16f)),
                    border = BorderStroke(1.dp, Emerald500.copy(alpha = 0.45f))
                ) {
                    Text(banner!!, color = Emerald500, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }

        if (errorMsg != null) {
            item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }
        }

        if (loading || busy) {
            item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        }

        if (!loading && filtered.isEmpty()) {
            item { EmptyStateCard("No Administrators Found", "No outlet admin accounts matched your search.", Icons.Default.SupervisorAccount) }
        }

        items(filtered, key = { it.userId }) { admin ->
            val primaryOutletCode = admin.memberships.firstOrNull()?.outletCode ?: "glossylooks"
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(admin.fullName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Text(admin.email, color = Color(0xFF94A3B8), fontSize = 12.sp)
                            if (admin.username.isNotBlank()) {
                                Text("Username: ${admin.username}", color = Sky400, fontSize = 11.sp)
                            }
                        }
                        StatusBadgeChip(
                            text = if (admin.isActive) "Active" else "Disabled",
                            color = if (admin.isActive) Emerald500 else Rose600
                        )
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        admin.memberships.forEach { m ->
                            StatusBadgeChip(text = "${m.outletName.ifBlank { m.outletCode }} (${m.role})", color = Sky400)
                        }
                        StatusBadgeChip(
                            text = "Sync: ${admin.syncStatus}",
                            color = if (admin.syncStatus == "synced") Emerald500 else Amber500
                        )
                        if (admin.mustChangePassword) {
                            StatusBadgeChip(text = "Temp Password Pending", color = Amber500)
                        }
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { editTarget = admin },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Text("Edit")
                        }
                        OutlinedButton(
                            onClick = { resetTarget = admin },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.LockReset, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Reset Password")
                        }
                        OutlinedButton(
                            onClick = {
                                busy = true
                                scope.launch {
                                    adminRepo.setOutletUserStatus(
                                        userId = admin.userId,
                                        email = admin.email,
                                        outletCode = primaryOutletCode,
                                        isActive = !admin.isActive
                                    ).onSuccess { msg ->
                                        banner = msg
                                        load()
                                    }.onFailure { err ->
                                        errorMsg = SmavApiClient.friendlyThrowable(err)
                                    }
                                    busy = false
                                }
                            },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Text(
                                if (admin.isActive) "Disable" else "Enable",
                                color = if (admin.isActive) Rose600 else Emerald500
                            )
                        }
                    }
                }
            }
        }
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
            OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("Full Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email Address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (outlets.isNotEmpty()) {
                Text("Assign Outlet", color = Color(0xFFCBD5E1), fontSize = 12.sp)
                FilterFlowRow(
                    items = outlets.map { it.code },
                    selected = selectedOutletCode,
                    labelOf = { code -> outlets.firstOrNull { it.code == code }?.name ?: code },
                    onSelect = { selectedOutletCode = it }
                )
            }
            OutlinedTextField(
                value = initialPassword,
                onValueChange = { initialPassword = it },
                label = { Text("Initial Password (min 8 chars)") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
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
            Text(target.email, color = Sky400, fontSize = 13.sp)
            OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("Full Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone") }, singleLine = true, modifier = Modifier.fillMaxWidth())
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
            Text("Issue temporary password for ${target.fullName} (${target.email})", color = Color(0xFFCBD5E1), fontSize = 13.sp)
            OutlinedTextField(
                value = newPass,
                onValueChange = { newPass = it },
                label = { Text("New Temporary Password (min 8 chars)") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
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
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF141B36)),
                border = BorderStroke(1.dp, Color(0xFF2B355F)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Catalog Sync Diagnostics (Read-Only)", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(
                        "Inspect live upstream outlet catalogs, central Supabase preview counts, incremental revisions, and import preflight safely without writing production data.",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp
                    )

                    if (outlets.isNotEmpty()) {
                        Text("Selected Outlet:", color = Color(0xFFCBD5E1), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        FilterFlowRow(
                            items = outlets.map { it.id },
                            selected = selectedOutletId,
                            labelOf = { id -> outlets.firstOrNull { it.id == id }?.name ?: id },
                            onSelect = { selectedOutletId = it }
                        )
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
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
                            },
                            enabled = !busy && selectedOutletId.isNotBlank(),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) { Text("Check Source Catalog") }

                        OutlinedButton(
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
                            },
                            enabled = !busy && selectedOutletId.isNotBlank(),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) { Text("Preview Central Catalog") }

                        OutlinedButton(
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
                            },
                            enabled = !busy && selectedOutletId.isNotBlank(),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) { Text("Incremental Changes") }

                        Button(
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
                            },
                            enabled = !busy && selectedOutletId.isNotBlank(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) { Text("Run Catalog Import Preflight", fontWeight = FontWeight.Bold) }
                    }
                }
            }
        }

        if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!) }

        items(results) { item ->
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(14.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(item.checkType, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        StatusBadgeChip(
                            text = if (item.fresh) "Fresh" else "Derived/Cache",
                            color = if (item.fresh) Emerald500 else Amber500
                        )
                    }
                    if (item.outletCode.isNotBlank() || item.source.isNotBlank()) {
                        Text("Outlet: ${item.outletCode} • Source: ${item.source}", color = Sky400, fontSize = 12.sp)
                    }
                    Text(item.summary, color = Color(0xFFCBD5E1), fontSize = 13.sp)
                    if (item.warning != null) {
                        Text("Warning: ${item.warning}", color = Amber500, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
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
                Text("Authorized Network Reports", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Sky400)
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
                    color = Amber500,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }

        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        report?.let { r ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SummaryStatCard("Registered / Active Outlets", "${r.activeOutlets} / ${r.totalOutlets}", accent = Sky400)
                    SummaryStatCard("Total Network Revenue", "Rs. ${String.format(Locale.ENGLISH, "%.2f", r.totalRevenue)}", accent = Emerald500)
                    SummaryStatCard("Total Transactions", "${r.totalTransactions}", "Paired devices: ${r.pairedDevicesCount}", accent = Amber500)
                }
            }

            item {
                Text("Outlet Breakdown", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }

            items(r.breakdown, key = { it.id }) { item ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                    border = BorderStroke(1.dp, Color(0xFF252E54)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(item.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text("${item.businessType.displayName} • ${item.code}", color = Sky400, fontSize = 12.sp)
                            }
                            StatusBadgeChip(
                                text = if (item.supabaseConnected) "Live DB" else "Local/Unlinked",
                                color = if (item.supabaseConnected) Emerald500 else Color(0xFF94A3B8)
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Revenue: Rs. ${String.format(Locale.ENGLISH, "%.2f", item.revenue)}", color = Emerald500, fontWeight = FontWeight.SemiBold)
                            Text("Bills: ${item.transactionCount}", color = Color(0xFFCBD5E1))
                        }
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
                Text("Security Audit Logs", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Sky400)
                }
            }
        }

        item { SearchField(query, { query = it }, "Filter logs by event type or actor") }
        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        items(filtered) { log ->
            val isExpanded = expandedId == log.id
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(14.dp),
                onClick = { expandedId = if (isExpanded) null else log.id }
            ) {
                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(log.eventType, color = Color(0xFFFF2D82), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("Actor: ${log.actorEmail}", color = Color.White, fontSize = 12.sp)
                    Text(log.timestamp, color = Color(0xFF94A3B8), fontSize = 11.sp)
                    if (isExpanded && log.detailsJson.isNotBlank()) {
                        HorizontalDivider(color = Color(0xFF232C52), modifier = Modifier.padding(vertical = 4.dp))
                        Text(log.detailsJson, color = Color(0xFFCBD5E1), fontSize = 11.sp)
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
                Text("Central Supabase & RLS Status", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Sky400)
                }
            }
        }

        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        data?.let { s ->
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                    border = BorderStroke(1.dp, Color(0xFF252E54)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Connection Status", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            StatusBadgeChip(
                                text = if (s.connected) "Connected" else "Offline / Disconnected",
                                color = if (s.connected) Emerald500 else Rose600
                            )
                        }
                        if (s.projectUrl.isNotBlank()) {
                            Text("Project URL: ${s.projectUrl}", color = Sky400, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                        if (s.publishableKeyPreview.isNotBlank()) {
                            Text("Publishable Key: ${s.publishableKeyPreview}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                        }
                    }
                }
            }

            if (s.tableStatus.isNotEmpty()) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                        border = BorderStroke(1.dp, Color(0xFF252E54)),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Central RLS Tables", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            s.tableStatus.forEach { (table, ok) ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(table, color = Color(0xFFCBD5E1), fontSize = 13.sp)
                                    StatusBadgeChip(
                                        text = if (ok) "OK" else "Blocked/Error",
                                        color = if (ok) Emerald500 else Rose600
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (s.profileEmail.isNotBlank()) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                        border = BorderStroke(1.dp, Color(0xFF252E54)),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Authenticated RLS Profile", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text("Name: ${s.profileFullName}", color = Color(0xFFCBD5E1), fontSize = 13.sp)
                            Text("Email: ${s.profileEmail}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                            Text("Platform Role: ${s.profilePlatformRole}", color = Sky400, fontSize = 12.sp)
                            if (s.profileSource.isNotBlank()) {
                                Text("Source: ${s.profileSource}", color = Emerald500, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}
