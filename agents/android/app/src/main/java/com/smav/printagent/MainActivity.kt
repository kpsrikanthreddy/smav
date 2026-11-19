package com.smav.printagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonObject
import com.smav.printagent.bluetooth.BluetoothPrinterManager
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.repository.*
import com.smav.printagent.model.*
import com.smav.printagent.network.*
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.screens.*
import com.smav.printagent.ui.theme.SMAVTheme
import com.smav.printagent.ui.theme.SmavColors
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT
            ),
            navigationBarStyle = SystemBarStyle.light(
                android.graphics.Color.TRANSPARENT,
                android.graphics.Color.TRANSPARENT
            )
        )

        val sessions = SessionManager(applicationContext)
        val database = AppDatabase.getInstance(applicationContext)
        val printerManager = BluetoothPrinterManager.getInstance(applicationContext)
        val adminRepo = AdminNetworkRepository(sessions)
        val catalogRepo = CatalogSyncRepository(applicationContext, database, sessions)
        val billingRepo = BillingRepository(applicationContext, database, sessions, printerManager)
        val syncRepo = SyncRepository(applicationContext, database, sessions)

        setContent {
            SMAVTheme {
                val scope = rememberCoroutineScope()

                var active by remember { mutableStateOf(sessions.getStaffSession()) }
                var isOnline by remember { mutableStateOf(true) }
                var authErrorMessage by remember { mutableStateOf("") }

                // Multi-outlet selection state before full session
                var pendingToken by remember { mutableStateOf("") }
                var pendingUserId by remember { mutableStateOf("") }
                var pendingEmail by remember { mutableStateOf("") }
                var pendingOutlets by remember { mutableStateOf<List<AvailableBusinessOption>>(emptyList()) }
                var pendingSelectionBusy by remember { mutableStateOf(false) }

                // Background startup session validation (never wipes Room bills on 401)
                LaunchedEffect(Unit) {
                    if (active != null) {
                        adminRepo.validateCurrentSession()
                            .onSuccess { refreshed ->
                                active = refreshed
                                isOnline = true
                            }
                            .onFailure { err ->
                                if (err is UnauthorizedSessionException) {
                                    sessions.clearSession()
                                    active = null
                                    authErrorMessage = err.message ?: "Your session has expired. Please sign in again."
                                } else {
                                    isOnline = false
                                }
                            }
                    }
                }

                when {
                    active != null -> {
                        SmavAuthenticatedApp(
                            session = active!!,
                            isOnline = isOnline,
                            sessions = sessions,
                            database = database,
                            printerManager = printerManager,
                            adminRepo = adminRepo,
                            catalogRepo = catalogRepo,
                            billingRepo = billingRepo,
                            syncRepo = syncRepo,
                            onSessionUpdated = { updated ->
                                active = updated
                                isOnline = true
                            },
                            onSignedOut = { reason ->
                                scope.launch { adminRepo.signOutRemote() }
                                active = null
                                pendingOutlets = emptyList()
                                pendingToken = ""
                                pendingUserId = ""
                                authErrorMessage = reason ?: ""
                            }
                        )
                    }

                    pendingOutlets.isNotEmpty() -> {
                        MultiBusinessSelectionScreen(
                            availableBusinesses = pendingOutlets,
                            busy = pendingSelectionBusy,
                            errorMessage = authErrorMessage.takeIf { it.isNotBlank() },
                            onBack = {
                                pendingOutlets = emptyList()
                                pendingToken = ""
                                pendingUserId = ""
                                authErrorMessage = ""
                            },
                            onSelectBusiness = { option ->
                                pendingSelectionBusy = true
                                authErrorMessage = ""
                                scope.launch {
                                    try {
                                        val body = JsonObject().apply {
                                            addProperty("tempToken", pendingToken)
                                            addProperty("temp_token", pendingToken)
                                            addProperty("userId", pendingUserId)
                                            addProperty("user_id", pendingUserId)
                                            addProperty("outletId", option.businessId)
                                            addProperty("business_id", option.businessId)
                                            addProperty("deviceId", sessions.deviceId)
                                            addProperty("device_id", sessions.deviceId)
                                        }
                                        val api = SmavApiClient.create(sessions)
                                        val resp = api.selectOutletRaw(body)
                                        val reply = SmavApiClient.unwrapOrThrow(resp) { it }
                                        var session = adminRepo.parseSessionPayload(reply, pendingEmail)
                                        if (session.assignedOutlets.isEmpty()) {
                                            session = session.copy(assignedOutlets = pendingOutlets)
                                        }
                                        sessions.saveStaffSession(session)
                                        active = session
                                        isOnline = true
                                        pendingOutlets = emptyList()
                                        pendingToken = ""
                                        pendingUserId = ""

                                        // Enrich authorized outlets list asynchronously
                                        adminRepo.refreshAuthorizedOutlets().onSuccess { refreshedOutlets ->
                                            sessions.getStaffSession()?.let { latest ->
                                                val updated = latest.copy(assignedOutlets = refreshedOutlets)
                                                sessions.saveStaffSession(updated)
                                                active = updated
                                            }
                                        }
                                    } catch (e: Exception) {
                                        authErrorMessage = SmavApiClient.friendlyThrowable(e, "Outlet selection failed.")
                                    } finally {
                                        pendingSelectionBusy = false
                                    }
                                }
                            }
                        )
                    }

                    else -> {
                        CompactLoginScreen(
                            initialMessage = authErrorMessage,
                            sessions = sessions,
                            adminRepo = adminRepo,
                            onLoginSuccess = { loggedSession ->
                                active = loggedSession
                                isOnline = true
                                authErrorMessage = ""
                                scope.launch {
                                    adminRepo.refreshAuthorizedOutlets().onSuccess { refreshedOutlets ->
                                        sessions.getStaffSession()?.let { latest ->
                                            val updated = latest.copy(assignedOutlets = refreshedOutlets)
                                            sessions.saveStaffSession(updated)
                                            active = updated
                                        }
                                    }
                                }
                            },
                            onMultiOutlet = { token, userId, email, options ->
                                pendingToken = token
                                pendingUserId = userId
                                pendingEmail = email
                                pendingOutlets = options
                                authErrorMessage = ""
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CompactLoginScreen(
    initialMessage: String,
    sessions: SessionManager,
    adminRepo: AdminNetworkRepository,
    onLoginSuccess: (StaffSession) -> Unit,
    onMultiOutlet: (token: String, userId: String, email: String, options: List<AvailableBusinessOption>) -> Unit
) {
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var outletCode by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember(initialMessage) { mutableStateOf(initialMessage) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SmavColors.Background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
            .verticalScroll(scrollState)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 420.dp),
            shape = RoundedCornerShape(22.dp),
            colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
            border = BorderStroke(1.dp, SmavColors.Border),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Surface(
                    modifier = Modifier.size(48.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = SmavColors.Surface,
                    border = BorderStroke(1.dp, SmavColors.Border),
                    shadowElevation = 1.dp
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Print,
                            contentDescription = "SMAV Print Agent",
                            tint = SmavColors.AccentPink,
                            modifier = Modifier.size(26.dp)
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "SMAV Print Agent",
                    color = SmavColors.TextPrimary,
                    fontSize = 23.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "Secure Enterprise Authentication Gateway",
                    color = SmavColors.TextSecondary,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(16.dp))

                LoginLabel("Email Address or Username")
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    placeholder = { Text("name@company.com or username", color = SmavColors.TextMuted, fontSize = 13.sp) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    colors = loginFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                )
                Spacer(Modifier.height(10.dp))

                LoginLabel("Password / PIN")
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("Enter password", color = SmavColors.TextMuted, fontSize = 13.sp) },
                    singleLine = true,
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Next
                    ),
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }, modifier = Modifier.size(48.dp)) {
                            Icon(
                                if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                "Show or hide password",
                                tint = SmavColors.TextSecondary
                            )
                        }
                    },
                    colors = loginFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                )
                Spacer(Modifier.height(10.dp))

                LoginLabel("Outlet Code (optional)")
                OutlinedTextField(
                    value = outletCode,
                    onValueChange = { outletCode = it },
                    placeholder = { Text("e.g. mozz, glossylooks", color = SmavColors.TextMuted, fontSize = 13.sp) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    colors = loginFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Used to identify an outlet's authentication provider when required.",
                    color = SmavColors.TextSecondary,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(16.dp))

                SmavGradientButton(
                    text = if (busy) "Signing In..." else "Sign In",
                    icon = Icons.AutoMirrored.Filled.Login,
                    enabled = !busy && username.isNotBlank() && password.isNotBlank(),
                    busy = busy,
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                    onClick = {
                        busy = true
                        message = ""
                        scope.launch {
                            try {
                                val serverUrl = sessions.getServerUrl()
                                require(serverUrl.startsWith("https://")) { "Valid HTTPS SMAV server configuration required." }
                                val body = JsonObject().apply {
                                    addProperty("emailOrId", username.trim())
                                    addProperty("email", username.trim())
                                    addProperty("password", password)
                                    if (outletCode.isNotBlank()) addProperty("outletCode", outletCode.trim())
                                    addProperty("device_id", sessions.deviceId)
                                }
                                val api = SmavApiClient.create(sessions)
                                val resp = api.loginRaw(body)
                                val reply = SmavApiClient.unwrapOrThrow(resp) { it }
                                val isMulti = reply.optBool("multiBusiness", false) || reply.optBool("multi_business", false)
                                if (isMulti) {
                                    val tToken = reply.optString("tempToken", "temp_token")
                                    val uId = reply.optString("userId", "user_id").ifBlank {
                                        reply.get("session").asJsonObjectOrNull()?.optString("userId").orEmpty()
                                    }
                                    val optionsArr = reply.getAsJsonArray("availableOutlets")
                                        ?: reply.getAsJsonArray("available_businesses")
                                    val options = adminRepo.parseAssignedOutlets(optionsArr)
                                    require((tToken.isNotBlank() || uId.isNotBlank()) && options.isNotEmpty()) {
                                        "Server did not provide selectable outlets."
                                    }
                                    password = ""
                                    onMultiOutlet(tToken, uId, username.trim(), options)
                                } else {
                                    val session = adminRepo.parseSessionPayload(reply, username.trim())
                                    sessions.saveStaffSession(session)
                                    password = ""
                                    onLoginSuccess(session)
                                }
                            } catch (e: Exception) {
                                message = SmavApiClient.friendlyThrowable(e, "Login failed.")
                            } finally {
                                busy = false
                            }
                        }
                    }
                )

                Spacer(Modifier.height(6.dp))
                TextButton(onClick = { message = "Please contact your outlet administrator to reset your credentials." }) {
                    Text("Forgot Password? ", color = SmavColors.TextSecondary, fontSize = 13.sp)
                    Text("Reset your credentials", color = SmavColors.AccentPink, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }

                if (message.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Surface(
                        color = SmavColors.DangerBg,
                        shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, SmavColors.DangerBorder),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            text = message,
                            color = SmavColors.DangerText,
                            textAlign = TextAlign.Center,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SmavAuthenticatedApp(
    session: StaffSession,
    isOnline: Boolean,
    sessions: SessionManager,
    database: AppDatabase,
    printerManager: BluetoothPrinterManager,
    adminRepo: AdminNetworkRepository,
    catalogRepo: CatalogSyncRepository,
    billingRepo: BillingRepository,
    syncRepo: SyncRepository,
    onSessionUpdated: (StaffSession) -> Unit,
    onSignedOut: (String?) -> Unit
) {
    val scope = rememberCoroutineScope()
    var currentRoute by remember(session.role) { mutableStateOf(defaultRouteForRole(session.role)) }
    var showOutletSwitcher by remember { mutableStateOf(false) }

    // Observe outlet-scoped pending offline bill counts
    val pendingSalon by database.salonBillDao().countPendingBillsForBranch(session.businessId).collectAsState(initial = 0)
    val pendingRest by database.restaurantOrderDao().countPendingOrdersForBranch(session.businessId).collectAsState(initial = 0)
    val pendingRetail by database.retailBillDao().countPendingBills().collectAsState(initial = 0)
    val pendingSyncCount = when (session.businessType) {
        BusinessType.SALON -> pendingSalon
        BusinessType.RESTAURANT -> pendingRest
        BusinessType.RETAIL -> pendingRetail
        BusinessType.OTHER -> pendingSalon + pendingRest + pendingRetail
    }

    val printerStatuses by printerManager.connectionStatus.collectAsState()
    val anyPrinterConnected = printerStatuses.values.any { it == PrinterConnectionStatus.CONNECTED }

    // Enforce RBAC route boundary even if state changes
    val safeRoute = remember(currentRoute, session.role) {
        val allowedRoutes = drawerItemsForSession(session).map { it.route }.toSet()
        if (currentRoute in allowedRoutes) currentRoute else defaultRouteForRole(session.role)
    }

    SmavAppScaffold(
        session = session,
        currentRoute = safeRoute,
        isOnline = isOnline,
        pendingSyncCount = pendingSyncCount,
        anyPrinterConnected = anyPrinterConnected,
        onNavigate = { currentRoute = it },
        onOpenOutletSwitcher = if (session.role.isSuperadmin() || session.assignedOutlets.size > 1) {
            { showOutletSwitcher = true }
        } else null,
        onSignOutConfirmed = { onSignedOut(null) }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (safeRoute) {
                SmavRoute.SUPERADMIN_OUTLETS -> if (session.role.isSuperadmin()) {
                    SuperadminOutletsScreen(
                        session = session,
                        adminRepo = adminRepo,
                        onSessionUpdated = onSessionUpdated,
                        onLaunchPosSuccess = { launched ->
                            onSessionUpdated(launched)
                            currentRoute = SmavRoute.POS_BILLING
                        },
                        onUnauthorized = { msg -> onSignedOut(msg) },
                        onOpenRoute = { currentRoute = it }
                    )
                }

                SmavRoute.SUPERADMIN_ADMINS -> if (session.role.isSuperadmin()) {
                    SuperadminAdminsScreen(
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.SUPERADMIN_DIAGNOSTICS -> if (session.role.isSuperadmin()) {
                    SuperadminDiagnosticsScreen(
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.SUPERADMIN_REPORTS -> if (session.role.isSuperadmin()) {
                    SuperadminReportsScreen(
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.SUPERADMIN_AUDIT -> if (session.role.isSuperadmin()) {
                    SuperadminAuditLogsScreen(
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.SUPERADMIN_SUPABASE -> if (session.role.isSuperadmin()) {
                    SuperadminSupabaseStatusScreen(
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.ADMIN_DASHBOARD -> if (session.role.isAdminOrAbove()) {
                    AdminDashboardScreen(
                        session = session,
                        pendingSyncCount = pendingSyncCount,
                        adminRepo = adminRepo,
                        catalogRepo = catalogRepo,
                        onNavigate = { currentRoute = it },
                        onOpenOutletSwitcher = { showOutletSwitcher = true },
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.ADMIN_STAFF -> if (session.role.isAdminOrAbove()) {
                    AdminStaffScreen(
                        session = session,
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.ADMIN_CATALOG -> if (session.role.isAdminOrAbove()) {
                    AdminCatalogScreen(
                        session = session,
                        adminRepo = adminRepo,
                        catalogRepo = catalogRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.ADMIN_REPORTS -> if (session.role.isAdminOrAbove()) {
                    AdminReportsScreen(
                        session = session,
                        pendingSyncCount = pendingSyncCount,
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.ADMIN_SYNC -> if (session.role.isAdminOrAbove()) {
                    AdminSyncScreen(
                        session = session,
                        pendingSyncCount = pendingSyncCount,
                        adminRepo = adminRepo,
                        syncRepo = syncRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.ADMIN_SETTINGS -> if (session.role.isAdminOrAbove()) {
                    AdminSettingsScreen(
                        session = session,
                        sessionManager = sessions,
                        adminRepo = adminRepo,
                        onOpenPrinterSettings = { currentRoute = SmavRoute.PRINTER_SETTINGS },
                        onOpenOutletSwitcher = { showOutletSwitcher = true },
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }

                SmavRoute.POS_BILLING -> PosBillingRouterScreen(
                    session = session,
                    catalogRepo = catalogRepo,
                    billingRepo = billingRepo,
                    sessionManager = sessions,
                    onOpenOutletSwitcher = { showOutletSwitcher = true },
                    onOpenRecentBills = { currentRoute = SmavRoute.POS_RECENT_BILLS },
                    onOpenPrinterSettings = { currentRoute = SmavRoute.PRINTER_SETTINGS },
                    onUnauthorized = { msg -> onSignedOut(msg) }
                )

                SmavRoute.POS_RECENT_BILLS -> RecentBillsScreen(
                    session = session,
                    database = database,
                    billingRepo = billingRepo,
                    sessionManager = sessions
                )

                SmavRoute.OFFLINE_SYNC -> OfflineSyncStatusScreen(
                    session = session,
                    pendingSyncCount = pendingSyncCount,
                    syncRepo = syncRepo,
                    onUnauthorized = { msg -> onSignedOut(msg) }
                )

                SmavRoute.PRINTER_SETTINGS -> PrinterSettingsScreen(
                    session = session,
                    sessionManager = sessions,
                    printerManager = printerManager
                )

                SmavRoute.INTEGRATION_DIAGNOSTICS -> if (session.role.isAdminOrAbove()) {
                    IntegrationDiagnosticsScreen(
                        session = session,
                        adminRepo = adminRepo,
                        onUnauthorized = { msg -> onSignedOut(msg) }
                    )
                }
            }
        }
    }

    if (showOutletSwitcher) {
        OutletSelectorDialog(
            outlets = session.assignedOutlets,
            currentOutletId = session.businessId,
            onSelect = { option ->
                showOutletSwitcher = false
                scope.launch {
                    val res = if (session.role.isSuperadmin() && safeRoute == SmavRoute.POS_BILLING) {
                        adminRepo.launchSuperadminPos(option.businessId)
                    } else {
                        adminRepo.switchOutlet(option.businessId)
                    }
                    res.onSuccess { updated ->
                        onSessionUpdated(updated)
                    }.onFailure { err ->
                        if (err is UnauthorizedSessionException) {
                            onSignedOut(err.message)
                        }
                    }
                }
            },
            onDismiss = { showOutletSwitcher = false }
        )
    }
}

@Composable
private fun LoginLabel(text: String) {
    Text(
        text = text,
        color = SmavColors.TextPrimary,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(bottom = 5.dp)
    )
}

@Composable
private fun loginFieldColors() = smavOutlinedFieldColors()

