package com.smav.printagent

import com.smav.printagent.network.SmavApiClient
import com.smav.printagent.network.UnauthorizedSessionException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionPersistenceUnitTest {

    @Test
    fun confirmedInvalidationOnlyForConfirmed401Codes() {
        assertTrue(SmavApiClient.isConfirmedSessionInvalidation(401, "SESSION_EXPIRED"))
        assertTrue(SmavApiClient.isConfirmedSessionInvalidation(401, "SESSION_REVOKED"))
        assertTrue(SmavApiClient.isConfirmedSessionInvalidation(401, "ACCOUNT_DISABLED"))
        assertTrue(SmavApiClient.isConfirmedSessionInvalidation(401, "SESSION_INVALIDATED"))
        assertTrue(SmavApiClient.isConfirmedSessionInvalidation(401, "SESSION_MISSING"))

        // Temporary/non-auth errors must NEVER be treated as confirmed session invalidation
        assertFalse(SmavApiClient.isConfirmedSessionInvalidation(403, "ACCOUNT_DISABLED"))
        assertFalse(SmavApiClient.isConfirmedSessionInvalidation(500, "SESSION_EXPIRED"))
        assertFalse(SmavApiClient.isConfirmedSessionInvalidation(503, "SERVICE_UNAVAILABLE"))
        assertFalse(SmavApiClient.isConfirmedSessionInvalidation(401, "UPSTREAM_CATALOG_ERROR"))
        assertFalse(SmavApiClient.isConfirmedSessionInvalidation(401, null))
        assertFalse(SmavApiClient.isConfirmedSessionInvalidation(401, ""))
    }

    @Test
    fun sanitizeMessageRedactsJwtAndSealedTokens() {
        val leakedSealed = "Auth failed for smav_sess_v2.AbCdEf1234567890_secretPayload"
        val sanitizedSealed = SmavApiClient.sanitizeMessage(leakedSealed)
        assertFalse(sanitizedSealed.contains("smav_sess_v2."))

        val leakedBearer = "Header Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig rejected"
        val sanitizedBearer = SmavApiClient.sanitizeMessage(leakedBearer)
        assertFalse(sanitizedBearer.contains("eyJhbGci"))

        val safeMsg = "Your account has been deactivated."
        assertEquals(safeMsg, SmavApiClient.sanitizeMessage(safeMsg))
    }

    @Test
    fun unauthorizedExceptionTracksConfirmedFlag() {
        val transient401 = UnauthorizedSessionException(
            message = "Upstream 401",
            errorCode = "UPSTREAM_ERROR",
            confirmedInvalid = false
        )
        assertFalse(transient401.confirmedInvalid)

        val revoked = UnauthorizedSessionException(
            message = "Session revoked",
            errorCode = "SESSION_REVOKED",
            confirmedInvalid = true
        )
        assertTrue(revoked.confirmedInvalid)
        assertEquals("SESSION_REVOKED", revoked.errorCode)
    }
}
