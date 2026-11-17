package com.smav.printagent.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.smav.printagent.model.*
import com.smav.printagent.ui.theme.*
import kotlinx.coroutines.launch

enum class SmavRoute(val title: String, val group: String) {
    // Superadmin
    SUPERADMIN_OUTLETS("Registered Outlets", "Superadmin"),
    SUPERADMIN_ADMINS("Outlet Administrators", "Superadmin"),
    SUPERADMIN_DIAGNOSTICS("Catalog Sync Diagnostics", "Superadmin"),
    SUPERADMIN_REPORTS("Network Reports", "Superadmin"),
    SUPERADMIN_AUDIT("Security Audit Logs", "Superadmin"),
    SUPERADMIN_SUPABASE("Central Supabase & RLS", "Superadmin"),

    // Outlet Admin
    ADMIN_DASHBOARD("Outlet Dashboard", "Outlet Admin"),
    ADMIN_STAFF("Staff & POS Users", "Outlet Admin"),
    ADMIN_CATALOG("Catalog & Pricing", "Outlet Admin"),
    ADMIN_REPORTS("Outlet Reports", "Outlet Admin"),
    ADMIN_SYNC("Sync Status & Outbox", "Outlet Admin"),
    ADMIN_SETTINGS("Outlet Settings", "Outlet Admin"),

    // POS & Shared Operations
    POS_BILLING("POS Billing", "Operations"),
    POS_RECENT_BILLS("Recent Bills & Reprint", "Operations"),
    OFFLINE_SYNC("Offline Bills & Sync", "Operations"),
    PRINTER_SETTINGS("Printer Settings", "Device")
}

data class DrawerRouteItem(
    val route: SmavRoute,
    val label: String,
    val icon: ImageVector
)

fun defaultRouteForRole(role: UserRole): SmavRoute = when {
    role.isSuperadmin() -> SmavRoute.SUPERADMIN_OUTLETS
    role.isAdminOrAbove() -> SmavRoute.ADMIN_DASHBOARD
    else -> SmavRoute.POS_BILLING
}

