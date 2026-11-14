package com.ardia.sync.core

import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.StandardCopyOption

class FolderStorage(val root: File) : SyncStorage {
    override val name: String get() = root.name

    private fun file(path: List<String>): File = path.fold(root) { at, part -> File(at, part) }

    override fun names(path: List<String>): List<String>? {
        val directory = file(path)
        if (!directory.exists()) return null
        if (!directory.isDirectory) throw IOException("${directory.name} isn't a folder")
        return directory.list()?.toList() ?: throw IOException("can't list ${directory.name}")
    }

    override fun isDirectory(path: List<String>): Boolean = file(path).isDirectory

    override fun makeDirectory(path: List<String>) {
        val directory = file(path)
        if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) throw IOException("can't make ${directory.name}")
    }

    override fun removeTree(path: List<String>) {
        val target = file(path)
        if (target.exists() && !target.deleteRecursively()) throw IOException("can't remove ${target.name}")
    }

    override fun read(path: List<String>): ByteArray = file(path).readBytes()

    override fun write(path: List<String>, bytes: ByteArray) {
        val destination = file(path)
        val directory = destination.parentFile ?: throw IOException("no folder for ${destination.name}")
        val staging = File(directory, ".${destination.name}.${System.nanoTime()}.partial")
        try {
            staging.outputStream().use { stream ->
                stream.write(bytes)
                stream.fd.sync()
            }
            try {
                Files.move(staging.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (error: AtomicMoveNotSupportedException) {
                Files.move(staging.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            staging.delete()
        }
    }

    override fun remove(path: List<String>): Boolean =
        try {
            Files.delete(file(path).toPath())
            true
        } catch (error: NoSuchFileException) {
            false
        } catch (error: FileNotFoundException) {
            false
        }

    override fun ageMillis(path: List<String>): Long? {
        val modified = file(path).lastModified()
        return if (modified == 0L) null else maxOf(0L, System.currentTimeMillis() - modified)
    }
}
