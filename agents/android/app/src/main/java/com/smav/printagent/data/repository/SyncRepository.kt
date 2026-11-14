package com.smav.printagent.data.repository

import android.content.Context
import com.smav.printagent.data.local.AppDatabase
import com.smav.printagent.network.ApiService
import com.smav.printagent.network.SyncBillPayload
import com.smav.printagent.network.SyncBillsRequest
import com.smav.printagent.network.SyncOrderPayload
import com.smav.printagent.network.SyncOrdersRequest
import com.smav.printagent.network.SyncPrintStatusRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class SyncRepository(
    private val context: Context,
    private val database: AppDatabase,
    private val sessionManager: SessionManager
) {

    private fun getApiService(): ApiService {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .build()

        val baseUrl = sessionManager.getServerUrl().let {
            if (it.endsWith("/")) it else "$it/"
        }

        val retrofit = Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        return retrofit.create(ApiService::class.java)
    }

    suspend fun syncAllPending(): Result<Int> = withContext(Dispatchers.IO) {
        val session = sessionManager.getStaffSession()
            ?: return@withContext Result.failure(IllegalStateException("No active staff session"))

        var totalSynced = 0
        val token = "Bearer ${session.token}"
        val api = getApiService()

        try {
            // 1. Sync pending Salon Bills (Only if session is salon authorized)
            val pendingBills = database.salonBillDao().getUnsyncedBills()
            if (pendingBills.isNotEmpty() && session.businessType.id == "the_glossy_looks") {
                val payloads = pendingBills.mapNotNull { bill ->
                    val items = database.salonBillDao().getItemsForBill(bill.id)
                    SyncBillPayload(
                        bill = bill,
                        items = items,
                        idempotencyKey = bill.idempotencyKey
                    )
                }

                val response = api.syncBills(token, SyncBillsRequest(payloads))
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    body.syncedIds.forEach { id ->
                        database.salonBillDao().updateSyncStatus(id, "SYNCED", null, body.serverTimestamp)
                    }
                    totalSynced += body.syncedIds.size
                }
            }

            // 2. Sync pending Restaurant Orders (Only if session is restaurant authorized)
            val pendingOrders = database.restaurantOrderDao().getUnsyncedOrders()
            if (pendingOrders.isNotEmpty() && session.businessType.id == "mozz_starters4u") {
                val payloads = pendingOrders.mapNotNull { order ->
                    val items = database.restaurantOrderDao().getItemsForOrder(order.id)
                    SyncOrderPayload(
                        order = order,
                        items = items,
                        idempotencyKey = order.idempotencyKey
                    )
                }

                val response = api.syncOrders(token, SyncOrdersRequest(payloads))
                if (response.isSuccessful && response.body()?.success == true) {
                    val body = response.body()!!
                    body.syncedIds.forEach { id ->
                        database.restaurantOrderDao().updateSyncStatus(id, "SYNCED", null, body.serverTimestamp)
                    }
                    totalSynced += body.syncedIds.size
                }
            }

            // 3. Sync Print Jobs status
            val pendingPrints = database.printJobDao().getPendingJobs()
            if (pendingPrints.isNotEmpty()) {
                api.syncPrintStatus(token, SyncPrintStatusRequest(pendingPrints))
            }

            Result.success(totalSynced)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
