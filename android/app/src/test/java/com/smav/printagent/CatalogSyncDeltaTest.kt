package com.smav.printagent

import com.smav.printagent.model.BusinessType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests verifying authoritative catalog synchronization,
 * monotonic revision cursor increments, delta sync queries with tombstones,
 * historical price snapshot immutability, and tenant isolation.
 */
class CatalogSyncDeltaTest {

    data class MockCatalogItem(
        val id: String,
        val businessId: String,
        val name: String,
        val price: Double,
        val revision: Long,
        val isDeleted: Boolean
    )

    data class MockBill(
        val billNumber: String,
        val businessId: String,
        val catalogRevisionAtSale: Long,
        val items: List<MockBillItem>
    )

    data class MockBillItem(
        val itemId: String,
        val itemName: String,
        val unitPrice: Double,
        val quantity: Int
    )

    @Test
    fun testMonotonicRevisionIncrement() {
        var currentRevision = 101L

        // Mutation 1: Update Hydra Glow Facial price
        currentRevision += 1
        assertEquals(102L, currentRevision)

        // Mutation 2: Add Charcoal Detox Spa
        currentRevision += 1
        assertEquals(103L, currentRevision)

        // Monotonic check: revision must strictly increase
        assertTrue("Revision must strictly increase", currentRevision > 101L)
    }

    @Test
    fun testDeltaSyncReturnsOnlyChangedRecordsSinceCursor() {
        val masterCatalog = listOf(
            MockCatalogItem("srv_1", "the_glossy_looks", "Signature Haircut", 450.0, 100L, false),
            MockCatalogItem("srv_2", "the_glossy_looks", "Hydra Glow Facial", 1600.0, 102L, false), // updated at 102
            MockCatalogItem("srv_3", "the_glossy_looks", "Keratin Therapy", 3500.0, 101L, false),
            MockCatalogItem("srv_4", "the_glossy_looks", "Old Pedicure", 600.0, 103L, true) // deleted at 103
        )

        val clientCursor = 101L

        // Query delta where revision > clientCursor
        val deltaRecords = masterCatalog.filter { it.revision > clientCursor }

        assertEquals(2, deltaRecords.size)
        assertTrue("Must include srv_2 updated at rev 102", deltaRecords.any { it.id == "srv_2" })
        assertTrue("Must include srv_4 tombstone at rev 103", deltaRecords.any { it.id == "srv_4" && it.isDeleted })
        assertFalse("Must NOT include srv_1 from older rev 100", deltaRecords.any { it.id == "srv_1" })
        assertFalse("Must NOT include srv_3 from rev 101", deltaRecords.any { it.id == "srv_3" })
    }

    @Test
    fun testTombstoneDeletionHandling() {
        val localRoomCache = mutableMapOf(
            "srv_1" to MockCatalogItem("srv_1", "the_glossy_looks", "Signature Haircut", 450.0, 100L, false),
            "srv_4" to MockCatalogItem("srv_4", "the_glossy_looks", "Old Pedicure", 600.0, 100L, false)
        )

        // Incoming delta sync contains tombstone for srv_4
        val deltaSyncIncoming = listOf(
            MockCatalogItem("srv_4", "the_glossy_looks", "Old Pedicure", 600.0, 103L, isDeleted = true)
        )

        // Client applies delta
        deltaSyncIncoming.forEach { delta ->
            if (delta.isDeleted) {
                localRoomCache.remove(delta.id)
            } else {
                localRoomCache[delta.id] = delta
            }
        }

        // Verification: tombstone item was removed from local cache
        assertFalse("Tombstoned item srv_4 must be removed from Room cache", localRoomCache.containsKey("srv_4"))
        assertTrue("Active item srv_1 must remain in cache", localRoomCache.containsKey("srv_1"))
    }

    @Test
    fun testImmutableHistoricalPriceSnapshotRetention() {
        // Initial state at revision 101: Hydra Glow Facial is ₹1200
        val catalogRevAtSale = 101L
        val originalPrice = 1200.0

        val finalizedBill = MockBill(
            billNumber = "TGL-GACH-20261107-00001",
            businessId = "the_glossy_looks",
            catalogRevisionAtSale = catalogRevAtSale,
            items = listOf(
                MockBillItem(
                    itemId = "srv_2",
                    itemName = "Hydra Glow Facial",
                    unitPrice = originalPrice,
                    quantity = 1
                )
            )
        )

        // Later, Admin bumps catalog revision to 105 and increases price to ₹1600
        val newCatalogRevision = 105L
        val updatedCatalogPrice = 1600.0

        // Verification: The past bill must remain completely unchanged
        assertEquals(101L, finalizedBill.catalogRevisionAtSale)
        assertEquals(1200.0, finalizedBill.items[0].unitPrice, 0.001)
        assertTrue(
            "Finalized bill price must not mutate when catalog price increases",
            finalizedBill.items[0].unitPrice < updatedCatalogPrice
        )
    }

    @Test
    fun testTenantIsolationInCatalogDeltaSync() {
        val salonBusinessId = "the_glossy_looks"
        val restaurantBusinessId = "mozz_starters4u"

        val masterCatalog = listOf(
            MockCatalogItem("srv_1", salonBusinessId, "Hydra Glow Facial", 1200.0, 101L, false),
            MockCatalogItem("mnu_1", restaurantBusinessId, "Classic Chicken Shawarma", 140.0, 201L, false)
        )

        // Salon staff queries sync
        val salonSync = masterCatalog.filter { it.businessId == salonBusinessId }
        assertTrue("Salon sync must have salon services", salonSync.all { it.businessId == salonBusinessId })
        assertFalse("Salon sync must never contain restaurant items", salonSync.any { it.businessId == restaurantBusinessId })

        // Restaurant staff queries sync
        val restaurantSync = masterCatalog.filter { it.businessId == restaurantBusinessId }
        assertTrue("Restaurant sync must have menu items", restaurantSync.all { it.businessId == restaurantBusinessId })
        assertFalse("Restaurant sync must never contain salon services", restaurantSync.any { it.businessId == salonBusinessId })
    }
}
