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
import androidx.compose.ui.text.style.TextAlign
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
    POS_RECENT_BILLS("Bills & Reprint", "Operations"),
    OFFLINE_SYNC("Offline Bills & Sync", "Operations"),
    PRINTER_SETTINGS("Printer Settings", "Device"),
    INTEGRATION_DIAGNOSTICS("Integration Diagnostics", "Administration")
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
            add(DrawerRouteItem(SmavRoute.INTEGRATION_DIAGNOSTICS, "Integration Diagnostics", Icons.Default.SettingsInputComponent))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_REPORTS, "Authorized Network Reports", Icons.Default.BarChart))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_AUDIT, "Security Audit Logs", Icons.Default.Security))
            add(DrawerRouteItem(SmavRoute.SUPERADMIN_SUPABASE, "Central Supabase & RLS", Icons.Default.Storage))
            add(DrawerRouteItem(SmavRoute.POS_BILLING, "Auditor POS", Icons.Default.PointOfSale))
            add(DrawerRouteItem(SmavRoute.POS_RECENT_BILLS, "Bills & Reprint", Icons.Default.ReceiptLong))
            add(DrawerRouteItem(SmavRoute.OFFLINE_SYNC, "Offline Sync Queue", Icons.Default.CloudSync))
            add(DrawerRouteItem(SmavRoute.PRINTER_SETTINGS, "Printer Settings", Icons.Default.Print))
        }

        session.role.isAdminOrAbove() -> listOf(
            DrawerRouteItem(SmavRoute.ADMIN_DASHBOARD, "Dashboard Summary", Icons.Default.Dashboard),
            DrawerRouteItem(SmavRoute.POS_BILLING, "Open POS Billing", Icons.Default.PointOfSale),
            DrawerRouteItem(SmavRoute.ADMIN_STAFF, "Staff & POS Users", Icons.Default.Group),
            DrawerRouteItem(SmavRoute.ADMIN_CATALOG, "Catalog & Prices", Icons.Default.MenuBook),
            DrawerRouteItem(SmavRoute.POS_RECENT_BILLS, "Bills & Reprint", Icons.Default.ReceiptLong),
            DrawerRouteItem(SmavRoute.ADMIN_REPORTS, "Outlet Reports", Icons.Default.BarChart),
            DrawerRouteItem(SmavRoute.ADMIN_SYNC, "Sync Status & Outbox", Icons.Default.CloudSync),
            DrawerRouteItem(SmavRoute.INTEGRATION_DIAGNOSTICS, "Integration Diagnostics", Icons.Default.SettingsInputComponent),
            DrawerRouteItem(SmavRoute.PRINTER_SETTINGS, "Printer Settings", Icons.Default.Print),
            DrawerRouteItem(SmavRoute.ADMIN_SETTINGS, "Outlet Settings", Icons.Default.Settings)
        )

        else -> listOf(
            DrawerRouteItem(SmavRoute.POS_BILLING, "POS Billing", Icons.Default.PointOfSale),
            DrawerRouteItem(SmavRoute.POS_RECENT_BILLS, "Bills & Reprint", Icons.Default.ReceiptLong),
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
    cartItemCount: Int = 0,
    cartTotalAmount: Double = 0.0,
    onOpenSelectedCart: (() -> Unit)? = null,
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
                drawerContainerColor = SmavColors.Surface,
                drawerContentColor = SmavColors.TextPrimary
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
                        color = SmavColors.Background,
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, SmavColors.Border),
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
                                        session.role.isSuperadmin() -> SmavColors.AccentPink
                                        session.role.isAdminOrAbove() -> SmavColors.InfoText
                                        else -> SmavColors.StepperGreen
                                    }
                                )
                                StatusBadgeChip(
                                    text = if (isOnline) "ONLINE" else "OFFLINE",
                                    color = if (isOnline) SmavColors.StepperGreen else SmavColors.WarningText
                                )
                            }
                            Text(
                                text = session.userName,
                                color = SmavColors.TextPrimary,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = session.businessName,
                                color = SmavColors.TextSecondary,
                                fontSize = 13.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = session.businessType.displayName,
                                color = SmavColors.InfoText,
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
                                        .heightIn(min = 44.dp),
                                    shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(1.dp, SmavColors.Border),
                                    colors = ButtonDefaults.outlinedButtonColors(
                                        containerColor = SmavColors.Surface,
                                        contentColor = SmavColors.TextPrimary
                                    )
                                ) {
                                    Icon(Icons.Default.SwapHoriz, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Switch Active Outlet", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }

                    HorizontalDivider(color = SmavColors.Border, modifier = Modifier.padding(vertical = 4.dp))

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
                                    fontSize = 14.sp,
                                    fontWeight = if (currentRoute == item.route) FontWeight.SemiBold else FontWeight.Medium
                                )
                            },
                            badge = when (item.route) {
                                SmavRoute.OFFLINE_SYNC, SmavRoute.ADMIN_SYNC -> if (pendingSyncCount > 0) {
                                    {
                                        Text(
                                            text = "$pendingSyncCount",
                                            style = SmavNumericStyles.Counter.copy(fontSize = 12.sp),
                                            color = SmavColors.WarningText
                                        )
                                    }
                                } else null
                                else -> null
                            },
                            colors = NavigationDrawerItemDefaults.colors(
                                selectedContainerColor = SmavColors.AccentPink.copy(alpha = 0.08f),
                                selectedTextColor = SmavColors.AccentPink,
                                selectedIconColor = SmavColors.AccentPink,
                                unselectedTextColor = SmavColors.TextPrimary,
                                unselectedIconColor = SmavColors.TextSecondary
                            ),
                            shape = RoundedCornerShape(12.dp)
                        )
                    }

                    HorizontalDivider(color = SmavColors.Border, modifier = Modifier.padding(vertical = 4.dp))

                    NavigationDrawerItem(
                        selected = false,
                        onClick = {
                            scope.launch { drawerState.close() }
                            showSignOutDialog = true
                        },
                        icon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = SmavColors.DangerText) },
                        label = { Text("Sign Out", color = SmavColors.DangerText, fontWeight = FontWeight.SemiBold) },
                        shape = RoundedCornerShape(12.dp)
                    )
                }
            }
        }
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = SmavColors.Background,
            contentWindowInsets = WindowInsets.safeDrawing,
            topBar = {
                Column(modifier = Modifier.background(SmavColors.Surface)) {
                    TopAppBar(
                        navigationIcon = {
                            IconButton(
                                onClick = { scope.launch { drawerState.open() } },
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(Icons.Default.Menu, contentDescription = "Open menu", tint = SmavColors.TextPrimary)
                            }
                        },
                        title = {
                            Column {
                                Text(
                                    text = currentRoute.title,
                                    color = SmavColors.TextPrimary,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${session.businessName} • ${session.visibleRole}",
                                    color = SmavColors.TextSecondary,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        },
                        actions = {
                            if (onOpenSelectedCart != null) {
                                Surface(
                                    color = if (cartItemCount > 0) SmavColors.AccentPink.copy(alpha = 0.12f) else SmavColors.Background,
                                    shape = RoundedCornerShape(10.dp),
                                    border = BorderStroke(
                                        1.dp,
                                        if (cartItemCount > 0) SmavColors.AccentPink.copy(alpha = 0.45f) else SmavColors.Border
                                    ),
                                    modifier = Modifier
                                        .padding(end = 4.dp)
                                        .clickable { onOpenSelectedCart() }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.ShoppingCart,
                                            contentDescription = "Selected Cart",
                                            tint = SmavColors.AccentPink,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Text(
                                            text = "$cartItemCount",
                                            color = SmavColors.AccentPink,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 12.sp
                                        )
                                        Text(
                                            text = "₹${Math.round(cartTotalAmount)}",
                                            color = SmavColors.TextPrimary,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 12.sp
                                        )
                                    }
                                }
                            }
                            if (currentRoute != homeRoute) {
                                IconButton(
                                    onClick = { onNavigate(homeRoute) },
                                    modifier = Modifier.size(48.dp)
                                ) {
                                    Icon(Icons.Default.Home, contentDescription = "Home", tint = SmavColors.TextPrimary)
                                }
                            }
                            IconButton(
                                onClick = { onNavigate(SmavRoute.PRINTER_SETTINGS) },
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(
                                    Icons.Default.Print,
                                    contentDescription = "Printer Settings",
                                    tint = if (anyPrinterConnected) SmavColors.StepperGreen else SmavColors.TextSecondary
                                )
                            }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = SmavColors.Surface)
                    )

                    val hideSalonPosStatusStrip =
                        session.businessType == BusinessType.SALON &&
                            (currentRoute == SmavRoute.POS_BILLING || currentRoute == SmavRoute.POS_RECENT_BILLS)
                    if (!hideSalonPosStatusStrip) {
                        FlowRow(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(SmavColors.SurfaceSubtle)
                                .padding(horizontal = 14.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            StatusBadgeChip(
                                text = if (isOnline) "Online" else "Offline Mode",
                                color = if (isOnline) SmavColors.StepperGreen else SmavColors.WarningText
                            )
                            StatusBadgeChip(
                                text = session.businessType.displayName,
                                color = when (session.businessType) {
                                    BusinessType.SALON -> SmavColors.AccentPink
                                    BusinessType.RESTAURANT -> SmavColors.WarningText
                                    BusinessType.RETAIL -> SmavColors.InfoText
                                    BusinessType.OTHER -> SmavColors.TextSecondary
                                }
                            )
                            if (pendingSyncCount > 0) {
                                Surface(
                                    color = SmavColors.WarningBg,
                                    shape = RoundedCornerShape(8.dp),
                                    border = BorderStroke(1.dp, SmavColors.WarningBorder),
                                    modifier = Modifier.clickable {
                                        onNavigate(
                                            if (session.role.isAdminOnly()) SmavRoute.ADMIN_SYNC else SmavRoute.OFFLINE_SYNC
                                        )
                                    }
                                ) {
                                    Text(
                                        text = "$pendingSyncCount pending sync",
                                        color = SmavColors.WarningText,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                    )
                                }
                            }
                            if (!anyPrinterConnected) {
                                Surface(
                                    color = SmavColors.Surface,
                                    shape = RoundedCornerShape(8.dp),
                                    border = BorderStroke(1.dp, SmavColors.Border),
                                    modifier = Modifier.clickable { onNavigate(SmavRoute.PRINTER_SETTINGS) }
                                ) {
                                    Text(
                                        text = "Printer not connected",
                                        color = SmavColors.TextSecondary,
                                        fontSize = 11.sp,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                    )
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = SmavColors.Border)
                }
            }
        ) { innerPadding ->
            content(innerPadding)
        }
    }

    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            containerColor = SmavColors.Surface,
            title = { Text("Sign Out of SMAV?", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    text = if (pendingSyncCount > 0) {
                        "You have $pendingSyncCount unsynchronized offline transaction(s). They will remain safely stored on this device and can be synced after signing back in."
                    } else {
                        "Are you sure you want to end your current session?"
                    },
                    color = SmavColors.TextSecondary
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showSignOutDialog = false
                        onSignOutConfirmed()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = SmavColors.DangerText, contentColor = Color.White)
                ) { Text("Sign Out", fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) {
                    Text("Cancel", color = SmavColors.TextSecondary)
                }
            }
        )
    }
}

