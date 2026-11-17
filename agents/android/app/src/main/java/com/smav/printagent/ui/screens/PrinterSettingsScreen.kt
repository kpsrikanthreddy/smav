package com.smav.printagent.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.bluetooth.BluetoothPrinterManager
import com.smav.printagent.bluetooth.EscPosBuilder
import com.smav.printagent.data.repository.SessionManager
import com.smav.printagent.model.*
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.SmavColors
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PrinterSettingsScreen(
    session: StaffSession,
    sessionManager: SessionManager,
    printerManager: BluetoothPrinterManager
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val statusMap by printerManager.connectionStatus.collectAsState()

    var pairedDevices by remember { mutableStateOf<List<BluetoothDeviceItem>>(emptyList()) }
    var selectedPaperWidth by remember { mutableStateOf(sessionManager.getPaperWidth()) }
    var selectedPurpose by remember {
        mutableStateOf(
            when (session.businessType) {
                BusinessType.RESTAURANT -> PrinterPurpose.RESTAURANT_BILL
                BusinessType.RETAIL -> PrinterPurpose.RETAIL_RECEIPT
                else -> PrinterPurpose.SALON_RECEIPT
            }
        )
    }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ ->
        pairedDevices = printerManager.getPairedDevices()
        if (pairedDevices.isEmpty()) {
            statusMessage = "No paired Bluetooth printers found. Pair your thermal printer in Android Bluetooth settings first."
        }
    }

    fun scanDevices() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissionLauncher.launch(
                arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
            )
        } else {
            pairedDevices = printerManager.getPairedDevices()
        }
    }

    LaunchedEffect(Unit) {
        pairedDevices = runCatching { printerManager.getPairedDevices() }.getOrElse { emptyList() }
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
                Text("Thermal Paper Width", color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                FilterFlowRow(
                    items = PaperWidth.entries,
                    selected = selectedPaperWidth,
                    labelOf = { "${it.widthMm}mm (${it.columns} cols)" },
                    onSelect = { w ->
                        selectedPaperWidth = w
                        sessionManager.setPaperWidth(w)
                        statusMessage = "Paper width set to ${w.widthMm}mm."
                    }
                )

                Text(
                    "Active Printer Role",
                    color = SmavColors.TextPrimary,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    modifier = Modifier.padding(top = 4.dp)
                )
                FilterFlowRow(
                    items = PrinterPurpose.entries,
                    selected = selectedPurpose,
                    labelOf = { it.label },
                    onSelect = { selectedPurpose = it }
                )

                val savedMac = sessionManager.getPrinterMac(selectedPurpose)
                val connState = statusMap[selectedPurpose] ?: PrinterConnectionStatus.DISCONNECTED
                Text(
                    text = "Saved MAC: ${savedMac ?: "None"} • Status: ${connState.name}",
                    color = if (connState == PrinterConnectionStatus.CONNECTED) SmavColors.StepperGreen else SmavColors.TextSecondary,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SmavGradientButton(
                        text = "Scan Paired Printers",
                        icon = Icons.Default.BluetoothSearching,
                        onClick = { scanDevices() }
                    )
                    SmavSecondaryButton(
                        text = "Test Print",
                        icon = Icons.Default.Print,
                        enabled = !busy,
                        onClick = {
                            busy = true; statusMessage = null
                            scope.launch {
                                val mac = sessionManager.getPrinterMac(selectedPurpose)
                                if (!mac.isNullOrBlank() && statusMap[selectedPurpose] != PrinterConnectionStatus.CONNECTED) {
                                    printerManager.connectPrinter(mac, selectedPurpose)
                                }
                                val testBytes = EscPosBuilder(selectedPaperWidth).apply {
                                    alignCenter()
                                    setBold(true)
                                    textLine("SMAV PRINT AGENT TEST")
                                    setBold(false)
                                    textLine(session.businessName)
                                    textLine("Purpose: ${selectedPurpose.label}")
                                    textLine("Width: ${selectedPaperWidth.widthMm}mm")
                                    divider()
                                    textLine("Printer connection verified.")
                                    newLine()
                                    cutPaper(true)
                                }.build()
                                val r = printerManager.printBytes(testBytes, selectedPurpose)
                                statusMessage = r.fold(
                                    { "Test print sent to ${selectedPurpose.label}." },
                                    { "Test print failed: ${it.message}" }
                                )
                                busy = false
                            }
                        }
                    )
                }
            }
        }

        if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = SmavColors.AccentPink) }
        if (statusMessage != null) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = SmavColors.InfoBg),
                    border = BorderStroke(1.dp, SmavColors.InfoBorder),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(statusMessage!!, color = SmavColors.InfoText, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(12.dp))
                }
            }
        }

        if (pairedDevices.isEmpty()) {
            item {
                EmptyStateCard(
                    title = "No Paired Bluetooth Printers Shown",
                    subtitle = "Tap \"Scan Paired Printers\" or pair your ESC/POS printer in Android Settings > Bluetooth.",
                    icon = Icons.Default.Bluetooth
                )
            }
        } else {
            items(pairedDevices, key = { it.address }) { dev ->
                val isAssigned = sessionManager.getPrinterMac(selectedPurpose).equals(dev.address, ignoreCase = true)
                SmavCard(highlighted = isAssigned, highlightColor = SmavColors.StepperGreen) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(dev.name, color = SmavColors.TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text(dev.address, color = SmavColors.TextSecondary, fontSize = 12.sp)
                        }
                        if (isAssigned) StatusBadgeChip("Assigned", SmavColors.StepperGreen)
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SmavGradientButton(
                            text = "Connect & Assign",
                            onClick = {
                                busy = true; statusMessage = null
                                scope.launch {
                                    sessionManager.savePrinterMac(selectedPurpose, dev.address)
                                    val res = printerManager.connectPrinter(dev.address, selectedPurpose)
                                    statusMessage = res.fold(
                                        { "Connected ${dev.name} as ${selectedPurpose.label}." },
                                        { "Saved ${dev.name}, connection pending: ${it.message}" }
                                    )
                                    busy = false
                                }
                            }
                        )

                        if (isAssigned) {
                            SmavSecondaryButton(
                                text = "Disconnect",
                                textColor = SmavColors.DangerText,
                                onClick = {
                                    printerManager.disconnect(selectedPurpose)
                                    sessionManager.clearPrinterMac(selectedPurpose)
                                    statusMessage = "Unassigned ${dev.name} from ${selectedPurpose.label}."
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
