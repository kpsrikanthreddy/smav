package com.smav.printagent.data.repository

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smav.printagent.model.*
import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import com.smav.printagent.network.asJsonObjectOrNull
import com.smav.printagent.network.optBool
import com.smav.printagent.network.optDouble
import com.smav.printagent.network.optInt
import com.smav.printagent.network.optString
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AdminNetworkRepository(
    private val sessionManager: SessionManager
) {
    private val api get() = SmavApiClient.create(sessionManager)

    private fun currentBearer(): String {
        val token = sessionManager.getStaffSession()?.token
            ?: throw UnauthorizedSessionException()
        return SmavApiClient.bearer(token)
    }

    /**
     * Parses central backend session + token payload into StaffSession without
     * forcibly overriding SUPERADMIN to a single outlet.
     */
    fun parseSessionPayload(
        json: JsonObject,
        fallbackEmail: String = "",
        fallbackToken: String = ""
    ): StaffSession {
        val raw = json.get("session").asJsonObjectOrNull() ?: json
        val token = json.optString("token").ifBlank { raw.optString("token") }.ifBlank { fallbackToken }
        require(token.isNotBlank()) { "Missing authentication token from server." }

        val activeOutlet = raw.get("activeOutlet").asJsonObjectOrNull()
        val roleRaw = raw.optString("role")
        val displayRoleRaw = raw.optString("displayRole")
        val role = UserRole.fromBackend(roleRaw, displayRoleRaw)

        val assignedList = parseAssignedOutlets(raw.getAsJsonArray("assignedOutlets"))

        val outletId = activeOutlet?.optString("id")
            ?.ifBlank { raw.optString("outlet_id", "business_id") }
            ?.ifBlank { "central_smav" }
            ?: raw.optString("outlet_id", "business_id").ifBlank { "central_smav" }

        val outletCode = activeOutlet?.optString("code")
            ?.ifBlank { raw.optString("outlet_code", "outletCode") }
            ?: raw.optString("outlet_code", "outletCode")

        val outletName = activeOutlet?.optString("name")
            ?.ifBlank { raw.optString("outlet_name", "business_name") }
            ?.ifBlank { "SMAV Enterprise Central Headquarters" }
            ?: raw.optString("outlet_name", "business_name").ifBlank { "SMAV Enterprise Central Headquarters" }

        val rawCat = activeOutlet?.optString("category")
            ?.ifBlank { raw.optString("business_type") }
            ?: raw.optString("business_type")
        val businessType = BusinessType.fromRawCategory(rawCat)

        val permissions = raw.getAsJsonArray("permissions")?.mapNotNull { el ->
            el.takeIf { !it.isJsonNull && it.isJsonPrimitive }?.asString
        } ?: emptyList()

        return StaffSession(
            token = token,
            userId = raw.optString("userId", "user_id"),
            userName = raw.optString("fullName", "userName").ifBlank { fallbackEmail.ifBlank { "SMAV User" } },
            email = raw.optString("email").ifBlank { fallbackEmail },
            businessId = outletId,
            businessType = businessType,
            businessName = outletName,
            // Never conflate outlet_id with physical branch_id at login; physical branches load dynamically via /api/pos/branches
            branchId = "",
            branchCode = outletCode,
            branchName = "",
            role = role,
            permissions = permissions,
            deviceId = sessionManager.deviceId,
            isOnline = true,
            displayRole = displayRoleRaw.ifBlank { role.visibleRole },
            assignedOutlets = assignedList,
            lastValidatedAt = System.currentTimeMillis()
        )
    }

    fun parseAssignedOutlets(array: JsonArray?): List<AvailableBusinessOption> {
        if (array == null) return emptyList()
        return array.mapNotNull { el ->
            val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
            val id = obj.optString("outletId", "outlet_id", "business_id", "id")
            val name = obj.optString("outletName", "outlet_name", "business_name", "name")
            if (id.isBlank()) return@mapNotNull null
            AvailableBusinessOption(
                businessId = id,
                businessName = name.ifBlank { "Outlet" },
                businessType = obj.optString("outletCategory", "outlet_category", "business_type", "category"),
                // Outlet selector carries outlet identity only; never default branchId to outletId
                branchId = "",
                branchCode = obj.optString("outletCode", "outlet_code", "code"),
                branchName = "",
                role = obj.optString("role").ifBlank { "staff" },
                displayRole = obj.optString("displayRole")
            )
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Session & Outlet Switching
    // ---------------------------------------------------------------------------------------------

    suspend fun validateCurrentSession(): Result<StaffSession> = withContext(Dispatchers.IO) {
        runCatching {
            val existing = sessionManager.getStaffSession()
                ?: throw UnauthorizedSessionException(
                    message = "No active session found.",
                    errorCode = "SESSION_MISSING",
                    confirmedInvalid = true
                )
            var sessionResp = api.getAuthSession(SmavApiClient.bearer(existing.token))

            if (sessionResp.code() == 401) {
                val (code, msg) = SmavApiClient.parseErrorPayload(
                    sessionResp,
                    "Your account is inactive or your session has expired. Please sign in again."
                )
                // Attempt explicit server-side refresh before declaring session expired
                if (code == "SESSION_EXPIRED") {
                    val refreshResp = runCatching {
                        api.refreshAuthSession(SmavApiClient.bearer(existing.token))
                    }.getOrNull()
                    if (refreshResp != null && refreshResp.isSuccessful) {
                        sessionResp = refreshResp
                    } else if (refreshResp != null && refreshResp.code() == 401) {
                        val (rCode, rMsg) = SmavApiClient.parseErrorPayload(refreshResp, msg)
                        throw UnauthorizedSessionException(
                            message = rMsg,
                            errorCode = rCode ?: code,
                            confirmedInvalid = SmavApiClient.isConfirmedSessionInvalidation(401, rCode ?: code)
                        )
                    } else {
                        // Refresh failed due to temporary network/5xx error: retain active session
                        throw java.io.IOException("SMAV server is temporarily unreachable. Session retained.")
                    }
                } else if (SmavApiClient.isConfirmedSessionInvalidation(401, code)) {
                    throw UnauthorizedSessionException(
                        message = msg,
                        errorCode = code,
                        confirmedInvalid = true
                    )
                } else {
                    throw java.io.IOException(msg)
                }
            }

            val sessionJson = SmavApiClient.unwrapOrThrow(sessionResp) { it }
            var updated = parseSessionPayload(sessionJson, existing.email, existing.token)

            // Persist permitted branches if returned with session payload (non-blocking if absent)
            val branchesArr = sessionJson.getAsJsonArray("permittedBranches")
            if (branchesArr != null && updated.businessId.isNotBlank()) {
                val parsedBranches = branchesArr.mapNotNull { el ->
                    val b = el.asJsonObjectOrNull() ?: return@mapNotNull null
                    val id = b.optString("id")
                    val code = b.optString("branchCode", "branch_code")
                    val name = b.optString("name", "branchName", "branch_name")
                    if (id.isBlank() || code.isBlank() || name.isBlank()) return@mapNotNull null
                    BranchOption(
                        id = id,
                        outletId = b.optString("outletId", "outlet_id").ifBlank { updated.businessId },
                        outletCode = b.optString("outletCode", "outlet_code"),
                        branchCode = code,
                        branchName = name,
                        billPrefix = b.optString("billPrefix", "bill_prefix"),
                        isActive = b.optBool("isActive", true),
                        address = b.optString("address"),
                        gstin = b.optString("gstin"),
                        whatsappPhone = b.optString("whatsappPhone", "whatsapp_phone")
                    )
                }.filter { it.isActive }
                if (parsedBranches.isNotEmpty()) {
                    sessionManager.savePermittedBranches(updated.businessId, parsedBranches)
                    val prevSelected = sessionManager.getSelectedBranchId(updated.businessId)
                    if (!prevSelected.isNullOrBlank() && parsedBranches.none { it.id == prevSelected }) {
                        sessionManager.saveSelectedBranchId(updated.businessId, null)
                    }
                }
            }

            // Refresh authorized outlets list best-effort; transient failures never invalidate session
            val outletsResp = runCatching { api.getAuthorizedOutlets(SmavApiClient.bearer(updated.token)) }.getOrNull()
            if (outletsResp != null && outletsResp.isSuccessful) {
                val oJson = outletsResp.body()
                val outlets = parseAssignedOutlets(oJson?.getAsJsonArray("outlets"))
                if (outlets.isNotEmpty()) {
                    updated = updated.copy(assignedOutlets = outlets)
                }
            } else if (updated.assignedOutlets.isEmpty() && existing.assignedOutlets.isNotEmpty()) {
                updated = updated.copy(assignedOutlets = existing.assignedOutlets)
            }

            sessionManager.saveStaffSession(updated)
            updated
        }
    }

    suspend fun refreshAuthorizedOutlets(): Result<List<AvailableBusinessOption>> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getAuthorizedOutlets(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val outlets = parseAssignedOutlets(body.getAsJsonArray("outlets"))
            sessionManager.getStaffSession()?.let { current ->
                sessionManager.saveStaffSession(current.copy(assignedOutlets = outlets))
            }
            outlets
        }
    }

    suspend fun switchOutlet(outletId: String): Result<StaffSession> = withContext(Dispatchers.IO) {
        runCatching {
            val existing = sessionManager.getStaffSession() ?: throw UnauthorizedSessionException()
            val req = JsonObject().apply { addProperty("outletId", outletId) }
            val resp = api.switchOutlet(SmavApiClient.bearer(existing.token), req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val updated = parseSessionPayload(body, existing.email, existing.token)
                .copy(assignedOutlets = existing.assignedOutlets)
            sessionManager.saveStaffSession(updated)
            updated
        }
    }

    suspend fun signOutRemote() = withContext(Dispatchers.IO) {
        runCatching {
            val existing = sessionManager.getStaffSession() ?: return@runCatching
            api.logout(SmavApiClient.bearer(existing.token))
        }
        sessionManager.clearSession()
    }

    // ---------------------------------------------------------------------------------------------
    // SUPERADMIN APIs
    // ---------------------------------------------------------------------------------------------

    suspend fun getSuperadminOutlets(): Result<List<AdminOutletItem>> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getSuperadminOutlets(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val arr = body.getAsJsonArray("outlets") ?: return@runCatching emptyList()
            arr.mapNotNull { parseAdminOutletItem(it.asJsonObjectOrNull()) }
        }
    }

    suspend fun createSuperadminOutlet(
        name: String,
        code: String,
        category: String,
        address: String,
        phone: String,
        gstin: String,
        receiptHeader: String,
        receiptFooter: String
    ): Result<AdminOutletItem> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                addProperty("name", name.trim())
                addProperty("code", code.trim().lowercase())
                addProperty("category", category.trim().lowercase())
                addProperty("address", address.trim())
                addProperty("phone", phone.trim())
                addProperty("gstin", gstin.trim())
                addProperty("receiptHeader", receiptHeader.trim())
                addProperty("receiptFooter", receiptFooter.trim())
            }
            val resp = api.createSuperadminOutlet(currentBearer(), req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            parseAdminOutletItem(body.get("outlet").asJsonObjectOrNull())
                ?: AdminOutletItem("", code, name, category, address, phone, gstin, receiptHeader, receiptFooter, "", "", "", true)
        }
    }

    suspend fun updateSuperadminOutlet(
        outletId: String,
        name: String,
        code: String,
        category: String,
        address: String,
        phone: String,
        gstin: String,
        receiptHeader: String,
        receiptFooter: String
    ): Result<AdminOutletItem> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                addProperty("name", name.trim())
                addProperty("code", code.trim().lowercase())
                addProperty("category", category.trim().lowercase())
                addProperty("address", address.trim())
                addProperty("phone", phone.trim())
                addProperty("gstin", gstin.trim())
                addProperty("receiptHeader", receiptHeader.trim())
                addProperty("receiptFooter", receiptFooter.trim())
            }
            val resp = api.updateSuperadminOutlet(currentBearer(), outletId, req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            parseAdminOutletItem(body.get("outlet").asJsonObjectOrNull())
                ?: AdminOutletItem(outletId, code, name, category, address, phone, gstin, receiptHeader, receiptFooter, "", "", "", true)
        }
    }

    suspend fun setSuperadminOutletStatus(outletId: String, isActive: Boolean): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply { addProperty("isActive", isActive) }
            val resp = api.setSuperadminOutletStatus(currentBearer(), outletId, req)
            SmavApiClient.unwrapOrThrow(resp) { Unit }
        }
    }

    suspend fun launchSuperadminPos(outletId: String): Result<StaffSession> = withContext(Dispatchers.IO) {
        runCatching {
            val existing = sessionManager.getStaffSession() ?: throw UnauthorizedSessionException()
            val req = JsonObject().apply { addProperty("outletId", outletId) }
            val resp = api.launchSuperadminPos(currentBearer(), req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val launched = parseSessionPayload(body, existing.email, existing.token)
                .copy(assignedOutlets = existing.assignedOutlets)
            sessionManager.saveStaffSession(launched)
            launched
        }
    }

    suspend fun getSuperadminAdmins(): Result<List<OutletAdminItem>> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getSuperadminAdmins(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val arr = body.getAsJsonArray("admins") ?: return@runCatching emptyList()
            arr.mapNotNull { parseOutletUser(it.asJsonObjectOrNull()) }
        }
    }

    suspend fun createSuperadminAdmin(
        fullName: String,
        email: String,
        username: String,
        phone: String,
        outletCode: String,
        initialPassword: String
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                addProperty("fullName", fullName.trim())
                addProperty("email", email.trim())
                addProperty("username", username.trim())
                addProperty("phone", phone.trim())
                addProperty("outletCode", outletCode.trim().lowercase())
                addProperty("initialPassword", initialPassword)
            }
            val resp = api.createSuperadminAdmin(currentBearer(), req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optString("message").ifBlank { "Outlet administrator created successfully." }
        }
    }

    suspend fun resetSuperadminAdminPassword(
        adminId: String,
        email: String,
        outletCode: String,
        newPassword: String
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (email.isNotBlank()) addProperty("email", email.trim())
                if (outletCode.isNotBlank()) addProperty("outletCode", outletCode.trim().lowercase())
                addProperty("newPassword", newPassword)
            }
            val resp = api.resetSuperadminAdminPassword(currentBearer(), adminId, req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optString("message").ifBlank { "Temporary password updated." }
        }
    }

    suspend fun getSuperadminReports(): Result<NetworkReportData> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getSuperadminReports(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val summary = body.get("summary").asJsonObjectOrNull()
            val breakdown = body.getAsJsonArray("outletsBreakdown")?.mapNotNull { el ->
                val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
                OutletBreakdownItem(
                    id = obj.optString("id"),
                    name = obj.optString("name"),
                    code = obj.optString("code"),
                    category = obj.optString("category"),
                    isActive = obj.optBool("isActive", true),
                    revenue = obj.optDouble("revenue", default = 0.0),
                    transactionCount = obj.optInt("transactionCount", default = 0),
                    supabaseConnected = obj.optBool("supabaseConnected", false)
                )
            } ?: emptyList()

            NetworkReportData(
                totalOutlets = summary?.optInt("totalOutlets") ?: breakdown.size,
                activeOutlets = summary?.optInt("activeOutlets") ?: breakdown.count { it.isActive },
                totalRevenue = summary?.optDouble("totalRevenue") ?: 0.0,
                totalTransactions = summary?.optInt("totalTransactions") ?: 0,
                pairedDevicesCount = summary?.optInt("pairedDevicesCount") ?: 0,
                breakdown = breakdown
            )
        }
    }

    suspend fun getSuperadminAuditLogs(): Result<List<AuditLogItem>> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getSuperadminAuditLogs(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val arr = body.getAsJsonArray("logs") ?: return@runCatching emptyList()
            arr.mapNotNull { el ->
                val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
                AuditLogItem(
                    id = obj.optString("id").ifBlank { obj.optString("timestamp") },
                    timestamp = obj.optString("timestamp", "created_at"),
                    eventType = obj.optString("eventType", "action"),
                    actorEmail = obj.optString("actorEmail", "actorId", "userEmail").ifBlank { "System" },
                    ipAddress = obj.optString("ipAddress", "ip"),
                    detailsJson = obj.get("details")?.takeIf { !it.isJsonNull }?.toString() ?: ""
                )
            }
        }
    }

    suspend fun getCentralSupabaseStatus(): Result<CentralSupabaseStatusData> = withContext(Dispatchers.IO) {
        runCatching {
            val statusResp = api.getCentralSupabaseStatus()
            val statusBody = SmavApiClient.unwrapOrThrow(statusResp) { it }
            val conn = statusBody.get("connectionTest").asJsonObjectOrNull()
            val tablesObj = conn?.get("tables").asJsonObjectOrNull()
            val tables = mutableMapOf<String, Boolean>()
            tablesObj?.entrySet()?.forEach { (k, v) ->
                tables[k] = v.takeIf { !it.isJsonNull && it.isJsonPrimitive }?.asBoolean ?: false
            }

            val profileResp = runCatching { api.getAuthProfile(currentBearer()) }.getOrNull()
            val profileBody = if (profileResp != null && profileResp.isSuccessful) profileResp.body() else null
            val profileObj = profileBody?.get("profile").asJsonObjectOrNull()

            CentralSupabaseStatusData(
                isConfigured = statusBody.optBool("isConfigured", false),
                projectUrl = statusBody.optString("projectUrl"),
                publishableKeyPreview = statusBody.optString("publishableKeyPreview"),
                connected = conn?.optBool("connected", false) ?: false,
                tableStatus = tables,
                profileUserId = profileObj?.optString("id").orEmpty(),
                profileEmail = profileObj?.optString("email").orEmpty(),
                profileFullName = profileObj?.optString("full_name").orEmpty(),
                profilePlatformRole = profileObj?.optString("platform_role").orEmpty(),
                profileSource = profileBody?.optString("source").orEmpty()
            )
        }
    }

    // Diagnostics (Read-Only)
    suspend fun runSourceCatalogCheck(outletId: String): Result<CatalogDiagnosticItem> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getOutletSourceCatalog(currentBearer(), outletId, limit = 50, offset = 0)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val total = body.optInt("total", default = 0)
            val fresh = body.optBool("fresh", false)
            CatalogDiagnosticItem(
                checkType = "Live Source Catalog",
                outletCode = body.optString("outletCode"),
                source = body.optString("source"),
                fresh = fresh,
                total = total,
                summary = "$total active items loaded from ${body.optString("source")}",
                warning = if (!fresh) "Source is cached/derived, not a fresh live upstream read." else null
            )
        }
    }

    suspend fun runCatalogPreviewCheck(outletId: String): Result<CatalogDiagnosticItem> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getOutletCatalogPreview(currentBearer(), outletId, limit = 50, offset = 0)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val catalog = body.get("catalog").asJsonObjectOrNull()
            val total = catalog?.optInt("total", default = catalog.getAsJsonArray("items")?.size() ?: 0) ?: 0
            val rev = catalog?.optInt("currentRevision", default = 0) ?: 0
            CatalogDiagnosticItem(
                checkType = "Central Catalog Preview",
                total = total,
                fresh = true,
                summary = "$total central cached items (revision #$rev)"
            )
        }
    }

    suspend fun runCatalogChangesCheck(outletId: String): Result<CatalogDiagnosticItem> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getOutletCatalogChanges(currentBearer(), outletId, sinceRevision = 0, limit = 50, offset = 0)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val catalog = body.get("catalog").asJsonObjectOrNull()
            val changesCount = catalog?.getAsJsonArray("items")?.size() ?: catalog?.optInt("total", default = 0) ?: 0
            val rev = catalog?.optInt("currentRevision", default = 0) ?: 0
            CatalogDiagnosticItem(
                checkType = "Incremental Delta Changes",
                total = changesCount,
                fresh = true,
                summary = "$changesCount change record(s) up to revision #$rev"
            )
        }
    }

    suspend fun runCatalogImportPreflight(outletId: String): Result<CatalogDiagnosticItem> = withContext(Dispatchers.IO) {
        runCatching {
            // Refresh live source catalog first as requested
            val sourceWarning = runCatching {
                val srcResp = api.getOutletSourceCatalog(currentBearer(), outletId, limit = 200, offset = 0)
                val srcBody = SmavApiClient.unwrapOrThrow(srcResp) { it }
                if (srcBody.optInt("total", default = 0) == 0) "Source cache is empty; no import performed." else null
            }.getOrNull()

            val resp = api.getCatalogImportPreflight(currentBearer(), outletId)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val comp = body.get("comparison").asJsonObjectOrNull()
            val sourceCount = comp?.optInt("sourceCount", default = 0) ?: 0
            val newItems = comp?.optInt("newItems", default = 0) ?: 0
            val changedItems = comp?.optInt("changedItems", default = 0) ?: 0
            val unchangedItems = comp?.optInt("unchangedItems", default = 0) ?: 0
            CatalogDiagnosticItem(
                checkType = "Catalog Import Preflight (Read-Only)",
                outletCode = body.optString("outletCode"),
                source = body.optString("source"),
                fresh = body.optBool("freshSource", false),
                total = sourceCount,
                newItems = newItems,
                changedItems = changedItems,
                unchangedItems = unchangedItems,
                summary = "Source: $sourceCount | New: $newItems | Changed: $changedItems | Unchanged: $unchangedItems",
                warning = sourceWarning ?: if (sourceCount == 0) "Source catalog is empty." else null
            )
        }
    }

    // ---------------------------------------------------------------------------------------------
    // OUTLET ADMIN APIs
    // ---------------------------------------------------------------------------------------------

    suspend fun getAdminOutletDetails(): Result<AdminOutletItem> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getAdminOutletDetails(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            parseAdminOutletItem(body.get("outlet").asJsonObjectOrNull())
                ?: throw IllegalStateException("Outlet details unavailable")
        }
    }

    suspend fun getOutletUsers(outletCode: String? = null): Result<List<OutletAdminItem>> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getOutletUsers(currentBearer(), outletCode)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val arr = body.getAsJsonArray("users") ?: return@runCatching emptyList()
            arr.mapNotNull { parseOutletUser(it.asJsonObjectOrNull()) }
        }
    }

    suspend fun createOrUpdateOutletUser(
        existingUserId: String? = null,
        fullName: String,
        username: String,
        email: String,
        phone: String,
        role: String,
        outletCode: String,
        initialPassword: String?
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                addProperty("fullName", fullName.trim())
                addProperty("username", username.trim().lowercase())
                addProperty("email", email.trim().lowercase())
                addProperty("phone", phone.trim())
                addProperty("role", role.trim().uppercase())
                addProperty("outletCode", outletCode.trim().lowercase())
                if (!initialPassword.isNullOrBlank()) {
                    addProperty("initialPassword", initialPassword)
                }
            }
            val resp = if (existingUserId.isNullOrBlank()) {
                api.createOutletUser(currentBearer(), req)
            } else {
                api.updateOutletUser(currentBearer(), existingUserId, req)
            }
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optString("message").ifBlank { "Staff account updated." }
        }
    }

    suspend fun resetOutletUserPassword(
        userId: String,
        email: String,
        outletCode: String,
        newPassword: String
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (email.isNotBlank()) addProperty("email", email.trim().lowercase())
                addProperty("outletCode", outletCode.trim().lowercase())
                addProperty("newPassword", newPassword)
            }
            val resp = api.resetOutletUserPassword(currentBearer(), userId, req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optString("message").ifBlank { "Temporary password updated." }
        }
    }

    suspend fun setOutletUserStatus(
        userId: String,
        email: String,
        outletCode: String,
        isActive: Boolean
    ): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (email.isNotBlank()) addProperty("email", email.trim().lowercase())
                addProperty("outletCode", outletCode.trim().lowercase())
                addProperty("isActive", isActive)
            }
            val resp = api.setOutletUserStatus(currentBearer(), userId, req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optString("message").ifBlank { "Staff status updated." }
        }
    }

    suspend fun getSyncOutbox(outletCode: String? = null): Result<List<SyncOutboxItemDto>> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getSyncOutbox(currentBearer(), outletCode)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val arr = body.getAsJsonArray("items") ?: return@runCatching emptyList()
            arr.mapNotNull { el ->
                val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
                SyncOutboxItemDto(
                    id = obj.optString("id").ifBlank { java.util.UUID.randomUUID().toString() },
                    targetUserId = obj.optString("targetUserId"),
                    targetLabel = obj.optString("outletCode").ifBlank { obj.optString("action") },
                    status = obj.optString("status").ifBlank { "PENDING" },
                    lastError = obj.optString("lastError").takeIf { it.isNotBlank() }
                )
            }
        }
    }

    suspend fun retrySyncOutbox(id: String): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.retrySyncOutboxItem(currentBearer(), id)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optString("message").ifBlank { "Sync retry triggered." }
        }
    }

    suspend fun getAdminReports(): Result<OutletReportSummary> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getAdminReports(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val rows = mutableListOf<RemoteTransactionRow>()
            val recentBills = body.getAsJsonArray("recentBills")
            recentBills?.forEach { el ->
                val o = el.asJsonObjectOrNull() ?: return@forEach
                rows.add(
                    RemoteTransactionRow(
                        id = o.optString("id", "bill_number").ifBlank { java.util.UUID.randomUUID().toString() },
                        referenceNumber = o.optString("bill_number", "billNumber").ifBlank { "Salon Bill" },
                        subtitle = o.optString("customer_name", "customerName").ifBlank { "Walk-in Guest" },
                        paymentMode = o.optString("payment_mode", "paymentMode").ifBlank { "cash" },
                        grandTotal = o.optDouble("grand_total", "grandTotal"),
                        createdAt = o.optString("created_at", "createdAt"),
                        status = "Synced"
                    )
                )
            }
            val recentOrders = body.getAsJsonArray("recentOrders")
            recentOrders?.forEach { el ->
                val o = el.asJsonObjectOrNull() ?: return@forEach
                rows.add(
                    RemoteTransactionRow(
                        id = o.optString("id", "order_number").ifBlank { java.util.UUID.randomUUID().toString() },
                        referenceNumber = o.optString("order_number", "orderNumber").ifBlank { "Order" },
                        subtitle = o.optString("table_or_counter", "tableOrCounter").ifBlank { "Counter" },
                        paymentMode = o.optString("payment_mode", "paymentMode").ifBlank { "cash" },
                        grandTotal = o.optDouble("grand_total", "grandTotal"),
                        createdAt = o.optString("created_at_server", "created_at"),
                        status = "Synced"
                    )
                )
            }

            OutletReportSummary(
                outletName = body.optString("outletName"),
                totalSales = body.optDouble("totalSales"),
                totalTax = body.optDouble("totalTax"),
                totalTransactions = body.optInt("totalTransactions"),
                transactions = rows
            )
        }
    }

    suspend fun getAdminSyncSummary(): Result<String> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.getAdminSyncStatus(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val last = body.optString("last_supabase_sync").ifBlank { "Active" }
            val salonRev = body.get("salon").asJsonObjectOrNull()?.optInt("current_revision") ?: 0
            val restRev = body.get("restaurant").asJsonObjectOrNull()?.optInt("current_revision") ?: 0
            "Last sync: $last • Salon Rev #$salonRev • Restaurant Rev #$restRev"
        }
    }

    suspend fun saveSalonServiceItem(
        id: String? = null,
        name: String,
        category: String,
        subcategory: String,
        price: Double,
        isActive: Boolean = true
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (!id.isNullOrBlank()) addProperty("id", id)
                addProperty("name", name.trim())
                addProperty("category", category.trim().ifBlank { "General" })
                addProperty("subcategory", subcategory.trim())
                addProperty("price", price)
                addProperty("isActive", isActive)
            }
            val resp = api.saveSalonService(currentBearer(), req)
            SmavApiClient.unwrapOrThrow(resp) { Unit }
        }
    }

    suspend fun saveRestaurantMenuItemRemote(
        id: String? = null,
        name: String,
        category: String,
        basePrice: Double,
        isVeg: Boolean,
        isAvailable: Boolean = true
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (!id.isNullOrBlank()) addProperty("id", id)
                addProperty("name", name.trim())
                addProperty("category", category.trim().ifBlank { "Starters" })
                addProperty("basePrice", basePrice)
                addProperty("isVeg", isVeg)
                addProperty("isAvailable", isAvailable)
            }
            val resp = api.saveRestaurantMenuItem(currentBearer(), req)
            SmavApiClient.unwrapOrThrow(resp) { Unit }
        }
    }

    suspend fun saveRetailProductRemote(
        id: String? = null,
        name: String,
        category: String,
        price: Double,
        stockQuantity: Int = 0
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (!id.isNullOrBlank()) addProperty("id", id)
                addProperty("name", name.trim())
                addProperty("category", category.trim().ifBlank { "General" })
                addProperty("price", price)
                addProperty("stockQuantity", stockQuantity)
                addProperty("isActive", true)
            }
            val resp = api.saveRetailProduct(currentBearer(), req)
            SmavApiClient.unwrapOrThrow(resp) { Unit }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // CENTRAL BILLING & WHATSAPP INTEGRATION DIAGNOSTICS
    // ---------------------------------------------------------------------------------------------

    suspend fun runIntegrationDiagnostics(
        outletId: String? = null,
        probeEndpoints: Boolean = false
    ): Result<IntegrationDiagnosticReport> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                if (!outletId.isNullOrBlank()) addProperty("outletId", outletId)
                addProperty("probeEndpoints", probeEndpoints)
            }
            val resp = api.runIntegrationDiagnostics(currentBearer(), req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val backend = body.get("backend").asJsonObjectOrNull()
            val dispatcher = backend?.get("internalDispatcher").asJsonObjectOrNull()
            val supa = body.get("supabase").asJsonObjectOrNull()
            val sales = body.get("salesSummary").asJsonObjectOrNull()
            val queue = body.get("queueSummary").asJsonObjectOrNull()

            val routes = body.getAsJsonArray("routes")?.mapNotNull { el ->
                val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
                val reach = obj.get("reachability").asJsonObjectOrNull()
                IntegrationRouteDto(
                    outletId = obj.optString("outlet_id"),
                    outletCode = obj.optString("outlet_code"),
                    outletName = obj.optString("outlet_name"),
                    category = obj.optString("category"),
                    configured = obj.optBool("configured", false),
                    endpointUrl = obj.optString("endpoint_url"),
                    enabled = obj.optBool("enabled", false),
                    sendReceipts = obj.optBool("send_receipts", false),
                    sendFeedback = obj.optBool("send_feedback", false),
                    receiptTemplateName = obj.optString("receipt_template_name"),
                    feedbackTemplateName = obj.optString("feedback_template_name"),
                    lastHttpStatus = if (obj.has("last_http_status") && !obj.get("last_http_status").isJsonNull) {
                        obj.optInt("last_http_status")
                    } else null,
                    lastError = obj.optString("last_error").takeIf { it.isNotBlank() },
                    reachabilityReachable = reach?.optBool("reachable", false),
                    reachabilityMessage = reach?.optString("message")?.takeIf { it.isNotBlank() }
                )
            } ?: emptyList()

            val recentJobs = body.getAsJsonArray("recentJobs")?.mapNotNull { el ->
                val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
                IntegrationJobDto(
                    id = obj.optString("id"),
                    outletId = obj.optString("outlet_id"),
                    sourceType = obj.optString("source_type"),
                    eventType = obj.optString("event_type"),
                    status = obj.optString("status"),
                    billNumber = obj.optString("bill_number").ifBlank { obj.optString("id").take(8) },
                    maskedPhone = obj.optString("masked_phone"),
                    attempts = obj.optInt("attempts", default = 0),
                    lastHttpStatus = if (obj.has("last_http_status") && !obj.get("last_http_status").isJsonNull) {
                        obj.optInt("last_http_status")
                    } else null,
                    downstreamStatus = obj.optString("downstream_status"),
                    whatsappStatus = obj.optString("whatsapp_status"),
                    whatsappMessageId = obj.optString("whatsapp_message_id"),
                    lastError = obj.optString("last_error").takeIf { it.isNotBlank() },
                    updatedAt = obj.optString("updated_at")
                )
            } ?: emptyList()

            val recentLogs = body.getAsJsonArray("recentLogs")?.mapNotNull { el ->
                val obj = el.asJsonObjectOrNull() ?: return@mapNotNull null
                IntegrationLogDto(
                    id = obj.optString("id").ifBlank { "${obj.optString("created_at")}-${obj.optString("step")}" },
                    eventId = obj.optString("event_id"),
                    billId = obj.optString("bill_id"),
                    outletId = obj.optString("outlet_id"),
                    billNumber = obj.optString("bill_number"),
                    eventType = obj.optString("event_type"),
                    step = obj.optString("step"),
                    status = obj.optString("status"),
                    httpStatus = if (obj.has("http_status") && !obj.get("http_status").isJsonNull) {
                        obj.optInt("http_status")
                    } else null,
                    whatsappStatus = obj.optString("whatsapp_status"),
                    maskedPhone = obj.optString("masked_phone"),
                    sanitizedError = obj.optString("sanitized_error").takeIf { it.isNotBlank() },
                    createdAt = obj.optString("created_at")
                )
            } ?: emptyList()

            IntegrationDiagnosticReport(
                checkedAt = body.optString("checkedAt"),
                serviceRoleConfigured = backend?.optBool("serviceRoleConfigured", false) ?: false,
                dispatchSecretConfigured = backend?.optBool("dispatchSecretConfigured", false) ?: false,
                cronSecretConfigured = backend?.optBool("cronSecretConfigured", false) ?: false,
                internalDispatcherEnabled = dispatcher?.optBool("enabled", false) ?: false,
                internalDispatcherIntervalSec = dispatcher?.optInt("intervalSec", default = 25) ?: 25,
                internalDispatcherLastRunAt = dispatcher?.optString("lastRunAt").orEmpty(),
                supabaseConnected = supa?.optBool("connected", false) ?: false,
                supabaseError = supa?.optString("error")?.takeIf { it.isNotBlank() },
                salonBillsCount = sales?.optInt("salonBillsCount", default = 0) ?: 0,
                centralSalesCount = sales?.optInt("centralSalesCount", default = 0) ?: 0,
                totalSyncedRecords = sales?.optInt("totalSyncedRecords", default = 0) ?: 0,
                pendingJobs = queue?.optInt("pending", default = 0) ?: 0,
                sentJobs = queue?.optInt("sent", default = 0) ?: 0,
                failedJobs = queue?.optInt("failed", default = 0) ?: 0,
                skippedJobs = queue?.optInt("skipped", default = 0) ?: 0,
                totalJobs = queue?.optInt("total", default = 0) ?: 0,
                routes = routes,
                recentJobs = recentJobs,
                recentLogs = recentLogs
            )
        }
    }

    suspend fun dispatchIntegrationQueueNow(): Result<Int> = withContext(Dispatchers.IO) {
        runCatching {
            val resp = api.dispatchIntegrationNotificationsNow(currentBearer())
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            body.optInt("processed", default = 0)
        }
    }

    suspend fun runConfirmedE2ETest(
        outletId: String?,
        testPhone: String,
        confirmed: Boolean
    ): Result<IntegrationE2EResult> = withContext(Dispatchers.IO) {
        runCatching {
            val req = JsonObject().apply {
                addProperty("confirmed", confirmed)
                addProperty("testPhone", testPhone.trim())
                if (!outletId.isNullOrBlank()) addProperty("outletId", outletId)
            }
            val resp = api.runConfirmedIntegrationE2ETest(currentBearer(), req)
            val body = SmavApiClient.unwrapOrThrow(resp) { it }
            val steps = body.getAsJsonArray("steps")?.mapNotNull { el ->
                val s = el.asJsonObjectOrNull() ?: return@mapNotNull null
                IntegrationE2EStepDto(
                    step = s.optString("step"),
                    status = s.optString("status"),
                    detail = s.optString("detail")
                )
            } ?: emptyList()

            IntegrationE2EResult(
                success = body.optBool("success", false),
                outletName = body.optString("outlet_name"),
                billNumber = body.optString("bill_number"),
                eventId = body.optString("event_id"),
                eventType = body.optString("event_type"),
                httpStatus = if (body.has("http_status") && !body.get("http_status").isJsonNull) {
                    body.optInt("http_status")
                } else null,
                whatsappStatus = body.optString("whatsapp_status"),
                sanitizedError = body.optString("sanitized_error").takeIf { it.isNotBlank() },
                steps = steps
            )
        }
    }

    // ---------------------------------------------------------------------------------------------
    // JSON Mappers
    // ---------------------------------------------------------------------------------------------

    private fun parseAdminOutletItem(obj: JsonObject?): AdminOutletItem? {
        if (obj == null) return null
        val id = obj.optString("id")
        val name = obj.optString("name", "outlet_name")
        if (id.isBlank() && name.isBlank()) return null
        return AdminOutletItem(
            id = id,
            code = obj.optString("code", "outlet_code"),
            name = name,
            category = obj.optString("category", "business_type").ifBlank { "other" },
            address = obj.optString("address"),
            phone = obj.optString("phone"),
            gstin = obj.optString("gstin"),
            receiptHeader = obj.optString("receiptHeader"),
            receiptFooter = obj.optString("receiptFooter"),
            providerType = obj.optString("providerType"),
            supabaseUrl = obj.optString("supabaseUrl"),
            syncWebhookUrl = obj.optString("syncWebhookUrl"),
            isActive = obj.optBool("isActive", true)
        )
    }

    private fun parseOutletUser(obj: JsonObject?): OutletAdminItem? {
        if (obj == null) return null
        val userId = obj.optString("userId", "id")
        if (userId.isBlank()) return null
        val memberships = (obj.getAsJsonArray("memberships") ?: obj.getAsJsonArray("outlets"))?.mapNotNull { el ->
            val m = el.asJsonObjectOrNull() ?: return@mapNotNull null
            AdminMembershipItem(
                outletId = m.optString("outletId", "outlet_id"),
                outletCode = m.optString("outletCode", "outlet_code"),
                outletName = m.optString("outletName", "outlet_name"),
                role = m.optString("role")
            )
        } ?: emptyList()

        return OutletAdminItem(
            userId = userId,
            fullName = obj.optString("fullName", "full_name").ifBlank { obj.optString("email") },
            email = obj.optString("email"),
            username = obj.optString("username"),
            phone = obj.optString("phone"),
            role = obj.optString("role", "outletRole").ifBlank { "staff" },
            displayRole = obj.optString("displayRole").ifBlank { obj.optString("outletRole").uppercase() },
            isActive = obj.optBool("isActive", true),
            mustChangePassword = obj.optBool("mustChangePassword", false),
            syncStatus = obj.optString("syncStatus").ifBlank { "synced" },
            outboxLastError = obj.optString("outboxLastError").takeIf { it.isNotBlank() },
            memberships = memberships
        )
    }
}
