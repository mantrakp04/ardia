package com.ardia.sync

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri

open class AndroidSyncFolderAccess(
    protected val resolver: ContentResolver,
    protected val timeoutMs: Long = ResolverDocumentTree.DEFAULT_TIMEOUT_MS,
) : LocalFolderAccess() {
    override fun open(pick: SyncFolderPick): SyncFolderGrant? {
        val tree = (pick as? SyncFolderPick.Tree)?.let { tree(it.treeUri) } ?: return super.open(pick)
        return try {
            val subfolder = DocumentTreeStorage.locate(tree)
            val name = subfolder ?: tree.root().name
            val location = SyncFolderLocation.Tree(pick.treeUri, subfolder, name)
            SyncFolderGrant(DocumentTreeStorage(tree, subfolder, name), location)
        } catch (error: Exception) {
            null
        }
    }

    override fun resolve(location: SyncFolderLocation): SyncFolderGrant? {
        if (location !is SyncFolderLocation.Tree) return super.resolve(location)
        val tree = tree(location.treeUri) ?: return null
        if (!tree.hasPersistedAccess()) return null
        return SyncFolderGrant(DocumentTreeStorage(tree, location.subfolder, location.name), location)
    }

    override fun hasAccess(location: SyncFolderLocation): Boolean {
        if (location !is SyncFolderLocation.Tree) return super.hasAccess(location)
        return tree(location.treeUri)?.hasPersistedAccess() == true
    }

    override fun keep(location: SyncFolderLocation): Boolean {
        if (location !is SyncFolderLocation.Tree) return super.keep(location)
        return try {
            resolver.takePersistableUriPermission(Uri.parse(location.treeUri), READ_AND_WRITE)
            true
        } catch (error: SecurityException) {
            false
        }
    }

    override fun release(location: SyncFolderLocation, keeping: SyncFolderLocation?) {
        if (location !is SyncFolderLocation.Tree) return
        if ((keeping as? SyncFolderLocation.Tree)?.treeUri == location.treeUri) return
        try {
            resolver.releasePersistableUriPermission(Uri.parse(location.treeUri), READ_AND_WRITE)
        } catch (error: SecurityException) {
        }
    }

    private fun tree(uri: String): ResolverDocumentTree? = try {
        ResolverDocumentTree(resolver, Uri.parse(uri), timeoutMs)
    } catch (error: IllegalArgumentException) {
        null
    }

    companion object {
        const val READ_AND_WRITE = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }
}
