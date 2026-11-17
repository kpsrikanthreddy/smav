package com.smav.printagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.model.*
import com.smav.printagent.ui.components.ErrorBannerCard
import com.smav.printagent.ui.theme.SmavColors

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
            colors = CardDefaults.cardColors(containerColor = SmavColors.WarningBg),
            border = BorderStroke(1.dp, SmavColors.WarningBorder),
            shape = RoundedCornerShape(10.dp)
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.CloudOff, contentDescription = "Offline", tint = SmavColors.WarningText)
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = "Offline – bills are saved safely on this device",
                        fontWeight = FontWeight.Bold,
                        color = SmavColors.WarningText,
                        fontSize = 13.sp
                    )
                    Text(
                        text = "$pendingCount transaction(s) queued for cloud sync",
                        color = SmavColors.TextPrimary,
                        fontSize = 12.sp
                    )
                }
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// 2. SEPARATE MULTI-BUSINESS SELECTION SCREEN
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
            .background(SmavColors.Background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (onBack != null) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
                TextButton(onClick = onBack, enabled = !busy) {
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = null,
                        tint = SmavColors.TextSecondary
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("Back to Sign In", color = SmavColors.TextSecondary, fontWeight = FontWeight.SemiBold)
                }
            }
        } else {
            Spacer(modifier = Modifier.height(16.dp))
        }
        Text(
            text = "Select Authorized Outlet",
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            color = SmavColors.TextPrimary
        )
        Text(
            text = "Your account has access to multiple outlets. Select active workspace:",
            fontSize = 13.sp,
            color = SmavColors.TextSecondary,
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp)
        )

        if (busy) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                color = SmavColors.AccentPink
            )
        }
        if (!errorMessage.isNullOrBlank()) {
            Box(modifier = Modifier.padding(bottom = 12.dp)) {
                ErrorBannerCard(message = errorMessage)
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
                    BusinessType.SALON -> SmavColors.AccentPink
                    BusinessType.RESTAURANT -> SmavColors.WarningText
                    BusinessType.RETAIL -> SmavColors.InfoText
                    BusinessType.OTHER -> SmavColors.TextSecondary
                }
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !busy) { onSelectBusiness(bus) },
                    colors = CardDefaults.cardColors(containerColor = SmavColors.Surface),
                    border = BorderStroke(1.dp, SmavColors.Border),
                    shape = RoundedCornerShape(16.dp),
                    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            color = accent.copy(alpha = 0.12f),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.size(44.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    icon,
                                    contentDescription = null,
                                    tint = accent,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = bus.businessName,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = SmavColors.TextPrimary
                            )
                            Text(
                                text = "${normType.displayName} • ${bus.branchCode.ifBlank { "OUTLET" }} • ${bus.displayRole.ifBlank { bus.role.uppercase() }}",
                                fontSize = 12.sp,
                                color = SmavColors.TextSecondary
                            )
                        }
                        Icon(
                            Icons.Default.ArrowForwardIos,
                            contentDescription = null,
                            tint = SmavColors.TextMuted,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }
        }
    }
}
