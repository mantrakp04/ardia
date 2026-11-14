package com.ardia.sync.core

import java.io.File
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermissions
import java.util.UUID

interface SyncKeyStore {
    fun load(account: String): ByteArray?

    fun save(secret: ByteArray, account: String): Boolean

    fun delete(account: String)
}

class FileKeyStore(val directory: File) : SyncKeyStore {
    fun file(account: String) = File(directory, "sync-key-$account")

    override fun load(account: String): ByteArray? = try {
        file(account).readBytes()
    } catch (error: IOException) {
        null
    }

    override fun save(secret: ByteArray, account: String): Boolean {
        if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) return false
        val staging = File(directory, ".sync-key-${UUID.randomUUID()}").toPath()
        return try {
            val owner = PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))
            FileChannel.open(staging, setOf(StandardOpenOption.WRITE, StandardOpenOption.CREATE_NEW, java.nio.file.LinkOption.NOFOLLOW_LINKS), owner).use { channel ->
                val buffer = ByteBuffer.wrap(secret)
                while (buffer.hasRemaining()) channel.write(buffer)
                channel.force(true)
            }
            Files.setPosixFilePermissions(staging, PosixFilePermissions.fromString("rw-------"))
            Files.move(staging, file(account).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            true
        } catch (error: Exception) {
            Files.deleteIfExists(staging)
            false
        }
    }

    override fun delete(account: String) {
        file(account).delete()
    }
}
