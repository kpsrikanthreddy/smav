package com.smav.printagent.network

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.smav.printagent.data.repository.SessionManager
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

class UnauthorizedSessionException(message: String = "Your session has expired. Please sign in again.") :
    IOException(message)

class HtmlResponseException(
    message: String = "The SMAV server returned a web page instead of data. Please verify the deployment."
) : IOException(message)

object SmavApiClient {

    fun create(sessionManager: SessionManager): ApiService {
        val htmlGuardInterceptor = Interceptor { chain ->
            val request = chain.request().newBuilder()
                .header("Accept", "application/json")
                .build()
            val response = chain.proceed(request)
            val body = response.body
            if (body != null) {
                val contentType = response.header("Content-Type")?.lowercase() ?: ""
                val peekText = response.peekBody(4096).string().trimStart()
                val looksHtml = contentType.contains("text/html") ||
                    peekText.startsWith("<!doctype", ignoreCase = true) ||
                    peekText.startsWith("<html", ignoreCase = true)
                if (looksHtml) {
                    response.close()
                    throw HtmlResponseException()
                }
            }
            response
        }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(htmlGuardInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .writeTimeout(25, TimeUnit.SECONDS)
            .build()

        val baseUrl = sessionManager.getServerUrl().trimEnd('/') + "/"

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ApiService::class.java)
    }

    fun bearer(token: String): String =
        if (token.startsWith("Bearer ", ignoreCase = true)) token else "Bearer $token"

    fun parseErrorMessage(response: Response<*>, fallback: String = "Request could not be completed."): String {
        val raw = runCatching { response.errorBody()?.string() }.getOrNull().orEmpty()
        val parsed = runCatching { JsonParser.parseString(raw).asJsonObject }.getOrNull()
        val serverMsg = parsed?.get("message")?.takeIf { !it.isJsonNull }?.asString
            ?: parsed?.get("error")?.takeIf { !it.isJsonNull }?.asString
        if (!serverMsg.isNullOrBlank()) return sanitizeMessage(serverMsg)
        return when (response.code()) {
            401 -> "Your session has expired. Please sign in again."
            403 -> "You do not have permission for this action."
            404 -> "The requested record or service was not found."
            409 -> "This record changed on the server. Refresh and try again."
            429 -> "Too many attempts. Please wait a moment and try again."
            in 500..599 -> "The SMAV server is temporarily unavailable. Please try again."
            else -> fallback
        }
    }

    fun friendlyThrowable(t: Throwable, fallback: String = "Unable to connect to SMAV server."): String {
        return when (t) {
            is UnauthorizedSessionException -> t.message ?: "Your session has expired. Please sign in again."
            is HtmlResponseException -> t.message ?: "The SMAV server returned a web page instead of JSON data."
            is UnknownHostException -> "Offline or server unreachable. Check your internet connection."
            is SocketTimeoutException -> "The server took too long to respond. Please try again."
            is IOException -> t.message?.takeIf { !it.contains("HTTP ", ignoreCase = true) }
                ?: "Network connection interrupted. Working offline where available."
            else -> sanitizeMessage(t.message ?: fallback)
        }
    }

    @PublishedApi
    internal fun sanitizeMessage(msg: String): String {
        val trimmed = msg.trim()
        if (trimmed.isBlank()) return "Something went wrong. Please try again."
        if (trimmed.startsWith("<!doctype", ignoreCase = true) || trimmed.startsWith("<html", ignoreCase = true)) {
            return "The SMAV server returned a web page instead of JSON data."
        }
        val sensitivePatterns = listOf(
            Regex("eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]+"),
            Regex("Bearer\\s+[A-Za-z0-9._~+/=-]{8,}", RegexOption.IGNORE_CASE),
            Regex("(service_?role|supabase_?key|anon_?key|access_?token|refresh_?token|api_?key|authorization)\\s*[:=]", RegexOption.IGNORE_CASE),
            Regex("(\"password\"|password\\s*=)\\s*[:=]?", RegexOption.IGNORE_CASE)
        )
        if (sensitivePatterns.any { it.containsMatchIn(trimmed) }) {
            return "Request failed due to an authentication or server error. Please try again."
        }
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            return "The server returned an unexpected error payload. Please try again."
        }
        return if (trimmed.length > 240) trimmed.take(240).trimEnd() + "..." else trimmed
    }

    inline fun <T> unwrapOrThrow(
        response: Response<JsonObject>,
        mapper: (JsonObject) -> T
    ): T {
        if (response.code() == 401) {
            throw UnauthorizedSessionException(parseErrorMessage(response))
        }
        val body = response.body()
        if (!response.isSuccessful || body == null) {
            throw IOException(parseErrorMessage(response))
        }
        if (body.has("success") && !body.get("success").isJsonNull && body.get("success").asBoolean == false) {
            val msg = body.get("message")?.takeIf { !it.isJsonNull }?.asString
                ?: body.get("error")?.takeIf { !it.isJsonNull }?.asString
                ?: "Operation was not accepted by the server."
            throw IOException(sanitizeMessage(msg))
        }
        return mapper(body)
    }
}

fun JsonObject.optString(vararg keys: String): String {
    for (k in keys) {
        val el = get(k)
        if (el != null && !el.isJsonNull && el.isJsonPrimitive) {
            val s = el.asString
            if (s.isNotBlank()) return s
        }
    }
    return ""
}

fun JsonObject.optBool(key: String, default: Boolean = false): Boolean {
    val el = get(key) ?: return default
    if (el.isJsonNull || !el.isJsonPrimitive) return default
    return runCatching { el.asBoolean }.getOrDefault(default)
}

fun JsonObject.optDouble(vararg keys: String, default: Double = 0.0): Double {
    for (k in keys) {
        val el = get(k)
        if (el != null && !el.isJsonNull && el.isJsonPrimitive) {
            val d = runCatching { el.asDouble }.getOrNull()
            if (d != null && d.isFinite()) return d
        }
    }
    return default
}

fun JsonObject.optInt(vararg keys: String, default: Int = 0): Int {
    for (k in keys) {
        val el = get(k)
        if (el != null && !el.isJsonNull && el.isJsonPrimitive) {
            val v = runCatching { el.asInt }.getOrNull()
            if (v != null) return v
        }
    }
    return default
}

fun JsonObject.optLong(vararg keys: String, default: Long = 0L): Long {
    for (k in keys) {
        val el = get(k)
        if (el != null && !el.isJsonNull && el.isJsonPrimitive) {
            val v = runCatching { el.asLong }.getOrNull()
            if (v != null) return v
        }
    }
    return default
}

fun JsonElement?.asJsonObjectOrNull(): JsonObject? =
    if (this != null && !isJsonNull && isJsonObject) asJsonObject else null
