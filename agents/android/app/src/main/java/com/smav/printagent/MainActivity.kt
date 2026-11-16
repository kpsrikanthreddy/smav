package com.smav.printagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.gson.JsonObject
import com.smav.printagent.data.repository.OutletCatalogRepository
import com.smav.printagent.data.repository.SessionManager
import com.smav.printagent.model.*
import com.smav.printagent.ui.theme.SMAVTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import com.google.gson.JsonParser

/** Real central login + outlet-scoped read-only catalog. Billing is intentionally not enabled. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sessions = SessionManager(applicationContext)
        val catalog = OutletCatalogRepository(applicationContext, sessions)
        setContent {
            SMAVTheme {
                var server by remember { mutableStateOf(sessions.getServerUrl()) }
                var username by remember { mutableStateOf("") }
                var password by remember { mutableStateOf("") }
                var message by remember { mutableStateOf("") }
                var busy by remember { mutableStateOf(false) }
                var pendingToken by remember { mutableStateOf("") }
                var outlets by remember { mutableStateOf<List<Pair<String,String>>>(emptyList()) }
                var active by remember { mutableStateOf(sessions.getStaffSession()) }
                var catalogRows by remember { mutableStateOf<List<com.smav.printagent.data.local.OutletCatalogItem>>(emptyList()) }
                val scope = rememberCoroutineScope()
                fun installSession(json: JsonObject) {
                    val raw = json.getAsJsonObject("session") ?: error("Missing server session")
                    val selected = raw.getAsJsonObject("activeOutlet")
                    val outletId = selected?.str("id") ?: raw.str("business_id")
                    require(outletId.isNotBlank() && runCatching { java.util.UUID.fromString(outletId) }.isSuccess) { "No valid authorized outlet selected" }
                    val token = json.str("token").ifBlank { raw.str("token") }
                    require(token.isNotBlank()) { "Missing authentication token" }
                    val type = (selected?.str("category") ?: raw.str("business_type")).lowercase()
                    val roleText = raw.str("role").lowercase()
                    val session = StaffSession(token, raw.str("userId").ifBlank { raw.str("user_id") },
                        raw.str("userName").ifBlank { username }, raw.str("email"), outletId,
                        when(type) { "salon" -> BusinessType.SALON; "restaurant" -> BusinessType.RESTAURANT; "retail" -> BusinessType.RETAIL; else -> BusinessType.OTHER },
                        selected?.str("name") ?: raw.str("business_name"), outletId,
                        selected?.str("code") ?: raw.str("branch_code"),
                        selected?.str("name") ?: raw.str("branch_name"),
                        when(roleText) { "superadmin" -> UserRole.SUPERADMIN; "admin" -> UserRole.ADMIN; "pos_billing" -> UserRole.CASHIER; else -> UserRole.STAFF },
                        emptyList(), sessions.deviceId)
                    sessions.saveStaffSession(session)
                    active = session
                    outlets = emptyList()
                    pendingToken = ""
                    password = ""
                }
                Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("SMAV Print Agent", style = MaterialTheme.typography.headlineSmall)
                    if (active == null) {
                        OutlinedTextField(server, { server = it }, label = { Text("SMAV server HTTPS URL") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(username, { username = it }, label = { Text("Email / User ID") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(password, { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth(), visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
                        Button(onClick = {
                            busy = true; message = ""
                            scope.launch {
                                try {
                                    require(server.startsWith("https://")) { "HTTPS server URL required" }
                                    sessions.setServerUrl(server)
                                    val body = JsonObject().apply {
                                        addProperty("email", username); addProperty("password", password)
                                        addProperty("device_id", sessions.deviceId)
                                    }
                                    val reply = withContext(Dispatchers.IO) { postJson(server, "api/mobile-auth/login", body) }
                                    if (reply.get("multi_business")?.asBoolean == true) {
                                        pendingToken = reply.str("temp_token")
                                        outlets = reply.getAsJsonArray("available_businesses")?.mapNotNull { element ->
                                            val o = element.asJsonObject
                                            val id = o.str("business_id")
                                            if (id.isBlank()) null else id to o.str("business_name")
                                        } ?: emptyList()
                                        require(pendingToken.isNotBlank() && outlets.isNotEmpty()) { "Server did not provide selectable outlets" }
                                        password = ""
                                    } else installSession(reply)
                                } catch(e: Exception) { message = e.message ?: "Login failed" }
                                finally { busy = false }
                            }
                        }, enabled = !busy && username.isNotBlank() && password.isNotBlank()) { Text("Sign in") }
                        outlets.forEach { (id, name) ->
                            Button(enabled = !busy, onClick = {
                                busy = true
                                scope.launch {
                                    try {
                                        val body = JsonObject().apply {
                                            addProperty("temp_token", pendingToken)
                                            addProperty("business_id", id)
                                            addProperty("device_id", sessions.deviceId)
                                        }
                                        installSession(withContext(Dispatchers.IO) { postJson(server, "api/mobile-auth/select-business", body) })
                                    } catch(e: Exception) { message = e.message ?: "Outlet selection failed" }
                                    finally { busy = false }
                                }
                            }) { Text("Open $name") }
                        }
                    } else {
                        val current = active!!
                        Text("${current.businessName} — ${current.businessType.displayName}")
                        Text("Catalog is read-only. Billing is not yet connected.")
                        Button(enabled = !busy, onClick = {
                            busy = true; message = ""
                            scope.launch {
                                val result = catalog.refresh(current.businessId, current.businessId)
                                message = result.fold({ "Synchronized $it items" }, { "Sync unavailable: ${it.message}. Existing offline catalog retained." })
                                busy = false
                            }
                        }) { Text("Sync this outlet") }
                        Button(onClick = { sessions.clearSession(); active = null; catalogRows = emptyList(); message = "Signed out" }) { Text("Sign out") }
                        LaunchedEffect(current.businessId) {
                            catalog.observe(current.businessId).collect { catalogRows = it }
                        }
                        Text("Offline catalog: ${catalogRows.size} items")
                        LazyColumn { items(catalogRows) { row ->
                            ListItem(headlineContent = { Text(row.name) },
                                supportingContent = { Text(row.category) },
                                trailingContent = { Text("₹${row.price}") })
                        } }
                    }
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (message.isNotBlank()) Text(message)
                }
            }
        }
    }
}

private fun JsonObject.str(key: String): String =
    get(key)?.takeUnless { it.isJsonNull }?.asString ?: ""

private fun postJson(server: String, endpoint: String, body: JsonObject): JsonObject {
    val client = OkHttpClient()
    val request = Request.Builder().url(server.trimEnd('/') + "/" + endpoint)
        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        .build()
    client.newCall(request).execute().use { response ->
        val text = response.body?.string() ?: ""
        val json = runCatching { JsonParser.parseString(text).asJsonObject }.getOrNull()
        if (!response.isSuccessful || json?.get("success")?.asBoolean != true)
            error(json?.str("message")?.ifBlank { "HTTP ${response.code}" } ?: "HTTP ${response.code}")
        return json
    }
}
