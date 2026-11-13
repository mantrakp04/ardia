package com.ardia.sync.core

import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FileKeyStoreTest {
    @Test
    fun theKeyFileIsOnlyEverTheOwnersAndNothingIsLeftBeside() {
        val folder = Files.createTempDirectory("ardia-sync-keys").toFile()
        try {
            val store = FileKeyStore(folder)
            assertTrue(store.save("first".toByteArray(), "device"))
            assertTrue(store.save("second".toByteArray(), "device"))
            assertArrayEquals("second".toByteArray(), store.load("device"))
            assertEquals(listOf("sync-key-device"), folder.list()!!.toList())
            assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(store.file("device").toPath())))
            store.delete("device")
            assertNull(store.load("device"))
        } finally {
            folder.deleteRecursively()
        }
    }
}
