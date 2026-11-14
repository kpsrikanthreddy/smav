package com.smav.printagent

import android.app.Application
import com.smav.printagent.bluetooth.BluetoothPrinterManager
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.data.repository.SessionManager

class SMAVApplication : Application() {

    lateinit var database: AppDatabase
        private set

    lateinit var sessionManager: SessionManager
        private set

    lateinit var printerManager: BluetoothPrinterManager
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        database = AppDatabase.getInstance(this)
        sessionManager = SessionManager(this)
        printerManager = BluetoothPrinterManager.getInstance(this)
    }

    companion object {
        lateinit var instance: SMAVApplication
            private set
    }
}
