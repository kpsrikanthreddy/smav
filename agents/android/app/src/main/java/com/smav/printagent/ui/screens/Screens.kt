package com.smav.printagent.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.model.*
import com.smav.printagent.ui.theme.*

// -------------------------------------------------------------------------------------------------
// 1. OFFLINE BANNER COMPONENT
// -------------------------------------------------------------------------------------------------
@Composable
fun OfflineNoticeBanner(isOnline: Boolean, pendingCount: Int) {
    if (!isOnline) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp),
            colors = CardDefaults.cardColors(containerColor = Amber500.copy(alpha = 0.2f)),
            shape = RoundedCornerShape(8.dp)
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.CloudOff, contentDescription = "Offline", tint = Amber500)
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "Offline – bills are saved safely on this device",
                        fontWeight = FontWeight.Bold,
                        color = Amber500,
                        fontSize = 13.sp
                    )
                    Text(
                        text = "$pendingCount transaction(s) queued for cloud sync",
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// 2. UNIFIED ENTERPRISE LOGIN SCREEN (MATCHES STARTERS4U RESTAURANT ADMIN PORTAL SCREENSHOT)
// -------------------------------------------------------------------------------------------------
@Composable
fun LoginScreen(
    onLoginSuccess: (StaffSession) -> Unit,
    onMultiBusinessFound: (List<AvailableBusinessOption>, String) -> Unit
) {
    var emailOrId by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var outletCode by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val gradientBrush = Brush.horizontalGradient(
        colors = listOf(Color(0xFFFF1B7A), Color(0xFFFF6A00), Color(0xFFFFA500))
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0E1B))
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 440.dp),
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
            border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF1E2540))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Top Centered Squircle Icon (Dark Violet Background with Pink Printer Icon)
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xFF1D1F3B))
                        .border(1.dp, Color(0xFF2B2F56), RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Print,
                        contentDescription = "SMAV Print Agent",
                        tint = Color(0xFFFF3B80),
                        modifier = Modifier.size(28.dp)
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                Text(
                    text = "SMAV Print Agent",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )

                Text(
                    text = "Secure Multi-Business POS & Thermal Printing",
                    fontSize = 12.sp,
                    color = Color(0xFF94A3B8),
                    modifier = Modifier.padding(top = 2.dp, bottom = 20.dp)
                )

                if (errorMessage != null) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 14.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0x33E11D48)),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text(
                            text = errorMessage!!,
                            color = Color(0xFFFDA4AF),
                            fontSize = 12.sp,
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }

                // Field 1: Email Address / User ID
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Email Address / User ID",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFCBD5E1),
                        modifier = Modifier.padding(bottom = 6.dp)
                    )
                    OutlinedTextField(
                        value = emailOrId,
                        onValueChange = { emailOrId = it },
                        placeholder = { Text("Enter registered email or user ID", color = Color(0xFF64748B), fontSize = 13.sp) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = Color(0xFF161A33),
                            unfocusedContainerColor = Color(0xFF161A33),
                            focusedBorderColor = Color(0xFFFF3B80),
                            unfocusedBorderColor = Color(0xFF2A3055),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Field 2: Password / PIN with Show/Hide toggle
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Password / PIN",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFCBD5E1),
                        modifier = Modifier.padding(bottom = 6.dp)
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        placeholder = { Text("Enter password", color = Color(0xFF64748B), fontSize = 13.sp) },
                        singleLine = true,
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        trailingIcon = {
                            IconButton(onClick = { showPassword = !showPassword }) {
                                Icon(
                                    if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = "Toggle password visibility",
                                    tint = Color(0xFF94A3B8)
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = Color(0xFF161A33),
                            unfocusedContainerColor = Color(0xFF161A33),
                            focusedBorderColor = Color(0xFFFF3B80),
                            unfocusedBorderColor = Color(0xFF2A3055),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Field 3: Outlet Code (optional)
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Outlet Code (optional)",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFFCBD5E1),
                        modifier = Modifier.padding(bottom = 6.dp)
                    )
                    OutlinedTextField(
                        value = outletCode,
                        onValueChange = { outletCode = it },
                        placeholder = { Text("e.g. mozz, glossylooks", color = Color(0xFF64748B), fontSize = 13.sp) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = Color(0xFF161A33),
                            unfocusedContainerColor = Color(0xFF161A33),
                            focusedBorderColor = Color(0xFFFF3B80),
                            unfocusedBorderColor = Color(0xFF2A3055),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White
                        )
                    )
                    Text(
                        text = "Used to identify an outlet's authentication provider when required.",
                        fontSize = 11.sp,
                        color = Color(0xFF64748B),
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                // Pink-to-Orange Gradient Sign In Button
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(gradientBrush)
                        .padding(2.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFF242938))
                        .clickable {
                            errorMessage = if (emailOrId.isBlank() || password.isBlank()) {
                                "Please enter both Email/ID and Password."
                            } else {
                                "Sign in through the primary SMAV authentication gateway."
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Login, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (isLoading) "Verifying..." else "Sign In",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "Forgot Password? Contact your outlet administrator.",
                    fontSize = 12.sp,
                    color = Color(0xFF94A3B8)
                )
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// 3. SEPARATE MULTI-BUSINESS SELECTION SCREEN
// -------------------------------------------------------------------------------------------------
@Composable
fun MultiBusinessSelectionScreen(
    availableBusinesses: List<AvailableBusinessOption>,
    onSelectBusiness: (AvailableBusinessOption) -> Unit,
    onBack: (() -> Unit)? = null,
    busy: Boolean = false,
    errorMessage: String? = null
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0B0E1B))
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (onBack != null) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
                TextButton(onClick = onBack, enabled = !busy) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = Color(0xFF8FA6D7))
                    Spacer(Modifier.width(6.dp))
                    Text("Back to Sign In", color = Color(0xFF8FA6D7))
                }
            }
        } else {
            Spacer(modifier = Modifier.height(16.dp))
        }
        Text(
            text = "Select Authorized Outlet",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )
        Text(
            text = "Your account has access to multiple outlets. Select active workspace:",
            fontSize = 13.sp,
            color = Color(0xFF94A3B8),
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp)
        )

        if (busy) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                color = Color(0xFFFF2D82)
            )
        }
        if (!errorMessage.isNullOrBlank()) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0x33E11D48)),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text(errorMessage, color = Color(0xFFFDA4AF), fontSize = 13.sp, modifier = Modifier.padding(12.dp))
            }
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(availableBusinesses) { bus ->
                val normType = bus.normalizedBusinessType
                val icon = when (normType) {
                    BusinessType.SALON -> Icons.Default.ContentCut
                    BusinessType.RESTAURANT -> Icons.Default.Restaurant
                    BusinessType.RETAIL -> Icons.Default.ShoppingBag
                    BusinessType.OTHER -> Icons.Default.Store
                }
                val accent = when (normType) {
                    BusinessType.SALON -> Rose600
                    BusinessType.RESTAURANT -> Amber500
                    BusinessType.RETAIL -> Sky400
                    BusinessType.OTHER -> Color(0xFF94A3B8)
                }
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !busy) { onSelectBusiness(bus) },
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF161A33)),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF2B355F)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            icon,
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = bus.businessName,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Text(
                                text = "${normType.displayName} • ${bus.branchCode.ifBlank { "OUTLET" }} • ${bus.displayRole.ifBlank { bus.role.uppercase() }}",
                                fontSize = 12.sp,
                                color = Color(0xFF94A3B8)
                            )
                        }
                        Icon(Icons.Default.ArrowForwardIos, contentDescription = null, tint = Color(0xFF94A3B8), modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// 4. SALON POS DASHBOARD & MAIN SCREEN (GLOSSY LOOKS ONLY)
// -------------------------------------------------------------------------------------------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SalonMainScreen(
    session: StaffSession,
    isOnline: Boolean,
    pendingSyncCount: Int,
    printerStatus: PrinterConnectionStatus,
    onNewBillClick: () -> Unit,
    onSelectServicesClick: () -> Unit,
    onAppointmentsClick: () -> Unit,
    onPrintReceiptClick: () -> Unit,
    onSettingsClick: () -> Unit,
    onLogoutClick: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = session.businessName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp,
                            color = Color.White
                        )
                        Text(
                            text = "${session.branchName} • ${session.userName} (${session.role.label})",
                            fontSize = 11.sp,
                            color = Rose600
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onSettingsClick) {
                        Icon(
                            Icons.Default.Print,
                            contentDescription = "Printer Settings",
                            tint = if (printerStatus == PrinterConnectionStatus.CONNECTED) Emerald500 else Color.Gray
                        )
                    }
                    IconButton(onClick = onLogoutClick) {
                        Icon(Icons.Default.Logout, contentDescription = "Logout")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Slate900)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFF0B0E1B))
        ) {
            OfflineNoticeBanner(isOnline = isOnline, pendingCount = pendingSyncCount)

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Button(
                    onClick = onNewBillClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(64.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Rose600)
                ) {
                    Icon(Icons.Default.PointOfSale, contentDescription = null, modifier = Modifier.size(26.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Text("NEW SALON BILL", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = onSelectServicesClick,
                        modifier = Modifier
                            .weight(1f)
                            .height(52.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.ContentCut, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Services", fontWeight = FontWeight.SemiBold)
                    }

                    OutlinedButton(
                        onClick = onAppointmentsClick,
                        modifier = Modifier
                            .weight(1f)
                            .height(52.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.CalendarToday, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Appointments", fontWeight = FontWeight.SemiBold)
                    }
                }

                OutlinedButton(
                    onClick = onPrintReceiptClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(Icons.Default.ReceiptLong, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Print Receipt & Recent Bills")
                }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// 5. RESTAURANT POS DASHBOARD & MAIN SCREEN (MOZZ / STARTERS4U ONLY)
// -------------------------------------------------------------------------------------------------
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RestaurantMainScreen(
    session: StaffSession,
    isOnline: Boolean,
    pendingSyncCount: Int,
    printerStatus: PrinterConnectionStatus,
    onNewOrderClick: () -> Unit,
    onSelectMenuClick: () -> Unit,
    onPendingOrdersClick: () -> Unit,
    onPrintKotClick: () -> Unit,
    onPrintBillClick: () -> Unit,
    onSettingsClick: () -> Unit,
    onLogoutClick: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = session.businessName,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp,
                            color = Color.White
                        )
                        Text(
                            text = "${session.branchName} • ${session.userName} (${session.role.label})",
                            fontSize = 11.sp,
                            color = Amber500
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onSettingsClick) {
                        Icon(
                            Icons.Default.Print,
                            contentDescription = "Printer Settings",
                            tint = if (printerStatus == PrinterConnectionStatus.CONNECTED) Emerald500 else Color.Gray
                        )
                    }
                    IconButton(onClick = onLogoutClick) {
                        Icon(Icons.Default.Logout, contentDescription = "Logout")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Slate900)
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFF0B0E1B))
        ) {
            OfflineNoticeBanner(isOnline = isOnline, pendingCount = pendingSyncCount)

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Button(
                    onClick = onNewOrderClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(64.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Amber500)
                ) {
                    Icon(Icons.Default.RestaurantMenu, contentDescription = null, modifier = Modifier.size(26.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Text("NEW COUNTER ORDER", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(
                        onClick = onSelectMenuClick,
                        modifier = Modifier
                            .weight(1f)
                            .height(52.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.MenuBook, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Menu", fontWeight = FontWeight.SemiBold)
                    }

                    OutlinedButton(
                        onClick = onPendingOrdersClick,
                        modifier = Modifier
                            .weight(1f)
                            .height(52.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.AccessTime, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Live Orders", fontWeight = FontWeight.SemiBold)
                    }
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = onPrintKotClick,
                        modifier = Modifier
                            .weight(1f)
                            .height(50.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Slate800),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.Kitchen, contentDescription = null)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Print KOT (No Prices)", fontSize = 12.sp)
                    }

                    Button(
                        onClick = onPrintBillClick,
                        modifier = Modifier
                            .weight(1f)
                            .height(50.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Slate800),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.Receipt, contentDescription = null)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Print Bill", fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
