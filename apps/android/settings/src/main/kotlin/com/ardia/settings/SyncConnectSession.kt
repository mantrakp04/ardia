package com.ardia.settings

import android.net.Uri
import android.provider.DocumentsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.ardia.appmodel.AppModel
import com.ardia.sync.ConnectResult
import com.ardia.sync.SyncFolderPick

@Immutable
data class PickedFolder(val treeUri: String, val name: String) {
    val pick: SyncFolderPick get() = SyncFolderPick.Tree(treeUri)
}

object FolderNames {
    fun fromTreeDocumentId(documentId: String?, fallback: String): String {
        val tail = documentId.orEmpty().substringAfterLast(':').trimEnd('/').substringAfterLast('/')
        return tail.ifBlank { fallback }
    }
}

@Stable
class SyncConnectSession(private val model: AppModel) {
    var phrase: String by mutableStateOf("")
        private set
    var folder: PickedFolder? by mutableStateOf(null)
        private set
    var isConnecting: Boolean by mutableStateOf(false)
        private set
    var failure: String? by mutableStateOf(null)
        private set

    val hasPhrase: Boolean get() = model.checkPhrase(phrase).isValid

    val isReady: Boolean get() = folder != null && hasPhrase && !isConnecting

    fun usePhrase(text: String) {
        phrase = text.trim()
        failure = null
    }

    fun pickFolder(picked: PickedFolder) {
        folder = picked
        failure = null
    }

    suspend fun connectIfReady(): ConnectResult? {
        val picked = folder ?: return null
        if (!isReady) return null
        isConnecting = true
        failure = null
        val result = runCatching { model.connectSync(phrase, picked.pick) }.getOrElse { ConnectResult.FolderUnavailable }
        isConnecting = false
        val message = result.message
        if (message != null) {
            failure = message
        } else {
            phrase = ""
            folder = null
        }
        return result
    }
}

@Composable
fun rememberFolderPicker(fallbackName: String, onPick: (PickedFolder) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
        uri ?: return@rememberLauncherForActivityResult
        val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull()
        onPick(PickedFolder(uri.toString(), FolderNames.fromTreeDocumentId(documentId, fallbackName)))
    }
    return { runCatching { launcher.launch(null) } }
}
