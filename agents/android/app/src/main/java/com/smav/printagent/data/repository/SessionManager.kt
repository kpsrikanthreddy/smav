package com.smav.printagent.data.repository

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.smav.printagent.BuildConfig
import com.smav.printagent.model.AvailableBusinessOption
import com.smav.printagent.model.BranchOption
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
        val assignedJson = gson.toJson(session.assignedOutlets)
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
            .putString(KEY_DISPLAY_ROLE, session.visibleRole)
            .putString(KEY_PERMISSIONS, permissionsJson)
            .putString(KEY_ASSIGNED_OUTLETS, assignedJson)
            .putString(KEY_AUTH_TOKEN, session.token)
            .putBoolean(KEY_IS_LOGGED_IN, true)
            .putLong(KEY_LAST_LOGIN_TIME, session.lastValidatedAt)
            .apply()
    }

    fun getStaffSession(): StaffSession? {
        if (!isLoggedIn()) return null
        val userId = prefs.getString(KEY_USER_ID, "") ?: ""
        val userName = prefs.getString(KEY_USER_NAME, "Staff User") ?: "Staff User"
        val email = prefs.getString(KEY_USER_EMAIL, "") ?: ""
        val busId = prefs.getString(KEY_BUSINESS_ID, "") ?: ""
        val busTypeName = prefs.getString(KEY_BUSINESS_TYPE, BusinessType.OTHER.name) ?: BusinessType.OTHER.name
        val busType = try {
            BusinessType.valueOf(busTypeName)
        } catch (_: Exception) {
            BusinessType.fromRawCategory(busTypeName)
        }
        val busName = prefs.getString(KEY_BUSINESS_NAME, busType.displayName) ?: busType.displayName
        val branchId = prefs.getString(KEY_BRANCH_ID, busId) ?: busId
        val branchCode = prefs.getString(KEY_BRANCH_CODE, "") ?: ""
        val branchName = prefs.getString(KEY_BRANCH_NAME, busName) ?: busName
        val roleCode = prefs.getString(KEY_ROLE, "staff") ?: "staff"
        val displayRole = prefs.getString(KEY_DISPLAY_ROLE, "") ?: ""
        val role = UserRole.fromBackend(roleCode, displayRole)
        val token = prefs.getString(KEY_AUTH_TOKEN, "") ?: ""
        if (token.isBlank()) return null

        val permType = object : TypeToken<List<String>>() {}.type
        val permissions: List<String> = try {
            gson.fromJson(prefs.getString(KEY_PERMISSIONS, "[]"), permType) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }

        val outletType = object : TypeToken<List<AvailableBusinessOption>>() {}.type
        val assignedOutlets: List<AvailableBusinessOption> = try {
            gson.fromJson(prefs.getString(KEY_ASSIGNED_OUTLETS, "[]"), outletType) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }

        val lastValidatedAt = prefs.getLong(KEY_LAST_LOGIN_TIME, 0L)

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
            deviceId = deviceId,
            displayRole = displayRole.ifBlank { role.visibleRole },
            assignedOutlets = assignedOutlets,
            lastValidatedAt = lastValidatedAt
        )
    }

    fun isLoggedIn(): Boolean = prefs.getBoolean(KEY_IS_LOGGED_IN, false)

    fun touchSessionValidatedAt(timestampMs: Long = System.currentTimeMillis()) {
        if (isLoggedIn()) {
            prefs.edit().putLong(KEY_LAST_LOGIN_TIME, timestampMs).apply()
        }
    }

    /**
     * Prevents indefinite offline POS access on stale or deactivated credentials.
     * Devices must revalidate against Central SMAV Auth within OFFLINE_AUTH_GRACE_MS.
     */
    fun isOfflineAuthorizationExpired(nowMs: Long = System.currentTimeMillis()): Boolean {
        val lastValidated = prefs.getLong(KEY_LAST_LOGIN_TIME, 0L)
        if (lastValidated <= 0L) return true
        return (nowMs - lastValidated) > OFFLINE_AUTH_GRACE_MS
    }

    /**
     * Clears authentication tokens and role/outlet/branch session state on explicit Sign Out or confirmed revocation.
     * Intentionally preserves deviceId, printer pairings, and ALL unsynchronized Room bills/orders.
     */
    fun clearSession() {
        val editor = prefs.edit()
            .remove(KEY_AUTH_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_BUSINESS_ID)
            .remove(KEY_BUSINESS_TYPE)
            .remove(KEY_BUSINESS_NAME)
            .remove(KEY_BRANCH_ID)
            .remove(KEY_BRANCH_CODE)
            .remove(KEY_BRANCH_NAME)
            .remove(KEY_ROLE)
            .remove(KEY_DISPLAY_ROLE)
            .remove(KEY_PERMISSIONS)
            .remove(KEY_ASSIGNED_OUTLETS)
            .remove(KEY_ACTIVE_ROUTE)
            .putBoolean(KEY_IS_LOGGED_IN, false)

        for (key in prefs.all.keys) {
            if (key.startsWith("selected_branch_id_") || key.startsWith("permitted_branches_")) {
                editor.remove(key)
            }
        }
        editor.apply()
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

    fun clearPrinterMac(purpose: PrinterPurpose) {
        prefs.edit().remove("printer_mac_${purpose.code}").apply()
    }

    fun getPrinterMac(purpose: PrinterPurpose): String? {
        return prefs.getString("printer_mac_${purpose.code}", null)
    }

    // Per-outlet receipt header/footer overrides
    fun saveReceiptConfig(outletId: String, header: String, footer: String) {
        prefs.edit()
            .putString("receipt_header_$outletId", header)
            .putString("receipt_footer_$outletId", footer)
            .apply()
    }

    fun getReceiptHeader(outletId: String, fallback: String): String =
        prefs.getString("receipt_header_$outletId", null)?.takeIf { it.isNotBlank() } ?: fallback

    fun getReceiptFooter(outletId: String, fallback: String): String =
        prefs.getString("receipt_footer_$outletId", null)?.takeIf { it.isNotBlank() } ?: fallback

    fun savePermittedBranches(outletId: String, branches: List<BranchOption>) {
        if (outletId.isBlank()) return
        prefs.edit().putString("permitted_branches_$outletId", gson.toJson(branches)).apply()
    }

    fun getPermittedBranches(outletId: String): List<BranchOption> {
        if (outletId.isBlank()) return emptyList()
        val raw = prefs.getString("permitted_branches_$outletId", null) ?: return emptyList()
        val type = object : TypeToken<List<BranchOption>>() {}.type
        return try {
            gson.fromJson(raw, type) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveSelectedBranchId(outletId: String, branchId: String?) {
        if (outletId.isBlank()) return
        val editor = prefs.edit()
        if (branchId.isNullOrBlank()) {
            editor.remove("selected_branch_id_$outletId")
        } else {
            editor.putString("selected_branch_id_$outletId", branchId.trim())
        }
        editor.apply()
    }

    fun getSelectedBranchId(outletId: String): String? {
        if (outletId.isBlank()) return null
        return prefs.getString("selected_branch_id_$outletId", null)?.takeIf { it.isNotBlank() }
    }

    fun saveActiveRoute(routeName: String) {
        if (routeName.isBlank()) return
        prefs.edit().putString(KEY_ACTIVE_ROUTE, routeName).apply()
    }

    fun getActiveRoute(): String? {
        return prefs.getString(KEY_ACTIVE_ROUTE, null)?.takeIf { it.isNotBlank() }
    }

    fun getServerUrl(): String {
        val defaultUrl = BuildConfig.DEFAULT_SERVER_URL.trim().trimEnd('/')
        val saved = prefs.getString(KEY_SERVER_URL, null)?.trim()?.trimEnd('/')
        return if (!saved.isNullOrBlank() &&
            saved.startsWith("https://") &&
            !saved.contains("ais-dev-", ignoreCase = true) &&
            !saved.contains("api.smav.internal", ignoreCase = true)
        ) {
            saved
        } else {
            defaultUrl
        }
    }

    fun setServerUrl(url: String) {
        val clean = url.trim().trimEnd('/')
        if (clean.startsWith("https://") &&
            !clean.contains("ais-dev-", ignoreCase = true) &&
            !clean.contains("api.smav.internal", ignoreCase = true)
        ) {
            prefs.edit().putString(KEY_SERVER_URL, clean).apply()
        }
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
        private const val KEY_DISPLAY_ROLE = "display_role"
        private const val KEY_PERMISSIONS = "permissions"
        private const val KEY_ASSIGNED_OUTLETS = "assigned_outlets"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_IS_LOGGED_IN = "is_logged_in"
        private const val KEY_LAST_LOGIN_TIME = "last_login_time"
        private const val KEY_PAPER_WIDTH = "paper_width"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_ACTIVE_ROUTE = "active_route"
        const val OFFLINE_AUTH_GRACE_MS: Long = 24L * 60L * 60L * 1000L
    }
}
