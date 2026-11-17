package com.smav.printagent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Login
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
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
                var outletCode by remember { mutableStateOf("") }
                var passwordVisible by remember { mutableStateOf(false) }
                var message by remember { mutableStateOf("") }
                var busy by remember { mutableStateOf(false) }
                var pendingToken by remember { mutableStateOf("") }
                var pendingUserId by remember { mutableStateOf("") }
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
                    pendingUserId = ""
                    password = ""
                }
                if (active == null) {
                    val pageBackground = Color(0xFF080D21)
                    val cardBackground = Color(0xFF0E142A)
                    val fieldBackground = Color(0xFF121832)
                    val outline = Color(0xFF30385B)
                    val secondaryText = Color(0xFF8FA6D7)
                    Box(
                        Modifier.fillMaxSize().background(pageBackground).padding(8.dp),
                        contentAlignment = Alignment.TopCenter
                    ) {
                        Column(
                            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                                .background(cardBackground, RoundedCornerShape(28.dp)).padding(horizontal = 28.dp, vertical = 36.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Surface(
                                modifier = Modifier.size(76.dp),
                                shape = RoundedCornerShape(22.dp),
                                color = Color(0xFF171E38),
                                border = BorderStroke(1.dp, outline)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.Print, "Printer", tint = Color(0xFFFF2D82), modifier = Modifier.size(38.dp))
                                }
                            }
                            Spacer(Modifier.height(24.dp))
                            Text("SMAV Print Agent", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(8.dp))
                            Text("Secure Enterprise Authentication Gateway", color = Color(0xFF78A7E8), fontSize = 15.sp)
                            Spacer(Modifier.height(40.dp))

                            LoginLabel("Email Address or Username")
                            OutlinedTextField(
                                value = username,
                                onValueChange = { username = it },
                                placeholder = { Text("name@company.com or username", color = Color(0xFF64749F)) },
                                singleLine = true,
                                colors = loginFieldColors(fieldBackground, outline),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(22.dp))

                            LoginLabel("Password / PIN")
                            OutlinedTextField(
                                value = password,
                                onValueChange = { password = it },
                                placeholder = { Text("Enter password", color = Color(0xFF64749F)) },
                                singleLine = true,
                                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                        Icon(if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                            "Show or hide password", tint = secondaryText)
                                    }
                                },
                                colors = loginFieldColors(fieldBackground, outline),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(22.dp))

                            LoginLabel("Outlet Code (optional)")
                            OutlinedTextField(
                                value = outletCode,
                                onValueChange = { outletCode = it },
                                placeholder = { Text("e.g. mozz, glossylooks", color = Color(0xFF64749F)) },
                                singleLine = true,
                                colors = loginFieldColors(fieldBackground, outline),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                            Spacer(Modifier.height(8.dp))
                            Text("Used to identify an outlet's authentication provider when required.",
                                color = Color(0xFF78A7E8), fontSize = 13.sp, modifier = Modifier.fillMaxWidth())
                            Spacer(Modifier.height(32.dp))

                        Button(onClick = {
                            busy = true; message = ""
                            scope.launch {
                                try {
                                    require(server.startsWith("https://")) { "HTTPS server URL required" }
                                    sessions.setServerUrl(server)
                                    val body = JsonObject().apply {
                                        addProperty("emailOrId", username); addProperty("email", username)
                                        addProperty("password", password)
                                        if (outletCode.isNotBlank()) addProperty("outletCode", outletCode.trim())
                                        addProperty("device_id", sessions.deviceId)
                                    }
                                    val reply = withContext(Dispatchers.IO) { postJson(server, "api/auth/login", body) }
                                    val isMultiBusiness = reply.bool("multiBusiness") || reply.bool("multi_business")
                                    if (isMultiBusiness) {
                                        pendingToken = reply.str("tempToken").ifBlank { reply.str("temp_token") }
                                        pendingUserId = reply.str("userId").ifBlank {
                                            reply.getAsJsonObject("session")?.str("userId") ?: ""
                                        }
                                        val options = reply.getAsJsonArray("availableOutlets")
                                            ?: reply.getAsJsonArray("available_businesses")
                                        outlets = options?.mapNotNull { element ->
                                            val o = element.asJsonObject
                                            val id = o.str("outletId").ifBlank { o.str("business_id") }
                                            val name = o.str("outletName").ifBlank { o.str("business_name") }
                                            if (id.isBlank()) null else id to name.ifBlank { "Outlet" }
                                        } ?: emptyList()
                                        require((pendingToken.isNotBlank() || pendingUserId.isNotBlank()) && outlets.isNotEmpty()) {
                                            "Server did not provide selectable outlets"
                                        }
                                        password = ""
                                    } else installSession(reply)
                                } catch(e: Exception) { message = e.message ?: "Login failed" }
                                finally { busy = false }
                            }
                        },
                            enabled = !busy && username.isNotBlank() && password.isNotBlank(),
                            modifier = Modifier.fillMaxWidth().height(64.dp),
                            shape = RoundedCornerShape(16.dp),
                            border = BorderStroke(3.dp, Brush.horizontalGradient(listOf(Color(0xFFFF1F81), Color(0xFFFFA000)))),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xFF24293A), contentColor = Color.White,
                                disabledContainerColor = Color(0xFF24293A), disabledContentColor = Color(0xFF71788D)
                            )
                        ) {
                            Icon(Icons.Default.Login, null)
                            Spacer(Modifier.width(12.dp))
                            Text("Sign In", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.height(22.dp))
                        TextButton(onClick = { message = "Please contact your outlet administrator to reset your credentials." }) {
                            Text("Forgot Password? ", color = secondaryText)
                            Text("Reset your credentials", color = Color(0xFFFF2D82), fontWeight = FontWeight.Bold)
                        }
                        outlets.forEach { (id, name) ->
                            Button(enabled = !busy, onClick = {
                                busy = true
                                scope.launch {
                                    try {
                                        val body = JsonObject().apply {
                                            addProperty("tempToken", pendingToken)
                                            addProperty("temp_token", pendingToken)
                                            addProperty("userId", pendingUserId)
                                            addProperty("user_id", pendingUserId)
                                            addProperty("outletId", id)
                                            addProperty("business_id", id)
                                            addProperty("deviceId", sessions.deviceId)
                                            addProperty("device_id", sessions.deviceId)
                                        }
                                        installSession(withContext(Dispatchers.IO) { postJson(server, "api/auth/select-outlet", body) })
                                    } catch(e: Exception) { message = e.message ?: "Outlet selection failed" }
                                    finally { busy = false }
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text("Open $name") }
                        }
                        if (busy) {
                            Spacer(Modifier.height(16.dp))
                            LinearProgressIndicator(Modifier.fillMaxWidth(), color = Color(0xFFFF2D82))
                        }
                        if (message.isNotBlank()) {
                            Spacer(Modifier.height(16.dp))
                            Text(message, color = Color(0xFFFFA5B8), textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
                } else {
                    Column(Modifier.fillMaxSize().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        val current = active!!
                        Text("SMAV Print Agent", style = MaterialTheme.typography.headlineSmall)
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
                        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                        if (message.isNotBlank()) Text(message)
                    }
                }
            }
        }
    }
}

