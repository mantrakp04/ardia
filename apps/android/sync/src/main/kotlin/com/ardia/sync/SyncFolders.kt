package com.ardia.sync

import com.ardia.sync.core.Base32
import com.ardia.sync.core.FolderStorage
import java.io.File

object SyncFolders {
    val folderNames = listOf("Ardia Sync", "Netnyahoo Sync")

    fun locate(picked: File): File? {
        if (!picked.isDirectory) return null
        if (holdsChains(picked)) return picked
        val present = folderNames.map { File(picked, it) }.filter { it.isDirectory }
        return present.firstOrNull { holdsChains(it) } ?: present.firstOrNull() ?: picked
    }

    fun holdsChains(folder: File): Boolean = folder.list()?.any { Base32.isTag(it) } ?: false

    fun storage(path: String): FolderStorage? = File(path).takeIf { it.isDirectory }?.let(::FolderStorage)
}
