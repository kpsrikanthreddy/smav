package com.smav.printagent.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.SettingsInputComponent
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
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
import kotlinx.coroutines.launch
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun IntegrationDiagnosticsScreen(
    session: StaffSession,
    adminRepo: AdminNetworkRepository,
    onUnauthorized: (String) -> Unit
) {
    if (!session.role.isAdminOrAbove()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp)
        ) {
            EmptyStateCard(
                title = "Access Restricted",
                subtitle = "Integration diagnostics are restricted to Outlet Administrators and Superadmins.",
                icon = Icons.Default.Warning
            )
        }
        return
    }

    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val isSuperadmin = session.role.isSuperadmin()

    var outlets by remember { mutableStateOf<List<AdminOutletItem>>(emptyList()) }
    var selectedOutletId by remember(session.businessId, isSuperadmin) {
        mutableStateOf(if (isSuperadmin) "" else session.businessId)
    }
    var report by remember { mutableStateOf<IntegrationDiagnosticReport?>(null) }
    var loading by remember { mutableStateOf(true) }
    var probing by remember { mutableStateOf(false) }
    var dispatching by remember { mutableStateOf(false) }
    var banner by remember { mutableStateOf<String?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    // Guarded confirmed E2E test controls
    var e2eOutletId by remember(session.businessId) { mutableStateOf(session.businessId) }
    var testPhone by remember { mutableStateOf("") }
    var confirmedE2E by remember { mutableStateOf(false) }
    var runningE2E by remember { mutableStateOf(false) }
    var e2eResult by remember { mutableStateOf<IntegrationE2EResult?>(null) }

    fun loadDiagnostics(probe: Boolean = false) {
        scope.launch {
            if (probe) probing = true else loading = true
            errorMsg = null
            val scopeId = if (isSuperadmin) selectedOutletId.ifBlank { null } else session.businessId
            adminRepo.runIntegrationDiagnostics(outletId = scopeId, probeEndpoints = probe)
                .onSuccess { report = it }
                .onFailure { err ->
                    if (err is UnauthorizedSessionException) {
                        onUnauthorized(err.message ?: "Session expired.")
                    } else {
                        errorMsg = SmavApiClient.friendlyThrowable(err, "Unable to load integration diagnostics.")
                    }
                }
            loading = false
            probing = false
        }
    }

    LaunchedEffect(session.userId, session.businessId, selectedOutletId) {
        if (isSuperadmin && outlets.isEmpty()) {
            adminRepo.getSuperadminOutlets().onSuccess { list ->
                outlets = list
                if (e2eOutletId == "central_smav" && list.isNotEmpty()) {
                    e2eOutletId = list.first().id
                }
            }
        }
        loadDiagnostics(false)
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
                    Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                        Text(
                            text = "Central Billing & WhatsApp Diagnostics",
                            color = SmavColors.TextPrimary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 17.sp
                        )
                        Text(
                            text = "Verify Stage 1 central Supabase save, Stage 2 HMAC queue & 2-min feedback timing, and Stage 3 outlet receiver delivery.",
                            color = SmavColors.TextSecondary,
                            fontSize = 12.sp
                        )
                    }
                    Icon(
                        imageVector = Icons.Default.SettingsInputComponent,
                        contentDescription = null,
                        tint = SmavColors.AccentPink
                    )
                }

                if (isSuperadmin && outlets.isNotEmpty()) {
                    Text(
                        text = "Scope Outlet",
                        color = SmavColors.TextPrimary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    FilterFlowRow(
                        items = listOf("") + outlets.map { it.id },
                        selected = selectedOutletId,
                        labelOf = { id ->
                            if (id.isBlank()) "All (${outlets.size})"
                            else outlets.firstOrNull { it.id == id }?.name ?: id
                        },
                        onSelect = { selectedOutletId = it }
                    )
                }

                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SmavSecondaryButton(
                        text = if (probing) "Probing HTTPS..." else "Run Diagnostics + Probe",
                        icon = Icons.Default.Refresh,
                        enabled = !loading && !probing && !dispatching,
                        onClick = {
                            banner = null
                            loadDiagnostics(true)
                        }
                    )
                    SmavGradientButton(
                        text = if (dispatching) "Dispatching..." else "Dispatch Queue Now",
                        icon = Icons.Default.PlayArrow,
                        enabled = !loading && !dispatching,
                        busy = dispatching,
                        onClick = {
                            dispatching = true
                            banner = null
                            errorMsg = null
                            scope.launch {
                                adminRepo.dispatchIntegrationQueueNow()
                                    .onSuccess { count ->
                                        banner = "Dispatcher tick completed: $count due job(s) processed."
                                        loadDiagnostics(false)
                                    }
                                    .onFailure { err ->
                                        if (err is UnauthorizedSessionException) {
                                            onUnauthorized(err.message ?: "Session expired.")
                                        } else {
                                            errorMsg = SmavApiClient.friendlyThrowable(err, "Queue dispatch failed.")
                                        }
                                    }
                                dispatching = false
                            }
                        }
                    )
                }
            }
        }

        if (loading || probing) {
            item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        }
        if (banner != null) {
            item { SmavSuccessBannerCard(banner!!) }
        }
        if (errorMsg != null) {
            item { ErrorBannerCard(errorMsg!!, onRetry = { loadDiagnostics(false) }) }
        }

        report?.let { r ->
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SummaryStatCard(
                        title = "Central Backend & HMAC",
                        value = if (r.serviceRoleConfigured && r.dispatchSecretConfigured) "READY" else "INCOMPLETE",
                        subtitle = "Service Key: ${if (r.serviceRoleConfigured) "Set" else "Missing"} • HMAC Secret: ${if (r.dispatchSecretConfigured) "Set" else "Missing"} • Auto: ${if (r.internalDispatcherEnabled) "${r.internalDispatcherIntervalSec}s" else "Off"}",
                        accent = if (r.serviceRoleConfigured && r.dispatchSecretConfigured) SmavColors.StepperGreen else SmavColors.WarningText
                    )
                    SummaryStatCard(
                        title = "Central Supabase Connection",
                        value = if (r.supabaseConnected) "CONNECTED" else "UNAVAILABLE",
                        subtitle = r.supabaseError ?: "Bills: ${r.salonBillsCount} Salon • ${r.centralSalesCount} Central Sales",
                        accent = if (r.supabaseConnected) SmavColors.StepperGreen else SmavColors.DangerText
                    )
                    SummaryStatCard(
                        title = "Notification Queue (${r.totalJobs} Total)",
                        value = "${r.sentJobs} Sent • ${r.pendingJobs} Pending",
                        subtitle = "Failed: ${r.failedJobs} • Skipped: ${r.skippedJobs}",
                        accent = if (r.failedJobs > 0) SmavColors.DangerText else SmavColors.InfoText
                    )
                }
            }

            item {
                Text(
                    text = "Outlet Notification Routes",
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }

            if (r.routes.isEmpty()) {
                item {
                    EmptyStateCard(
                        title = "No Outlet Routes",
                        subtitle = "No outlets matched your diagnostic scope."
                    )
                }
            } else {
                items(r.routes, key = { it.outletId }) { route ->
                    SmavCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                                Text(route.outletName, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text(
                                    "${route.outletCode.uppercase(Locale.ENGLISH)} • ${route.category}",
                                    color = SmavColors.TextSecondary,
                                    fontSize = 12.sp
                                )
                            }
                            StatusBadgeChip(
                                text = when {
                                    route.enabled -> "ENABLED"
                                    route.configured -> "DISABLED"
                                    else -> "UNSEEDED"
                                },
                                color = if (route.enabled) SmavColors.StepperGreen else SmavColors.WarningText
                            )
                        }

                        Text(
                            text = route.endpointUrl.ifBlank { "No endpoint seeded in smav_outlet_notification_routes" },
                            color = SmavColors.InfoText,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp
                        )

                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            StatusBadgeChip(
                                text = if (route.sendReceipts) {
                                    "Receipt: ${route.receiptTemplateName.ifBlank { "On" }}"
                                } else "Receipt: Off",
                                color = if (route.sendReceipts) SmavColors.StepperGreen else SmavColors.TextSecondary
                            )
                            StatusBadgeChip(
                                text = if (route.sendFeedback) {
                                    "Feedback (2m): ${route.feedbackTemplateName.ifBlank { "On" }}"
                                } else "Feedback: Off",
                                color = if (route.sendFeedback) SmavColors.InfoText else SmavColors.TextSecondary
                            )
                            if (route.lastHttpStatus != null) {
                                StatusBadgeChip(
                                    text = "Last HTTP ${route.lastHttpStatus}",
                                    color = if (route.lastHttpStatus in 200..299) SmavColors.StepperGreen else SmavColors.DangerText
                                )
                            }
                        }

                        if (!route.reachabilityMessage.isNullOrBlank()) {
                            Text(
                                text = "HTTPS Probe: ${route.reachabilityMessage}",
                                color = if (route.reachabilityReachable == true) SmavColors.StepperGreen else SmavColors.DangerText,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }
                        if (!route.lastError.isNullOrBlank()) {
                            Text(
                                text = "Last error: ${route.lastError}",
                                color = SmavColors.DangerText,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            // Guarded Confirmed Live E2E Test
            item {
                SmavCard {
                    Text(
                        text = "Confirmed End-to-End Integration Test (Optional)",
                        color = SmavColors.TextPrimary,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )
                    Text(
                        text = "Runs one real Stage 1 -> Stage 2 -> Stage 3 dispatch only when explicitly confirmed with an authorized test WhatsApp number.",
                        color = SmavColors.TextSecondary,
                        fontSize = 12.sp
                    )

                    if (isSuperadmin && outlets.isNotEmpty()) {
                        FilterFlowRow(
                            items = outlets.map { it.id },
                            selected = e2eOutletId,
                            labelOf = { id -> outlets.firstOrNull { it.id == id }?.name ?: id },
                            onSelect = { e2eOutletId = it }
                        )
                    }

                    OutlinedTextField(
                        value = testPhone,
                        onValueChange = { testPhone = it },
                        label = { Text("Authorized Test WhatsApp Number") },
                        placeholder = { Text("e.g. 9198XXXXXXXX", color = SmavColors.TextMuted) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        singleLine = true,
                        colors = smavOutlinedFieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Checkbox(
                            checked = confirmedE2E,
                            onCheckedChange = { confirmedE2E = it }
                        )
                        Text(
                            text = "I confirm this is an authorized test phone number.",
                            color = SmavColors.TextPrimary,
                            fontSize = 12.sp
                        )
                    }

                    SmavGradientButton(
                        text = if (runningE2E) "Running E2E Test..." else "Run Confirmed E2E Test",
                        icon = Icons.Default.Send,
                        enabled = !runningE2E && confirmedE2E && testPhone.isNotBlank(),
                        busy = runningE2E,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            if (!confirmedE2E || testPhone.isBlank()) {
                                errorMsg = "Confirm the test phone checkbox and enter a valid WhatsApp number."
                            } else {
                                runningE2E = true
                                errorMsg = null
                                e2eResult = null
                                scope.launch {
                                    val targetId = if (isSuperadmin) e2eOutletId.ifBlank { null } else session.businessId
                                    adminRepo.runConfirmedE2ETest(targetId, testPhone, true)
                                        .onSuccess { res ->
                                            e2eResult = res
                                            loadDiagnostics(false)
                                        }
                                        .onFailure { err ->
                                            if (err is UnauthorizedSessionException) {
                                                onUnauthorized(err.message ?: "Session expired.")
                                            } else {
                                                errorMsg = SmavApiClient.friendlyThrowable(err, "Confirmed E2E test failed.")
                                            }
                                        }
                                    runningE2E = false
                                }
                            }
                        }
                    )

                    e2eResult?.let { res ->
                        HorizontalDivider(color = SmavColors.Border)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Test Bill: ${res.billNumber.ifBlank { "N/A" }}",
                                color = SmavColors.TextPrimary,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            StatusBadgeChip(
                                text = if (res.success) "PASSED" else "FAILED",
                                color = if (res.success) SmavColors.StepperGreen else SmavColors.DangerText
                            )
                        }
                        Text(
                            text = "Event: ${res.eventType} • HTTP ${res.httpStatus ?: "N/A"} • WA: ${res.whatsappStatus.ifBlank { "unknown" }}",
                            color = SmavColors.TextSecondary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp
                        )
                        res.steps.forEach { st ->
                            Text(
                                text = "[${st.status.uppercase(Locale.ENGLISH)}] ${st.step}: ${st.detail}",
                                color = SmavColors.TextPrimary,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }

            item {
                Text(
                    text = "Recent Notification Jobs",
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }

            if (r.recentJobs.isEmpty()) {
                item {
                    EmptyStateCard(
                        title = "No Notification Jobs Yet",
                        subtitle = "Bills with customer phone numbers queue WhatsApp jobs automatically."
                    )
                }
            } else {
                items(r.recentJobs, key = { it.id }) { job ->
                    SmavCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                                Text(
                                    text = job.billNumber,
                                    color = SmavColors.TextPrimary,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 13.sp
                                )
                                Text(
                                    text = "${job.sourceType} • ${job.eventType} • ${job.maskedPhone.ifBlank { "No phone" }}",
                                    color = SmavColors.TextSecondary,
                                    fontSize = 11.sp
                                )
                            }
                            StatusBadgeChip(
                                text = job.status.uppercase(Locale.ENGLISH),
                                color = when (job.status.lowercase(Locale.ENGLISH)) {
                                    "sent", "accepted" -> SmavColors.StepperGreen
                                    "failed" -> SmavColors.DangerText
                                    "skipped" -> SmavColors.WarningText
                                    else -> SmavColors.InfoText
                                }
                            )
                        }
                        Text(
                            text = "HTTP: ${job.lastHttpStatus?.toString() ?: "Pending"} • WA: ${job.whatsappStatus.ifBlank { "pending" }}${if (job.whatsappMessageId.isNotBlank()) " • ID: ${job.whatsappMessageId}" else ""}",
                            color = SmavColors.TextSecondary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (!job.lastError.isNullOrBlank()) {
                            Text(
                                text = job.lastError,
                                color = SmavColors.DangerText,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }

            item {
                Text(
                    text = "Sanitized Pipeline Logs",
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }

            if (r.recentLogs.isEmpty()) {
                item {
                    EmptyStateCard(
                        title = "No Step Logs Recorded",
                        subtitle = "Sanitized pipeline events appear after bills sync or dispatch."
                    )
                }
            } else {
                items(r.recentLogs.take(25), key = { it.id }) { log ->
                    SmavCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "${log.step}${if (log.billNumber.isNotBlank()) " • ${log.billNumber}" else ""}",
                                color = SmavColors.TextPrimary,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 12.sp,
                                modifier = Modifier.weight(1f).padding(end = 8.dp)
                            )
                            StatusBadgeChip(
                                text = log.status.uppercase(Locale.ENGLISH),
                                color = when (log.status.lowercase(Locale.ENGLISH)) {
                                    "sent", "accepted", "queued", "ok" -> SmavColors.StepperGreen
                                    "failed" -> SmavColors.DangerText
                                    "skipped", "retry" -> SmavColors.WarningText
                                    else -> SmavColors.InfoText
                                }
                            )
                        }
                        Text(
                            text = "HTTP: ${log.httpStatus?.toString() ?: "-"} • WA: ${log.whatsappStatus.ifBlank { "-" }} • ${log.maskedPhone.ifBlank { "-" }}",
                            color = SmavColors.TextSecondary,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp
                        )
                        if (!log.sanitizedError.isNullOrBlank()) {
                            Text(log.sanitizedError, color = SmavColors.DangerText, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}
