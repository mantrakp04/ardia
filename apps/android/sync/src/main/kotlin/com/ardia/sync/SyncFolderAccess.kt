package com.ardia.sync

import com.ardia.sync.core.FolderStorage
import com.ardia.sync.core.SyncStorage
import java.io.File
import java.io.IOException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
sealed interface SyncFolderLocation {
    val name: String

    @Serializable
    @SerialName("path")
    data class Path(val path: String, override val name: String) : SyncFolderLocation

    @Serializable
    @SerialName("tree")
    data class Tree(val treeUri: String, val subfolder: String?, override val name: String) : SyncFolderLocation
}

sealed interface SyncFolderPick {
    data class Folder(val file: File) : SyncFolderPick

    data class Tree(val treeUri: String) : SyncFolderPick
}

class SyncFolderGrant(val storage: SyncStorage, val location: SyncFolderLocation)

interface SyncFolderAccess {
    fun open(pick: SyncFolderPick): SyncFolderGrant?

    fun resolve(location: SyncFolderLocation): SyncFolderGrant?

    fun hasAccess(location: SyncFolderLocation): Boolean

    fun keep(location: SyncFolderLocation): Boolean

    fun release(location: SyncFolderLocation, keeping: SyncFolderLocation?)
}

interface CoordinatedStorage {
    val timedOut: Boolean

    fun resume()

    fun cancelAll()
}

class SyncStorageTimedOut : IOException("the sync folder didn’t answer in time")

open class LocalFolderAccess : SyncFolderAccess {
    override fun open(pick: SyncFolderPick): SyncFolderGrant? {
        val folder = (pick as? SyncFolderPick.Folder)?.file ?: return null
        val located = SyncFolders.locate(folder) ?: return null
        return SyncFolderGrant(FolderStorage(located), SyncFolderLocation.Path(located.path, located.name))
    }

    override fun resolve(location: SyncFolderLocation): SyncFolderGrant? {
        val path = location as? SyncFolderLocation.Path ?: return null
        return SyncFolderGrant(FolderStorage(File(path.path)), path)
    }

    override fun hasAccess(location: SyncFolderLocation): Boolean = location is SyncFolderLocation.Path

    override fun keep(location: SyncFolderLocation): Boolean = location is SyncFolderLocation.Path

    override fun release(location: SyncFolderLocation, keeping: SyncFolderLocation?) {}
}
