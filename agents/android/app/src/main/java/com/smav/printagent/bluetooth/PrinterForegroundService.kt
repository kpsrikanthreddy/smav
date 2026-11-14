package com.smav.printagent.bluetooth

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.smav.printagent.MainActivity

/**
 * Foreground Service conforming to Android 14 requirements with foregroundServiceType="connectedDevice".
 * Ensures the Android OS does not kill Bluetooth printer connections during active counter shifts.
 */
class PrinterForegroundService : Service() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val printerName = intent?.getStringExtra(EXTRA_PRINTER_NAME) ?: "80mm Thermal Printer"
        val notification = buildNotification(printerName)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SMAV Thermal Printer Connection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps thermal printer connection stable during billing"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(printerName: String): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SMAV Print Agent Active")
            .setContentText("Connected to $printerName - Ready for offline billing")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "smav_printer_service_channel"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_PRINTER_NAME = "extra_printer_name"

        fun startService(context: Context, printerName: String) {
            val intent = Intent(context, PrinterForegroundService::class.java).apply {
                putExtra(EXTRA_PRINTER_NAME, printerName)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stopService(context: Context) {
            val intent = Intent(context, PrinterForegroundService::class.java)
            context.stopService(intent)
        }
    }
}
