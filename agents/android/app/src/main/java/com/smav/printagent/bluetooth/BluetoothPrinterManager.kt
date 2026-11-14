package com.smav.printagent.bluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import com.smav.printagent.model.BluetoothDeviceItem
import com.smav.printagent.model.PaperWidth
import com.smav.printagent.model.PrinterConnectionStatus
import com.smav.printagent.model.PrinterPurpose
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

/**
 * Manages Bluetooth Classic Serial Port Profile (SPP) connections to 58mm & 80mm ESC/POS thermal printers.
 * SPP UUID: 00001101-0000-1000-8000-00805F9B34FB
 */
class BluetoothPrinterManager private constructor(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private val bluetoothAdapter: BluetoothAdapter? by lazy { BluetoothAdapter.getDefaultAdapter() }

    private val activeSockets = mutableMapOf<PrinterPurpose, BluetoothSocket>()
    private val activeMacs = mutableMapOf<PrinterPurpose, String>()

    private val _connectionStatus = MutableStateFlow<Map<PrinterPurpose, PrinterConnectionStatus>>(
        mapOf(
            PrinterPurpose.SALON_RECEIPT to PrinterConnectionStatus.DISCONNECTED,
            PrinterPurpose.RESTAURANT_BILL to PrinterConnectionStatus.DISCONNECTED,
            PrinterPurpose.RESTAURANT_KOT to PrinterConnectionStatus.DISCONNECTED
        )
    )
    val connectionStatus: StateFlow<Map<PrinterPurpose, PrinterConnectionStatus>> = _connectionStatus.asStateFlow()

    @SuppressLint("MissingPermission")
    fun getPairedDevices(): List<BluetoothDeviceItem> {
        val adapter = bluetoothAdapter ?: return emptyList()
        if (!adapter.isEnabled) return emptyList()

        return try {
            adapter.bondedDevices.map { device ->
                BluetoothDeviceItem(
                    name = device.name ?: "Unknown Bluetooth Thermal Printer",
                    address = device.address,
                    isPaired = true,
                    isConnected = isDeviceConnected(device.address),
                    paperWidth = PaperWidth.WIDTH_80MM
                )
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun isDeviceConnected(macAddress: String): Boolean {
        return activeSockets.values.any { it.isConnected && it.remoteDevice.address.equals(macAddress, ignoreCase = true) }
    }

    @SuppressLint("MissingPermission")
    suspend fun connectPrinter(
        macAddress: String,
        purpose: PrinterPurpose
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val adapter = bluetoothAdapter ?: return@withContext Result.failure(IllegalStateException("Bluetooth not supported"))
        if (!adapter.isEnabled) {
            return@withContext Result.failure(IllegalStateException("Bluetooth is disabled. Please turn on Bluetooth."))
        }

        updateStatus(purpose, PrinterConnectionStatus.CONNECTING)
        disconnect(purpose)

        try {
            val device = adapter.getRemoteDevice(macAddress)
            adapter.cancelDiscovery()

            val socket = device.createRfcommSocketToServiceRecord(sppUuid)
            socket.connect()

            activeSockets[purpose] = socket
            activeMacs[purpose] = macAddress
            updateStatus(purpose, PrinterConnectionStatus.CONNECTED)

            PrinterForegroundService.startService(context, device.name ?: "Thermal Printer")
            Result.success(Unit)
        } catch (e: IOException) {
            updateStatus(purpose, PrinterConnectionStatus.FAILED)
            Result.failure(e)
        }
    }

    suspend fun printBytes(
        bytes: ByteArray,
        purpose: PrinterPurpose
    ): Result<Unit> = withContext(Dispatchers.IO) {
        var socket = activeSockets[purpose]

        if (socket == null || !socket.isConnected) {
            val mac = activeMacs[purpose]
            if (mac != null) {
                val reconnectResult = connectPrinter(mac, purpose)
                if (reconnectResult.isFailure) {
                    return@withContext Result.failure(IOException("Printer offline. Could not auto-reconnect to $mac"))
                }
                socket = activeSockets[purpose]
            } else {
                return@withContext Result.failure(IllegalStateException("No printer assigned for purpose: ${purpose.label}"))
            }
        }

        updateStatus(purpose, PrinterConnectionStatus.PRINTING)

        return@withContext try {
            val outputStream: OutputStream = socket?.outputStream
                ?: throw IOException("Printer output stream unavailable")
            outputStream.write(bytes)
            outputStream.flush()
            updateStatus(purpose, PrinterConnectionStatus.CONNECTED)
            Result.success(Unit)
        } catch (e: Exception) {
            updateStatus(purpose, PrinterConnectionStatus.FAILED)
            Result.failure(e)
        }
    }

    fun disconnect(purpose: PrinterPurpose) {
        try {
            activeSockets[purpose]?.close()
        } catch (_: Exception) {}
        activeSockets.remove(purpose)
        updateStatus(purpose, PrinterConnectionStatus.DISCONNECTED)

        if (activeSockets.isEmpty()) {
            PrinterForegroundService.stopService(context)
        }
    }

    private fun updateStatus(purpose: PrinterPurpose, status: PrinterConnectionStatus) {
        val current = _connectionStatus.value.toMutableMap()
        current[purpose] = status
        _connectionStatus.value = current
    }

    companion object {
        @Volatile
        private var INSTANCE: BluetoothPrinterManager? = null

        fun getInstance(context: Context): BluetoothPrinterManager {
            return INSTANCE ?: synchronized(this) {
                val instance = BluetoothPrinterManager(context.applicationContext)
                INSTANCE = instance
                instance
            }
        }
    }
}