private fun JsonObject.str(key: String): String =
    get(key)?.takeUnless { it.isJsonNull }?.asString ?: ""

private fun JsonObject.bool(key: String): Boolean =
    get(key)?.takeUnless { it.isJsonNull }?.runCatching { asBoolean }?.getOrDefault(false) ?: false

@Composable
private fun LoginLabel(text: String) {
    Text(text, color = Color(0xFFDCE7FF), fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp))
}

@Composable
private fun loginFieldColors(background: Color, outline: Color) = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Color.White,
    unfocusedTextColor = Color.White,
    focusedContainerColor = background,
    unfocusedContainerColor = background,
    focusedBorderColor = Color(0xFF50618F),
    unfocusedBorderColor = outline,
    cursorColor = Color(0xFFFF2D82)
)

private fun postJson(server: String, endpoint: String, body: JsonObject): JsonObject {
    val client = OkHttpClient()
    val request = Request.Builder().url(server.trimEnd('/') + "/" + endpoint)
        .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        .build()
    client.newCall(request).execute().use { response ->
        val text = response.body?.string() ?: ""
        val json = runCatching { JsonParser.parseString(text).asJsonObject }.getOrNull()
        if (json == null) {
            error(if (response.isSuccessful) {
                "The SMAV server returned a web page instead of login data. Please deploy the latest server package."
            } else "Server error: HTTP ${response.code}")
        }
        if (!response.isSuccessful || json.get("success")?.asBoolean != true) {
            val serverMessage = json.str("message").ifBlank { json.str("error") }
            error(serverMessage.ifBlank {
                if (response.isSuccessful) "Login was not accepted by the SMAV server." else "Server error: HTTP ${response.code}"
            })
        }
        return json
    }
}
