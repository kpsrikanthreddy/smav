package com.smav.printagent.data.repository

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.smav.printagent.model.BusinessType
import com.smav.printagent.model.PaperWidth
import com.smav.printagent.model.PrinterPurpose
import com.smav.printagent.model.StaffSession
import com.smav.printagent.model.UserRole
import java.util.UUID

/**
 * Manages device credentials using Android EncryptedSharedPreferences (Hardware Keystore backed).
 * Enforces business and branch isolation with offline authorization cache.
 */
class SessionManager(context: Context) {

    private val gson = Gson()
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = try {
        EncryptedSharedPreferences.create(
            context,
            "smav_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        context.getSharedPreferences("smav_fallback_prefs", Context.MODE_PRIVATE)
    }

    val deviceId: String
        get() {
            var id = prefs.getString(KEY_DEVICE_ID, null)
            if (id == null) {
                id = "SMAV-DEV-" + UUID.randomUUID().toString().take(12).uppercase()
                prefs.edit().putString(KEY_DEVICE_ID, id).apply()
            }
            return id
        }

    fun saveStaffSession(session: StaffSession) {
        val permissionsJson = gson.toJson(session.permissions)
        prefs.edit()
            .putString(KEY_USER_ID, session.userId)
            .putString(KEY_USER_NAME, session.userName)
            .putString(KEY_USER_EMAIL, session.email)
            .putString(KEY_BUSINESS_ID, session.businessId)
            .putString(KEY_BUSINESS_TYPE, session.businessType.name)
            .putString(KEY_BUSINESS_NAME, session.businessName)
            .putString(KEY_BRANCH_ID, session.branchId)
            .putString(KEY_BRANCH_CODE, session.branchCode)
            .putString(KEY_BRANCH_NAME, session.branchName)
            .putString(KEY_ROLE, session.role.code)
            .putString(KEY_PERMISSIONS, permissionsJson)
            .putString(KEY_AUTH_TOKEN, session.token)
            .putBoolean(KEY_IS_LOGGED_IN, true)
            .putLong(KEY_LAST_LOGIN_TIME, System.currentTimeMillis())
            .apply()
    }

    fun getStaffSession(): StaffSession? {
        if (!isLoggedIn()) return null
        val userId = prefs.getString(KEY_USER_ID, "") ?: ""
        val userName = prefs.getString(KEY_USER_NAME, "Staff User") ?: "Staff User"
        val email = prefs.getString(KEY_USER_EMAIL, "") ?: ""
        val busId = prefs.getString(KEY_BUSINESS_ID, "the_glossy_looks") ?: "the_glossy_looks"
        val busTypeName = prefs.getString(KEY_BUSINESS_TYPE, BusinessType.SALON.name) ?: BusinessType.SALON.name
        val busType = try { BusinessType.valueOf(busTypeName) } catch (_: Exception) { BusinessType.SALON }
        val busName = prefs.getString(KEY_BUSINESS_NAME, busType.displayName) ?: busType.displayName
        val branchId = prefs.getString(KEY_BRANCH_ID, "branch_gl_gach") ?: "branch_gl_gach"
        val branchCode = prefs.getString(KEY_BRANCH_CODE, "GACH") ?: "GACH"
        val branchName = prefs.getString(KEY_BRANCH_NAME, "Main Branch") ?: "Main Branch"
        val roleCode = prefs.getString(KEY_ROLE, "cashier") ?: "cashier"
        val role = UserRole.values().firstOrNull { it.code == roleCode } ?: UserRole.CASHIER
        val token = prefs.getString(KEY_AUTH_TOKEN, "") ?: ""

        val permType = object : TypeToken<List<String>>() {}.type
        val permissions: List<String> = try {
            gson.fromJson(prefs.getString(KEY_PERMISSIONS, "[]"), permType) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }

        return StaffSession(
            token = token,
            userId = userId,
            userName = userName,
            email = email,
            businessId = busId,
            businessType = busType,
            businessName = busName,
            branchId = branchId,
            branchCode = branchCode,
            branchName = branchName,
            role = role,
            permissions = permissions,
            deviceId = deviceId
        )
    }

    fun isLoggedIn(): Boolean = prefs.getBoolean(KEY_IS_LOGGED_IN, false)

    fun clearSession() {
        prefs.edit()
            .remove(KEY_AUTH_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_BUSINESS_ID)
            .remove(KEY_BUSINESS_TYPE)
            .remove(KEY_BUSINESS_NAME)
            .remove(KEY_BRANCH_ID)
            .remove(KEY_BRANCH_CODE)
            .remove(KEY_ROLE)
            .remove(KEY_PERMISSIONS)
            .putBoolean(KEY_IS_LOGGED_IN, false)
            .apply()
    }

    // Printer Paper Width (58mm or 80mm)
    fun setPaperWidth(width: PaperWidth) {
        prefs.edit().putString(KEY_PAPER_WIDTH, width.name).apply()
    }

    fun getPaperWidth(): PaperWidth {
        val name = prefs.getString(KEY_PAPER_WIDTH, PaperWidth.WIDTH_80MM.name)
        return try {
            PaperWidth.valueOf(name ?: PaperWidth.WIDTH_80MM.name)
        } catch (_: Exception) {
            PaperWidth.WIDTH_80MM
        }
    }

    // Printer MAC assignments
    fun savePrinterMac(purpose: PrinterPurpose, mac: String) {
        prefs.edit().putString("printer_mac_${purpose.code}", mac).apply()
    }

    fun getPrinterMac(purpose: PrinterPurpose): String? {
        return prefs.getString("printer_mac_${purpose.code}", null)
    }

    fun getServerUrl(): String {
        return prefs.getString(KEY_SERVER_URL, "https://ais-dev-gnp7ewjrj46ennomdkm5uz-395144053850.asia-southeast1.run.app")
            ?: "https://ais-dev-gnp7ewjrj46ennomdkm5uz-395144053850.asia-southeast1.run.app"
    }

    fun setServerUrl(url: String) {
        prefs.edit().putString(KEY_SERVER_URL, url.trim().trimEnd('/')).apply()
    }

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USER_NAME = "user_name"
        private const val KEY_USER_EMAIL = "user_email"
        private const val KEY_BUSINESS_ID = "business_id"
        private const val KEY_BUSINESS_TYPE = "business_type"
        private const val KEY_BUSINESS_NAME = "business_name"
        private const val KEY_BRANCH_ID = "branch_id"
        private const val KEY_BRANCH_CODE = "branch_code"
        private const val KEY_BRANCH_NAME = "branch_name"
        private const val KEY_ROLE = "role"
        private const val KEY_PERMISSIONS = "permissions"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_IS_LOGGED_IN = "is_logged_in"
        private const val KEY_LAST_LOGIN_TIME = "last_login_time"
        private const val KEY_PAPER_WIDTH = "paper_width"
        private const val KEY_SERVER_URL = "server_url"
    }
}
