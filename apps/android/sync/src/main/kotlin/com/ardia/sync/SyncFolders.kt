package com.ardia.sync

import com.ardia.sync.core.Base32
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

    fun <Entry> subfolder(children: List<Entry>, name: (Entry) -> String, isDirectory: (Entry) -> Boolean, holdsChains: (Entry) -> Boolean): Entry? {
        if (children.any { Base32.isTag(name(it)) }) return null
        val present = folderNames.mapNotNull { wanted -> children.firstOrNull { isDirectory(it) && name(it) == wanted } }
        return present.firstOrNull(holdsChains) ?: present.firstOrNull()
    }
}