fun drawerItemsForSession(session: StaffSession): List<DrawerRouteItem> {
    return when {
        session.role.isSuperadmin() -> buildList {
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_OUTLETS, "Registered Outlets", Icons.Default.Store))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_ADMINS, "Outlet Administrators", Icons.Default.SupervisorAccount))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_DIAGNOSTICS, "Catalog Sync Diagnostics", Icons.Default.SyncProblem))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_REPORTS, "Authorized Network Reports", Icons.Default.BarChart))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_AUDIT, "Security Audit Logs", Icons.Default.Security))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_SUPABASE, "Central Supabase & RLS", Icons.Default.Storage))
            add(DrawerRouteItem(SmavRoute.POS_BILLING, "Auditor POS", Icons.Default.PointOfSale))
            add(DrawerRouteItem(SmavRoute.POS_RECENT_BILLS, "Recent Bills & Reprint", Icons.Default.ReceiptLong))
            add(DrawerRouteItem(SmavRoute.OFFLINE_SYNC, "Offline Sync Queue", Icons.Default.CloudSync))
            add(DrawerRouteItem(SmavRoute.PRINTER_SETTINGS, "Printer Settings", Icons.Default.Print))
        }

        session.role.isAdminOrAbove() -> listOf(
            DrawerRouteItem(SmavRoute.ADMIN_DASHBOARD, "Dashboard Summary", Icons.Default.Dashboard),
            DrawerRouteItem(SmavRoute.POS_BILLING, "Open POS Billing", Icons.Default.PointOfSale),
            DrawerRouteItem(SmavRoute.ADMIN_STAFF, "Staff & POS Users", Icons.Default.Group),
            DrawerRouteItem(SmavRoute.ADMIN_CATALOG, "Catalog & Prices", Icons.Default.MenuBook),
            DrawerRouteItem(SmavRoute.POS_RECENT_BILLS, "Recent Bills & Reprint", Icons.Default.ReceiptLong),
            DrawerRouteItem(SmavRoute.ADMIN_REPORTS, "Outlet Reports", Icons.Default.BarChart),
            DrawerRouteItem(SmavRoute.ADMIN_SYNC, "Sync Status & Outbox", Icons.Default.CloudSync),
            DrawerRouteItem(SmavRoute.PRINTER_SETTINGS, "Printer Settings", Icons.Default.Print),
            DrawerRouteItem(SmavRoute.ADMIN_SETTINGS, "Outlet Settings", Icons.Default.Settings)
        )

        else -> listOf(
            DrawerRouteItem(SmavRoute.POS_BILLING, "POS Billing", Icons.Default.PointOfSale),
            DrawerRouteItem(SmavRoute.POS_RECENT_BILLS, "Recent Bills & Reprint", Icons.Default.ReceiptLong),
            DrawerRouteItem(SmavRoute.OFFLINE_SYNC, "Pending Offline Sync", Icons.Default.CloudSync),
            DrawerRouteItem(SmavRoute.PRINTER_SETTINGS, "Printer Settings", Icons.Default.Print)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SmavAppScaffold(
    session: StaffSession,
    currentRoute: SmavRoute,
    isOnline: Boolean,
    pendingSyncCount: Int,
    anyPrinterConnected: Boolean,
    onNavigate: (SmavRoute) -> Unit,
    onOpenOutletSwitcher: (() -> Unit)?,
    onSignOutConfirmed: () -> Unit,
    content: @Composable (PaddingValues) -> Unit
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var showSignOutDialog by remember { mutableStateOf(false) }

    val homeRoute = remember(session.role) { defaultRouteForRole(session.role) }

    BackHandler(enabled = drawerState.isOpen || currentRoute != homeRoute) {
        if (drawerState.isOpen) {
            scope.launch { drawerState.close() }
        } else if (currentRoute != homeRoute) {
            onNavigate(homeRoute)
        }
    }

    val drawerItems = remember(session) { drawerItemsForSession(session) }
    val scrollState = rememberScrollState()

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.widthIn(max = 310.dp),
                drawerContainerColor = Color(0xFF0E142A),
                drawerContentColor = Color.White
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .windowInsetsPadding(WindowInsets.safeDrawing)
                        .verticalScroll(scrollState)
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Drawer header card
                    Surface(
                        color = Color(0xFF161D3B),
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, Color(0xFF2B355F)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(14.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                StatusBadgeChip(
                                    text = session.visibleRole,
                                    color = when {
                                        session.role.isSuperadmin() -> Color(0xFFFF2D82)
                                        session.role.isAdminOrAbove() -> Sky400
                                        else -> Emerald500
                                    }
                                )
                                StatusBadgeChip(
                                    text = if (isOnline) "ONLINE" else "OFFLINE",
                                    color = if (isOnline) Emerald500 else Amber500
                                )
                            }
                            Text(
                                text = session.userName,
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = session.businessName,
                                color = Color(0xFFB3C3E6),
                                fontSize = 13.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = session.businessType.displayName,
                                color = Sky400,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            if (onOpenOutletSwitcher != null && (session.role.isSuperadmin() || session.assignedOutlets.size > 1)) {
                                OutlinedButton(
                                    onClick = {
                                        scope.launch { drawerState.close() }
                                        onOpenOutletSwitcher()
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 4.dp)
                                        .heightIn(min = 42.dp),
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Switch Active Outlet", fontSize = 13.sp)
                                }
                            }
                        }
                    }

                    HorizontalDivider(color = Color(0xFF232C52), modifier = Modifier.padding(vertical = 4.dp))

                    drawerItems.forEach { item ->
                        NavigationDrawerItem(
                            selected = currentRoute == item.route,
                            onClick = {
                                scope.launch { drawerState.close() }
                                onNavigate(item.route)
                            },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = {
                                Text(
                                    text = item.label,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    fontSize = 14.sp
                                )
                            },
                            badge = when (item.route) {
                                SmavRoute.OFFLINE_SYNC, SmavRoute.ADMIN_SYNC -> if (pendingSyncCount > 0) {
                                    { Text("$pendingSyncCount", color = Amber500, fontWeight = FontWeight.Bold) }
                                } else null
                                else -> null
                            },
                            colors = NavigationDrawerItemDefaults.colors(
                                selectedContainerColor = Color(0xFF232D58),
                                selectedTextColor = Color.White,
                                selectedIconColor = Color(0xFFFF2D82),
                                unselectedTextColor = Color(0xFFCBD5E1),
                                unselectedIconColor = Color(0xFF94A3B8)
                            ),
                            shape = RoundedCornerShape(12.dp)
                        )
                    }

                    HorizontalDivider(color = Color(0xFF232C52), modifier = Modifier.padding(vertical = 4.dp))

                    NavigationDrawerItem(
                        selected = false,
                        onClick = {
                            scope.launch { drawerState.close() }
                            showSignOutDialog = true
                        },
                        icon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = Rose600) },
                        label = { Text("Sign Out", color = Rose600, fontWeight = FontWeight.SemiBold) },
                        shape = RoundedCornerShape(12.dp)
                    )
                }
            }
        }
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = Color(0xFF0B0E1B),
            contentWindowInsets = WindowInsets.safeDrawing,
            topBar = {
                Column(modifier = Modifier.background(Slate900)) {
                    TopAppBar(
                        navigationIcon = {
                            IconButton(
                                onClick = { scope.launch { drawerState.open() } },
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(Icons.Default.Menu, contentDescription = "Open menu", tint = Color.White)
                            }
                        },
                        title = {
                            Column {
                                Text(
                                    text = currentRoute.title,
                                    color = Color.White,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${session.businessName} • ${session.visibleRole}",
                                    color = Color(0xFF94A3B8),
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        },
                        actions = {
                            if (currentRoute != homeRoute) {
                                IconButton(
                                    onClick = { onNavigate(homeRoute) },
                                    modifier = Modifier.size(48.dp)
                                ) {
                                    Icon(Icons.Default.Home, contentDescription = "Home", tint = Sky400)
                                }
                            }
                            IconButton(
                                onClick = { onNavigate(SmavRoute.PRINTER_SETTINGS) },
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(
                                    Icons.Default.Print,
                                    contentDescription = "Printer Settings",
                                    tint = if (anyPrinterConnected) Emerald500 else Color(0xFF64748B)
                                )
                            }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = Slate900)
                    )

                    // Compact responsive status bar — wraps cleanly on 360dp & 1.3x font scale
                    FlowRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF0E142A))
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        StatusBadgeChip(
                            text = if (isOnline) "Online" else "Offline Mode",
                            color = if (isOnline) Emerald500 else Amber500
                        )
                        StatusBadgeChip(
                            text = session.businessType.displayName,
                            color = when (session.businessType) {
                                BusinessType.SALON -> Color(0xFFFF2D82)
                                BusinessType.RESTAURANT -> Amber500
                                BusinessType.RETAIL -> Sky400
                                BusinessType.OTHER -> Color(0xFF94A3B8)
                            }
                        )
                        if (pendingSyncCount > 0) {
                            Surface(
                                color = Amber500.copy(alpha = 0.16f),
                                shape = RoundedCornerShape(8.dp),
                                border = BorderStroke(1.dp, Amber500.copy(alpha = 0.45f)),
                                modifier = Modifier.clickable {
                                    onNavigate(
                                        if (session.role.isAdminOnly()) SmavRoute.ADMIN_SYNC else SmavRoute.OFFLINE_SYNC
                                    )
                                }
                            ) {
                                Text(
                                    text = "$pendingSyncCount pending sync",
                                    color = Amber500,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }
                        }
                        if (!anyPrinterConnected) {
                            Surface(
                                color = Color(0xFF1E293B),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.clickable { onNavigate(SmavRoute.PRINTER_SETTINGS) }
                            ) {
                                Text(
                                    text = "Printer not connected",
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 11.sp,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }
                        }
                    }
                    HorizontalDivider(color = Color(0xFF1E293B))
                }
            }
        ) { innerPadding ->
            content(innerPadding)
        }
    }

    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            containerColor = Color(0xFF121629),
            title = { Text("Sign Out of SMAV?", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    text = if (pendingSyncCount > 0) {
                        "You have $pendingSyncCount unsynchronized offline transaction(s). They will remain safely stored on this device and can be synced after signing back in."
                    } else {
                        "Are you sure you want to end your current session?"
                    },
                    color = Color(0xFFCBD5E1)
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showSignOutDialog = false
                        onSignOutConfirmed()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Rose600)
                ) { Text("Sign Out") }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
