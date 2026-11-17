package com.smav.printagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Login
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
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
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

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
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var outletCode by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember(initialMessage) { mutableStateOf(initialMessage) }

    val pageBackground = Color(0xFF080D21)
    val cardBackground = Color(0xFF0E142A)
    val fieldBackground = Color(0xFF121832)
    val outline = Color(0xFF30385B)
    val secondaryText = Color(0xFF8FA6D7)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(pageBackground)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(8.dp),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(cardBackground, RoundedCornerShape(24.dp))
                .padding(horizontal = 22.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(
                modifier = Modifier.size(52.dp),
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF171E38),
                border = BorderStroke(1.dp, outline)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Print, "Printer", tint = Color(0xFFFF2D82), modifier = Modifier.size(28.dp))
                }
            }
            Spacer(Modifier.height(12.dp))
            Text("SMAV Print Agent", color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(3.dp))
            Text(
                "Secure Enterprise Authentication Gateway",
                color = Color(0xFF78A7E8),
                fontSize = 12.sp,
                maxLines = 1
            )
            Spacer(Modifier.height(20.dp))

            LoginLabel("Email Address or Username")
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                placeholder = { Text("name@company.com or username", color = Color(0xFF64749F)) },
                singleLine = true,
                colors = loginFieldColors(fieldBackground, outline),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().height(56.dp)
            )
            Spacer(Modifier.height(12.dp))

            LoginLabel("Password / PIN")
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                placeholder = { Text("Enter password", color = Color(0xFF64749F)) },
                singleLine = true,
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(
                            if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            "Show or hide password",
                            tint = secondaryText
                        )
                    }
                },
                colors = loginFieldColors(fieldBackground, outline),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().height(56.dp)
            )
            Spacer(Modifier.height(12.dp))

            LoginLabel("Outlet Code (optional)")
            OutlinedTextField(
                value = outletCode,
                onValueChange = { outletCode = it },
                placeholder = { Text("e.g. mozz, glossylooks", color = Color(0xFF64749F)) },
                singleLine = true,
                colors = loginFieldColors(fieldBackground, outline),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth().height(56.dp)
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Used to identify an outlet's authentication provider when required.",
                color = Color(0xFF78A7E8),
                fontSize = 11.sp,
                maxLines = 1,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(18.dp))

            Button(
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
                },
                enabled = !busy && username.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(3.dp, Brush.horizontalGradient(listOf(Color(0xFFFF1F81), Color(0xFFFFA000)))),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF24293A),
                    contentColor = Color.White,
                    disabledContainerColor = Color(0xFF24293A),
                    disabledContentColor = Color(0xFF71788D)
                )
            ) {
                Icon(Icons.Default.Login, contentDescription = null)
                Spacer(Modifier.width(12.dp))
                Text("Sign In", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }

            Spacer(Modifier.height(6.dp))
            TextButton(onClick = { message = "Please contact your outlet administrator to reset your credentials." }) {
                Text("Forgot Password? ", color = secondaryText)
                Text("Reset your credentials", color = Color(0xFFFF2D82), fontWeight = FontWeight.Bold)
            }
            if (busy) {
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(Modifier.fillMaxWidth(), color = Color(0xFFFF2D82))
            }
            if (message.isNotBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    message,
                    color = Color(0xFFFFA5B8),
                    textAlign = TextAlign.Center,
                    fontSize = 13.sp,
                    modifier = Modifier.fillMaxWidth()
                )
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
        text,
        color = Color(0xFFDCE7FF),
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)
    )
}

@Composable
private fun loginFieldColors(background: Color, outline: Color) = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    focusedContainerColor = background,
    unfocusedContainerColor = background,
    focusedBorderColor = Color(0xFF50618F),
    unfocusedBorderColor = outline,
    cursorColor = Color(0xFFFF2D82)
)
