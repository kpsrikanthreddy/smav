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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smav.printagent.bluetooth.BluetoothPrinterManager
import com.smav.printagent.bluetooth.EscPosBuilder
import com.smav.printagent.data.repository.SessionManager
import com.smav.printagent.model.*
import com.smav.printagent.ui.components.*
import com.smav.printagent.ui.theme.*
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
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF141B36)),
                border = BorderStroke(1.dp, Color(0xFF2B355F)),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Thermal Paper Width", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
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

                    Text("Active Printer Role", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(top = 4.dp))
                    FilterFlowRow(
                        items = PrinterPurpose.entries,
                        selected = selectedPurpose,
                        labelOf = { it.label },
                        onSelect = { selectedPurpose = it }
                    )

                    val savedMac = sessionManager.getPrinterMac(selectedPurpose)
                    val connState = statusMap[selectedPurpose] ?: PrinterConnectionStatus.DISCONNECTED
                    Text(
                        "Saved MAC: ${savedMac ?: "None"} • Status: ${connState.name}",
                        color = if (connState == PrinterConnectionStatus.CONNECTED) Emerald500 else Color(0xFF94A3B8),
                        fontSize = 12.sp
                    )

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { scanDevices() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF2D82)),
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.BluetoothSearching, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Scan Paired Printers", fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
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
                            },
                            enabled = !busy,
                            modifier = Modifier.heightIn(min = 48.dp)
                        ) {
                            Icon(Icons.Default.Print, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Test Print")
                        }
                    }
                }
            }
        }

        if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Color(0xFFFF2D82)) }
        if (statusMessage != null) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF161D3B))) {
                    Text(statusMessage!!, color = Sky400, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
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
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF121629)),
                    border = BorderStroke(1.dp, if (isAssigned) Emerald500 else Color(0xFF252E54)),
                    shape = RoundedCornerShape(14.dp)
                ) {
                    Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(dev.name, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text(dev.address, color = Color(0xFF94A3B8), fontSize = 12.sp)
                            }
                            if (isAssigned) StatusBadgeChip("Assigned", Emerald500)
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
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
                                },
                                modifier = Modifier.heightIn(min = 46.dp)
                            ) { Text("Connect & Assign") }

                            if (isAssigned) {
                                OutlinedButton(
                                    onClick = {
                                        printerManager.disconnect(selectedPurpose)
                                        sessionManager.clearPrinterMac(selectedPurpose)
                                        statusMessage = "Unassigned ${dev.name} from ${selectedPurpose.label}."
                                    },
                                    modifier = Modifier.heightIn(min = 46.dp)
                                ) { Text("Disconnect") }
                            }
                        }
                    }
                }
            }
        }
    }
}
