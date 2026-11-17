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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.data.repository.*
import com.smav.printagent.model.*
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.*
import kotlinx.coroutines.launch
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AdminDashboardScreen(
    session: StaffSession,
    pendingSyncCount: Int,
    adminRepo: AdminNetworkRepository,
    catalogRepo: CatalogSyncRepository,
    onNavigate: (SmavRoute) -> Unit,
    onOpenOutletSwitcher: () -> Unit,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var report by remember { mutableStateOf<OutletReportSummary?>(null) }
    var staffCount by remember { mutableStateOf(0) }
    var catalogCount by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            adminRepo.getAdminReports()
                .onSuccess { report = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) {
                        onUnauthorized(err.message ?: "Session expired.")
                        return@launch
                    }
                    errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            adminRepo.getOutletUsers(session.branchCode.ifBlank { null })
                .onSuccess { staffCount = it.size }
            catalogRepo.loadPosData(session.businessId, session.businessType)
                .onSuccess { b ->
                    catalogCount = when (b.businessType) {
                        BusinessType.SALON -> b.salonServices.size
                        BusinessType.RESTAURANT -> b.menuItems.size
                        BusinessType.RETAIL -> b.retailProducts.size
                        BusinessType.OTHER -> 0
                    }
                }
            loading = false
        }
    }

    LaunchedEffect(session.businessId) { load() }

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
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(session.businessName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                            Text(
                                "${session.businessType.displayName} • Code: ${session.branchCode.ifBlank { "N/A" }}",
                                color = Sky400,
                                fontSize = 12.sp
                            )
                        }
                        IconButton(onClick = { load() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Sky400)
                        }
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { onNavigate(SmavRoute.POS_BILLING) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.PointOfSale, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Open Outlet POS", fontWeight = FontWeight.Bold)
                        }
                        if (session.assignedOutlets.size > 1) {
                            OutlinedButton(
                                onClick = onOpenOutletSwitcher,
                                modifier = Modifier.heightIn(min = 48.dp)
                            ) {
                                Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Switch Outlet (${session.assignedOutlets.size})")
                            }
                        }
                    }
                }
            }
        }

        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SummaryStatCard(
                    title = "Outlet Sales Summary",
                    value = "Rs. ${String.format(Locale.ENGLISH, "%.2f", report?.totalSales ?: 0.0)}",
                    subtitle = "${report?.totalTransactions ?: 0} remote transactions",
                    accent = Emerald500
                )
                SummaryStatCard(
                    title = "Active Catalog Items",
                    value = "$catalogCount",
                    subtitle = session.businessType.displayName,
                    accent = Sky400
                )
                SummaryStatCard(
                    title = "Outlet Staff & POS Users",
                    value = "$staffCount",
                    subtitle = "Assigned to ${session.branchCode.ifBlank { session.businessName }}",
                    accent = Color(0xFFFF2D82)
                )
                SummaryStatCard(
                    title = "Offline Pending Sync",
                    value = "$pendingSyncCount",
                    subtitle = if (pendingSyncCount == 0) "All bills synced" else "Tap Sync Status to upload",
                    accent = if (pendingSyncCount == 0) Emerald500 else Amber500
                )
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Quick Actions", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { onNavigate(SmavRoute.ADMIN_STAFF) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Manage Staff")
                        }
                        OutlinedButton(onClick = { onNavigate(SmavRoute.ADMIN_CATALOG) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Catalog & Prices")
                        }
                        OutlinedButton(onClick = { onNavigate(SmavRoute.ADMIN_REPORTS) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Reports")
                        }
                        OutlinedButton(onClick = { onNavigate(SmavRoute.ADMIN_SYNC) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Sync & Outbox")
                        }
                        OutlinedButton(onClick = { onNavigate(SmavRoute.PRINTER_SETTINGS) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Printers")
                        }
                        OutlinedButton(onClick = { onNavigate(SmavRoute.ADMIN_SETTINGS) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Outlet Settings")
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AdminStaffScreen(
    session: StaffSession,
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var users by remember { mutableStateOf<List<OutletAdminItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var banner by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }

    var showCreate by remember { mutableStateOf(false) }
    var editUser by remember { mutableStateOf<OutletAdminItem?>(null) }
    var resetUser by remember { mutableStateOf<OutletAdminItem?>(null) }

    val outletCode = session.branchCode.ifBlank { session.assignedOutlets.firstOrNull { it.businessId == session.businessId }?.branchCode ?: "" }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            adminRepo.getOutletUsers(outletCode.ifBlank { null })
                .onSuccess { users = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(session.businessId) { load() }

    val filtered = remember(users, search) {
        val q = search.trim().lowercase(Locale.ENGLISH)
        if (q.isBlank()) users else users.filter {
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { showCreate = true },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Add POS Staff", fontWeight = FontWeight.Bold)
                }
                OutlinedButton(onClick = { load() }, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Refresh")
                }
            }
        }

        item { SearchField(search, { search = it }, "Search outlet staff by name or email") }

        if (banner != null) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Emerald500.copy(alpha = 0.16f))) {
                    Text(banner!!, color = Emerald500, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }
        if (loading || busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }

        if (!loading && filtered.isEmpty()) {
            item { EmptyStateCard("No Staff Found", "Add POS billing users for this outlet.", Icons.Default.Group) }
        }

        items(filtered, key = { it.userId }) { u ->
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(14.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(u.fullName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text(u.email, color = Color(0xFF94A3B8), fontSize = 12.sp)
                            Text("Role: ${u.displayRole.ifBlank { "POS_BILLING" }}", color = Sky400, fontSize = 12.sp)
                        }
                        StatusBadgeChip(
                            text = if (u.isActive) "Active" else "Disabled",
                            color = if (u.isActive) Emerald500 else Rose600
                        )
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { editUser = u }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Edit") }
                        OutlinedButton(onClick = { resetUser = u }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Reset Password") }
                        OutlinedButton(
                            onClick = {
                                busy = true
                                scope.launch {
                                    adminRepo.setOutletUserStatus(u.userId, u.email, outletCode, !u.isActive)
                                        .onSuccess { msg -> banner = msg; load() }
                                        .onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                                    busy = false
                                }
                            },
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Text(if (u.isActive) "Disable" else "Enable", color = if (u.isActive) Rose600 else Emerald500)
                        }
                    }
                }
            }
        }
    }

    if (showCreate) {
        var name by remember { mutableStateOf("") }
        var email by remember { mutableStateOf("") }
        var username by remember { mutableStateOf("") }
        var phone by remember { mutableStateOf("") }
        var pass by remember { mutableStateOf("") }
        MobileFormDialog(
            title = "Add POS Billing Staff",
            onDismiss = { showCreate = false },
            confirmText = "Create Staff",
            confirmEnabled = name.isNotBlank() && email.contains("@") && pass.length >= 8,
            onConfirm = {
                scope.launch {
                    adminRepo.createOrUpdateOutletUser(
                        existingUserId = null,
                        fullName = name,
                        username = username.ifBlank { email.substringBefore("@") },
                        email = email,
                        phone = phone,
                        role = "STAFF",
                        outletCode = outletCode,
                        initialPassword = pass
                    ).onSuccess { msg ->
                        showCreate = false; banner = msg; load()
                    }.onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                }
            }
        ) {
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Full Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email Address") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                value = pass,
                onValueChange = { pass = it },
                label = { Text("Temporary Password (min 8 chars)") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }

    editUser?.let { target ->
        var name by remember { mutableStateOf(target.fullName) }
        var username by remember { mutableStateOf(target.username) }
        var phone by remember { mutableStateOf(target.phone) }
        MobileFormDialog(
            title = "Edit Staff Profile",
            onDismiss = { editUser = null },
            confirmText = "Save",
            confirmEnabled = name.isNotBlank(),
            onConfirm = {
                scope.launch {
                    adminRepo.createOrUpdateOutletUser(
                        existingUserId = target.userId,
                        fullName = name,
                        username = username,
                        email = target.email,
                        phone = phone,
                        role = "STAFF",
                        outletCode = outletCode,
                        initialPassword = null
                    ).onSuccess { msg ->
                        editUser = null; banner = msg; load()
                    }.onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                }
            }
        ) {
            Text(target.email, color = Sky400, fontSize = 12.sp)
            OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Full Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = username, onValueChange = { username = it }, label = { Text("Username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = phone, onValueChange = { phone = it }, label = { Text("Phone") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
    }

    resetUser?.let { target ->
        var newPass by remember { mutableStateOf("") }
        MobileFormDialog(
            title = "Reset Staff Password",
            onDismiss = { resetUser = null },
            confirmText = "Reset Password",
            confirmEnabled = newPass.length >= 8,
            onConfirm = {
                scope.launch {
                    adminRepo.resetOutletUserPassword(target.userId, target.email, outletCode, newPass)
                        .onSuccess { msg -> resetUser = null; banner = msg; load() }
                        .onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                }
            }
        ) {
            Text("Issue temporary password for ${target.fullName}", color = Color(0xFFCBD5E1), fontSize = 13.sp)
            OutlinedTextField(
                value = newPass,
                onValueChange = { newPass = it },
                label = { Text("Temporary Password (min 8 chars)") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AdminCatalogScreen(
    session: StaffSession,
    adminRepo: AdminNetworkRepository,
    catalogRepo: CatalogSyncRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var bundle by remember { mutableStateOf<PosInitBundle?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var banner by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("All") }

    var showItemDialog by remember { mutableStateOf(false) }
    var editId by remember { mutableStateOf<String?>(null) }
    var editName by remember { mutableStateOf("") }
    var editCategory by remember { mutableStateOf("") }
    var editSubcategory by remember { mutableStateOf("") }
    var editPrice by remember { mutableStateOf("") }
    var editIsVeg by remember { mutableStateOf(true) }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            catalogRepo.loadPosData(session.businessId, session.businessType)
                .onSuccess { bundle = it; selectedCategory = "All" }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(session.businessId) { load() }

    val categories = remember(bundle, session.businessType) {
        val cats = when (session.businessType) {
            BusinessType.SALON -> bundle?.salonServices?.map { it.category }.orEmpty()
            BusinessType.RESTAURANT -> bundle?.menuItems?.map { it.category }.orEmpty()
            BusinessType.RETAIL -> bundle?.retailProducts?.map { it.category }.orEmpty()
            BusinessType.OTHER -> emptyList()
        }
        listOf("All") + cats.filter { it.isNotBlank() }.distinct().sorted()
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        editId = null; editName = ""; editCategory = ""; editSubcategory = ""; editPrice = ""; editIsVeg = true
                        showItemDialog = true
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(
                        when (session.businessType) {
                            BusinessType.SALON -> "Add Service"
                            BusinessType.RESTAURANT -> "Add Menu Item"
                            else -> "Add Product"
                        },
                        fontWeight = FontWeight.Bold
                    )
                }
                OutlinedButton(onClick = { load() }, enabled = !loading, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Refresh")
                }
            }
        }

        item { SearchField(search, { search = it }, "Search catalog items or prices") }
        if (categories.size > 1) {
            item { FilterFlowRow(categories, selectedCategory, { it }, { selectedCategory = it }) }
        }
        if (banner != null) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Emerald500.copy(alpha = 0.16f))) {
                    Text(banner!!, color = Emerald500, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }
        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }

        val q = search.trim().lowercase(Locale.ENGLISH)

        when (session.businessType) {
            BusinessType.SALON -> {
                val filtered = bundle?.salonServices.orEmpty().filter {
                    (selectedCategory == "All" || it.category == selectedCategory) &&
                        (q.isBlank() || it.name.lowercase(Locale.ENGLISH).contains(q) || it.category.lowercase(Locale.ENGLISH).contains(q))
                }
                items(filtered, key = { it.id }) { srv ->
                    CatalogEditableRowCard(
                        title = srv.name,
                        subtitle = "${srv.category}${if (srv.subcategory.isNotBlank()) " • ${srv.subcategory}" else ""}",
                        price = srv.price,
                        onEdit = {
                            editId = srv.id; editName = srv.name; editCategory = srv.category
                            editSubcategory = srv.subcategory; editPrice = srv.price.toString()
                            showItemDialog = true
                        }
                    )
                }
            }

            BusinessType.RESTAURANT -> {
                val filtered = bundle?.menuItems.orEmpty().filter {
                    (selectedCategory == "All" || it.category == selectedCategory) &&
                        (q.isBlank() || it.name.lowercase(Locale.ENGLISH).contains(q) || it.category.lowercase(Locale.ENGLISH).contains(q))
                }
                items(filtered, key = { it.id }) { m ->
                    CatalogEditableRowCard(
                        title = m.name,
                        subtitle = "${m.category} • ${if (m.isVeg) "VEG" else "NON-VEG"}",
                        price = m.basePrice,
                        onEdit = {
                            editId = m.id; editName = m.name; editCategory = m.category
                            editPrice = m.basePrice.toString(); editIsVeg = m.isVeg
                            showItemDialog = true
                        }
                    )
                }
            }

            BusinessType.RETAIL -> {
                val filtered = bundle?.retailProducts.orEmpty().filter {
                    (selectedCategory == "All" || it.category == selectedCategory) &&
                        (q.isBlank() || it.name.lowercase(Locale.ENGLISH).contains(q))
                }
                items(filtered, key = { it.id }) { p ->
                    CatalogEditableRowCard(
                        title = p.name,
                        subtitle = "${p.category} • Stock: ${p.stockQuantity}",
                        price = p.price,
                        onEdit = {
                            editId = p.id; editName = p.name; editCategory = p.category; editPrice = p.price.toString()
                            showItemDialog = true
                        }
                    )
                }
            }

            BusinessType.OTHER -> {
                item { EmptyStateCard("No POS Catalog", "Select a Salon, Restaurant, or Retail outlet.") }
            }
        }
    }

    if (showItemDialog) {
        val parsedPrice = editPrice.toDoubleOrNull()
        MobileFormDialog(
            title = if (editId == null) "Add Catalog Item" else "Update Item & Price",
            onDismiss = { showItemDialog = false },
            confirmText = "Save",
            confirmEnabled = editName.isNotBlank() && parsedPrice != null && parsedPrice >= 0.0,
            onConfirm = {
                val priceVal = parsedPrice ?: return@MobileFormDialog
                scope.launch {
                    val res = when (session.businessType) {
                        BusinessType.SALON -> adminRepo.saveSalonServiceItem(editId, editName, editCategory, editSubcategory, priceVal)
                        BusinessType.RESTAURANT -> adminRepo.saveRestaurantMenuItemRemote(editId, editName, editCategory, priceVal, editIsVeg)
                        else -> adminRepo.saveRetailProductRemote(editId, editName, editCategory, priceVal)
                    }
                    res.onSuccess {
                        showItemDialog = false
                        banner = "\"$editName\" saved at Rs. ${String.format(Locale.ENGLISH, "%.2f", priceVal)}"
                        load()
                    }.onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                }
            }
        ) {
            OutlinedTextField(value = editName, onValueChange = { editName = it }, label = { Text("Item Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = editCategory, onValueChange = { editCategory = it }, label = { Text("Category") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (session.businessType == BusinessType.SALON) {
                OutlinedTextField(value = editSubcategory, onValueChange = { editSubcategory = it }, label = { Text("Subcategory (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            if (session.businessType == BusinessType.RESTAURANT) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Switch(checked = editIsVeg, onCheckedChange = { editIsVeg = it })
                    Text(if (editIsVeg) "Vegetarian Dish" else "Non-Vegetarian Dish", color = Color.White)
                }
            }
            OutlinedTextField(
                value = editPrice,
                onValueChange = { editPrice = it },
                label = { Text("Price (Rs.)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun CatalogEditableRowCard(
    title: String,
    subtitle: String,
    price: Double,
    onEdit: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
        border = BorderStroke(1.dp, Color(0xFF252E54)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Text(subtitle, color = Color(0xFF94A3B8), fontSize = 12.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Rs. ${String.format(Locale.ENGLISH, "%.2f", price)}",
                    color = Emerald500,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp
                )
                IconButton(onClick = onEdit, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.Edit, contentDescription = "Edit Price", tint = Sky400)
                }
            }
        }
    }
}

@Composable
fun AdminReportsScreen(
    session: StaffSession,
    pendingSyncCount: Int,
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var summary by remember { mutableStateOf<OutletReportSummary?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            loading = true; errorMsg = null
            adminRepo.getAdminReports()
                .onSuccess { summary = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                    else errorMsg = SmavApiClient.friendlyThrowable(err)
                }
            loading = false
        }
    }

    LaunchedEffect(session.businessId) { load() }

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
                Text("Outlet Sales & Tax Report", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                IconButton(onClick = { load() }) { Icon(Icons.Default.Refresh, contentDescription = "Refresh", tint = Sky400) }
            }
        }

        if (loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!, onRetry = { load() }) }

        summary?.let { s ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SummaryStatCard("Total Sales (${s.outletName.ifBlank { session.businessName }})", "Rs. ${String.format(Locale.ENGLISH, "%.2f", s.totalSales)}", accent = Emerald500)
                    SummaryStatCard("Total Tax Collected", "Rs. ${String.format(Locale.ENGLISH, "%.2f", s.totalTax)}", accent = Sky400)
                    SummaryStatCard("Remote Synced Transactions", "${s.totalTransactions}", "Pending device queue: $pendingSyncCount", accent = Amber500)
                }
            }

            if (s.transactions.isEmpty()) {
                item { EmptyStateCard("No Synced Transactions Yet", "New bills created on POS will appear here after sync.") }
            } else {
                items(s.transactions, key = { it.id }) { tx ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                        border = BorderStroke(1.dp, Color(0xFF252E54)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(tx.referenceNumber, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text("${tx.subtitle} • ${tx.paymentMode.uppercase(Locale.ENGLISH)}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                            }
                            Text("Rs. ${String.format(Locale.ENGLISH, "%.2f", tx.grandTotal)}", color = Emerald500, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AdminSyncScreen(
    session: StaffSession,
    pendingSyncCount: Int,
    adminRepo: AdminNetworkRepository,
    syncRepo: SyncRepository,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var outbox by remember { mutableStateOf<List<SyncOutboxItemDto>>(emptyList()) }
    var syncSummary by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    fun load() {
        scope.launch {
            busy = true; errorMsg = null
            adminRepo.getSyncOutbox(session.branchCode.ifBlank { null })
                .onSuccess { outbox = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) {
                        onUnauthorized(err.message ?: "Session expired.")
                        return@launch
                    }
                }
            adminRepo.getAdminSyncSummary().onSuccess { syncSummary = it }
            busy = false
        }
    }

    LaunchedEffect(session.businessId) { load() }

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
                    Text("Offline Billing Queue & Sync Outbox", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text("Pending local bills on this device: $pendingSyncCount", color = if (pendingSyncCount > 0) Amber500 else Emerald500, fontWeight = FontWeight.SemiBold)
                    if (syncSummary.isNotBlank()) {
                        Text(syncSummary, color = Color(0xFF94A3B8), fontSize = 12.sp)
                    }
                    Button(
                        onClick = {
                            busy = true; message = null; errorMsg = null
                            scope.launch {
                                syncRepo.syncAllPending()
                                    .onSuccess { count ->
                                        message = if (count > 0) "Synced $count transaction(s) to cloud." else "No pending outlet transactions needed upload."
                                        load()
                                    }
                                    .onFailure { err ->
                                        if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
                                        else errorMsg = SmavApiClient.friendlyThrowable(err)
                                    }
                                busy = false
                            }
                        },
                        enabled = !busy,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    ) {
                        Icon(Icons.Default.CloudSync, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Sync Pending Device Bills Now", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (message != null) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Emerald500.copy(alpha = 0.16f))) {
                    Text(message!!, color = Emerald500, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
                }
            }
        }
        if (errorMsg != null) item { ErrorBannerCard(errorMsg!!) }

        item { Text("User Provisioning Sync Outbox", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp) }

        if (outbox.isEmpty()) {
            item { EmptyStateCard("Outbox Clear", "No pending staff sync records in the server outbox.") }
        } else {
            items(outbox, key = { it.id }) { item ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                    border = BorderStroke(1.dp, Color(0xFF252E54)),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(item.targetLabel, color = Color.White, fontWeight = FontWeight.SemiBold)
                            StatusBadgeChip(
                                text = item.status,
                                color = if (item.status == "SYNCED") Emerald500 else Amber500
                            )
                        }
                        if (item.lastError != null) {
                            Text(item.lastError, color = Color(0xFFFDA4AF), fontSize = 12.sp)
                        }
                        if (item.status != "SYNCED") {
                            OutlinedButton(
                                onClick = {
                                    busy = true
                                    scope.launch {
                                        adminRepo.retrySyncOutbox(item.id)
                                            .onSuccess { msg -> message = msg; load() }
                                            .onFailure { err -> errorMsg = SmavApiClient.friendlyThrowable(err) }
                                        busy = false
                                    }
                                },
                                modifier = Modifier.heightIn(min = 44.dp)
                            ) { Text("Retry Outbox Item") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AdminSettingsScreen(
    session: StaffSession,
    sessionManager: SessionManager,
    adminRepo: AdminNetworkRepository,
    onOpenPrinterSettings: () -> Unit,
    onOpenOutletSwitcher: () -> Unit,
    onUnauthorized: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var outlet by remember { mutableStateOf<AdminOutletItem?>(null) }
    var receiptHeader by remember(session.businessId) {
        mutableStateOf(sessionManager.getReceiptHeader(session.businessId, session.businessName))
    }
    var receiptFooter by remember(session.businessId) {
        mutableStateOf(sessionManager.getReceiptFooter(session.businessId, "Thank you! Visit us again."))
    }
    var savedMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(session.businessId) {
        adminRepo.getAdminOutletDetails()
            .onSuccess { o ->
                outlet = o
                receiptHeader = sessionManager.getReceiptHeader(session.businessId, o.receiptHeader.ifBlank { o.name })
                receiptFooter = sessionManager.getReceiptFooter(session.businessId, o.receiptFooter.ifBlank { "Thank you! Visit us again." })
            }
            .onFailure { err ->
                if (err is UnauthorizedSessionException) onUnauthorized(err.message ?: "Session expired.")
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
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Outlet Profile", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text("Name: ${outlet?.name ?: session.businessName}", color = Color(0xFFCBD5E1), fontSize = 13.sp)
                    Text("Category: ${session.businessType.displayName}", color = Sky400, fontSize = 13.sp)
                    Text("Code: ${outlet?.code ?: session.branchCode}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    if (!outlet?.address.isNullOrBlank()) Text("Address: ${outlet!!.address}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    if (!outlet?.phone.isNullOrBlank()) Text("Phone: ${outlet!!.phone}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    if (!outlet?.gstin.isNullOrBlank()) Text("GSTIN: ${outlet!!.gstin}", color = Color(0xFF94A3B8), fontSize = 12.sp)
                    if (session.assignedOutlets.size > 1) {
                        OutlinedButton(
                            onClick = onOpenOutletSwitcher,
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp).heightIn(min = 48.dp)
                        ) { Text("Switch Active Outlet") }
                    }
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                border = BorderStroke(1.dp, Color(0xFF252E54)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Device Receipt Configuration", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    OutlinedTextField(
                        value = receiptHeader,
                        onValueChange = { receiptHeader = it },
                        label = { Text("Thermal Receipt Header") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = receiptFooter,
                        onValueChange = { receiptFooter = it },
                        label = { Text("Thermal Receipt Footer") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Button(
                        onClick = {
                            sessionManager.saveReceiptConfig(session.businessId, receiptHeader, receiptFooter)
                            savedMsg = "Receipt header and footer saved on this terminal."
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    ) { Text("Save Receipt Settings", fontWeight = FontWeight.Bold) }
                    OutlinedButton(
                        onClick = onOpenPrinterSettings,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    ) {
                        Icon(Icons.Default.Print, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Open Bluetooth Printer Settings")
                    }
                    if (savedMsg != null) {
                        Text(savedMsg!!, color = Emerald500, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