fun StatusBadgeChip(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = color.copy(alpha = 0.16f),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.45f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(color)
            )
            Text(
                text = text,
                color = color,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun SummaryStatCard(
    title: String,
    value: String,
    subtitle: String = "",
    accent: Color = Sky400,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF131933)),
        border = BorderStroke(1.dp, Color(0xFF232C52)),
        shape = RoundedCornerShape(14.dp)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(title, color = Color(0xFF94A3B8), fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text(value, color = accent, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            if (subtitle.isNotBlank()) {
                Text(subtitle, color = Color(0xFFCBD5E1), fontSize = 11.sp)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> FilterFlowRow(
    items: List<T>,
    selected: T,
    labelOf: (T) -> String,
    onSelect: (T) -> Unit
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items.forEach { item ->
            val isSelected = item == selected
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(item) },
                label = { Text(labelOf(item), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Color(0xFFFF2D82).copy(alpha = 0.22f),
                    selectedLabelColor = Color.White,
                    containerColor = Color(0xFF161A33),
                    labelColor = Color(0xFFCBD5E1)
                )
            )
        }
    }
}

@Composable
fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = Color(0xFF94A3B8)) },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = "Clear", tint = Color(0xFF94A3B8))
                }
            }
        } else null,
        placeholder = { Text(placeholder, color = Color(0xFF64748B), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Color(0xFF121832),
            unfocusedContainerColor = Color(0xFF121832),
            focusedTextColor = Color.White,
            unfocusedTextColor = Color.White,
            focusedBorderColor = Color(0xFFFF2D82),
            unfocusedBorderColor = Color(0xFF2A3256)
        )
    )
}