@Composable
fun StatusBadgeChip(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        color = color.copy(alpha = 0.10f),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.25f))
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
    accent: Color = SmavColors.TextPrimary,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
        border = BorderStroke(1.dp, SmavColors.Border),
        shape = RoundedCornerShape(14.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(title, color = SmavColors.TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text(
                text = value,
                style = SmavNumericStyles.StatValue,
                color = accent
            )
            if (subtitle.isNotBlank()) {
                Text(subtitle, color = SmavColors.TextMuted, fontSize = 11.sp)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> FilterFlowRow(
    items: List<T>,
    selected: T?,
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
                label = {
                    Text(
                        labelOf(item),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium
                    )
                },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = SmavColors.TextPrimary,
                    selectedLabelColor = Color.White,
                    containerColor = SmavColors.Surface,
                    labelColor = SmavColors.TextSecondary
                ),
                border = FilterChipDefaults.filterChipBorder(
                    enabled = true,
                    selected = isSelected,
                    borderColor = SmavColors.Border,
                    selectedBorderColor = SmavColors.TextPrimary
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
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = SmavColors.TextMuted) },
        trailingIcon = if (query.isNotEmpty()) {
            {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(Icons.Default.Close, contentDescription = "Clear", tint = SmavColors.TextSecondary)
                }
            }
        } else null,
        placeholder = { Text(placeholder, color = SmavColors.TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        shape = RoundedCornerShape(12.dp),
        colors = smavOutlinedFieldColors()
    )
}

@Composable
fun ErrorBannerCard(message: String, onRetry: (() -> Unit)? = null) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SmavColors.DangerBg),
        border = BorderStroke(1.dp, SmavColors.DangerBorder),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(message, color = SmavColors.DangerText, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            if (onRetry != null) {
                OutlinedButton(
                    onClick = onRetry,
                    border = BorderStroke(1.dp, SmavColors.DangerBorder),
                    colors = ButtonDefaults.outlinedButtonColors(
                        containerColor = SmavColors.Surface,
                        contentColor = SmavColors.DangerText
                    ),
                    modifier = Modifier.heightIn(min = 42.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Retry", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
fun EmptyStateCard(title: String, subtitle: String, icon: ImageVector = Icons.Default.Inbox) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
        border = BorderStroke(1.dp, SmavColors.Border),
        shape = RoundedCornerShape(14.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(icon, contentDescription = null, tint = SmavColors.TextMuted, modifier = Modifier.size(32.dp))
            Text(title, color = SmavColors.TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center)
            Text(subtitle, color = SmavColors.TextSecondary, fontSize = 13.sp, textAlign = TextAlign.Center)
        }
    }
}

@Composable
fun MobileFormDialog(
    title: String,
    onDismiss: () -> Unit,
    confirmText: String,
    confirmEnabled: Boolean = true,
    showConfirmButton: Boolean = true,
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
            colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
            border = BorderStroke(1.dp, SmavColors.Border),
            shape = RoundedCornerShape(18.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 640.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(title, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    IconButton(onClick = { if (!isSaving) onDismiss() }) {
                        Icon(Icons.Default.Close, contentDescription = "Close", tint = SmavColors.TextSecondary)
                    }
                }
                HorizontalDivider(color = SmavColors.Border)
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    content = content
                )
                HorizontalDivider(color = SmavColors.Border)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    SmavSecondaryButton(
                        text = "Cancel",
                        onClick = onDismiss,
                        enabled = !isSaving,
                        modifier = Modifier.weight(1f)
                    )
                    if (showConfirmButton) {
                        SmavGradientButton(
                            text = confirmText,
                            onClick = onConfirm,
                            enabled = confirmEnabled,
                            busy = isSaving,
                            modifier = Modifier.weight(1f)
                        )
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
            colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
            border = BorderStroke(1.dp, SmavColors.Border),
            shape = RoundedCornerShape(18.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 560.dp)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Select Active Outlet", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 18.sp)
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
                                containerColor = if (selected) SmavColors.InfoBg else SmavColors.SurfaceSubtle
                            ),
                            border = BorderStroke(1.dp, if (selected) SmavColors.InfoText else SmavColors.Border),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(option.businessName, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text(
                                    "${option.normalizedBusinessType.displayName} • Code: ${option.branchCode.ifBlank { "N/A" }}",
                                    color = SmavColors.InfoText,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    }
                }
                SmavSecondaryButton(
                    text = "Close",
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}