@Composable
fun ErrorBannerCard(message: String, onRetry: (() -> Unit)? = null) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0x33E11D48)),
        border = BorderStroke(1.dp, Rose600.copy(alpha = 0.5f)),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(message, color = Color(0xFFFDA4AF), fontSize = 13.sp)
            if (onRetry != null) {
                OutlinedButton(
                    onClick = onRetry,
                    modifier = Modifier.heightIn(min = 42.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Retry")
                }
            }
        }
    }
}

@Composable
fun EmptyStateCard(title: String, subtitle: String, icon: ImageVector = Icons.Default.Inbox) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
        border = BorderStroke(1.dp, Color(0xFF232C52)),
        shape = RoundedCornerShape(14.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(icon, contentDescription = null, tint = Color(0xFF64748B), modifier = Modifier.size(32.dp))
            Text(title, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, color = Color(0xFF94A3B8), fontSize = 13.sp)
        }
    }
}

@Composable
fun MobileFormDialog(
    title: String,
    onDismiss: () -> Unit,
    confirmText: String,
    confirmEnabled: Boolean = true,
    isSaving: Boolean = false,
    onConfirm: () -> Unit,
    content: @Composable ColumnScope.() -> Unit
) {
    Dialog(
        onDismissRequest = { if (!isSaving) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 24.dp)
                .imePadding(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
            border = BorderStroke(1.dp, Color(0xFF2B355F)),
            shape = RoundedCornerShape(18.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 620.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    IconButton(onClick = { if (!isSaving) onDismiss() }) {
                        Icon(Icons.Default.Close, contentDescription = "Close", tint = Color(0xFF94A3B8))
                    }
                }
                HorizontalDivider(color = Color(0xFF232C52))
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    content = content
                )
                HorizontalDivider(color = Color(0xFF232C52))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        enabled = !isSaving,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp)
                    ) { Text("Cancel") }
                    Button(
                        onClick = onConfirm,
                        enabled = confirmEnabled && !isSaving,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82))
                    ) {
                        if (isSaving) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = Color.White,
                                strokeWidth = 2.dp
                            )
                        } else {
                            Text(confirmText, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun OutletSelectorDialog(
    outlets: List<AvailableBusinessOption>,
    currentOutletId: String,
    onSelect: (AvailableBusinessOption) -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
            border = BorderStroke(1.dp, Color(0xFF2B355F)),
            shape = RoundedCornerShape(18.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 560.dp)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Select Active Outlet", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    outlets.forEach { option ->
                        val selected = option.businessId == currentOutletId
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(option) },
                            colors = CardDefaults.cardColors(
                                containerColor = if (selected) Color(0xFF1E2A4F) else Color(0xFF161B33)
                            ),
                            border = BorderStroke(1.dp, if (selected) Sky400 else Color(0xFF263055)),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(option.businessName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text(
                                    "${option.normalizedBusinessType.displayName} • Code: ${option.branchCode.ifBlank { "N/A" }}",
                                    color = Sky400,
                                    fontSize = 12.sp
                                )
                            }
                        }
                    }
                }
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                ) { Text("Close") }
            }
        }
    }
}
