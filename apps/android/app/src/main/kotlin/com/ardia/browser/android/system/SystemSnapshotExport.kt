package com.ardia.browser.android.system

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import com.ardia.appmodel.AppModel
import com.ardia.browser.BrowserUrl
import com.ardia.store.BrowserUrl as StoreUrl
import com.ardia.sync.SyncSnapshot
import com.ardia.sync.SyncState
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedProfile
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.withContext

object SystemSnapshots {
    fun of(sync: SyncState, snapshot: SyncSnapshot, selected: SyncedProfile?, colorChoice: String?): SystemSnapshot {
        val profile = selected ?: snapshot.profile(sync.selectedProfileId)
        if (!sync.isEnabled || profile == null) return SystemSnapshot(isSyncEnabled = sync.isEnabled, color = colorChoice)
        val devices = snapshot.devices
        val current = devices.filter { it.isCurrent }.map { it.id }.toSet()
        val lastSeen = devices.groupBy { it.id }.mapValues { (_, group) -> group.maxOf { it.lastSeen ?: Double.NEGATIVE_INFINITY } }
        val macs = profile.deviceTabs
            .filter { it.kind == SyncedDevice.MAC && it.deviceId !in current }
            .sortedByDescending { lastSeen[it.deviceId] ?: Double.NEGATIVE_INFINITY }
            .map { group ->
                SystemDeviceTabs(
                    device = SystemDevice(group.deviceId, group.deviceName, SystemDevice.MAC),
                    tabs = group.tabs
                        .filter { StoreUrl.isSyncable(it.url) }
                        .take(SystemSnapshot.TAB_LIMIT_PER_DEVICE)
                        .map { tab -> SystemTab(tab.title, tab.url, BrowserUrl.host(tab.url)?.let(SystemStore::faviconName)) },
                )
            }
        val targets = snapshot.devicesThatReceiveTabs(profile.syncId).map { SystemDevice(it.id, it.name, it.kind) }
        return SystemSnapshot(
            isSyncEnabled = true,
            macTabs = macs,
            sendTargets = targets,
            gradient = if (colorChoice == null) profile.theme?.colors.orEmpty() else emptyList(),
            darkGradient = if (colorChoice == null) profile.theme?.darkColors else null,
            color = colorChoice ?: profile.color,
        )
    }

    fun of(model: AppModel): SystemSnapshot = of(model.syncState, model.syncSnapshot, model.selectedProfile, model.settings.colorChoice)

    fun store(context: Context, model: AppModel): SystemStore = if (model.isDemo) SystemStore.demo(context) else SystemStore.shared(context)
}

class SystemSnapshotExporter(private val context: Context, private val store: SystemStore, private val publishes: Boolean) {
    private var last: SystemSnapshot? = null
    private val failedHosts = HashSet<String>()

    suspend fun export(snapshot: SystemSnapshot) {
        val previous = last ?: withContext(Dispatchers.IO) { store.loadSnapshot() }
        last = previous
        if (snapshot == previous) return
        val saved = withContext(Dispatchers.IO) { store.save(snapshot) }
        if (!saved) return
        last = snapshot
        if (!publishes) return
        ArdiaWidgets.refreshMacTabs(context)
        if (snapshot.look != previous.look) ArdiaWidgets.refreshSearch(context)
        if (fetchFavicons(snapshot) > 0) ArdiaWidgets.refreshMacTabs(context)
    }

    private suspend fun fetchFavicons(snapshot: SystemSnapshot): Int = withContext(Dispatchers.IO) {
        val hosts = LinkedHashMap<String, String>()
        for (tab in snapshot.macTabs.flatMap { it.tabs }) {
            val host = tab.host ?: continue
            val name = tab.favicon ?: continue
            if (store.hasFavicon(name) || host in failedHosts || host in hosts) continue
            hosts[host] = name
        }
        var saved = 0
        for ((host, name) in hosts.entries.take(FAVICON_BUDGET)) {
            val png = FaviconFetcher.png(host, FAVICON_SIDE)
            if (png != null && store.saveFavicon(png, name)) saved++ else failedHosts.add(host)
        }
        saved
    }

    companion object {
        const val FAVICON_SIDE = 64
        const val FAVICON_BUDGET = 24
    }
}

object FaviconFetcher {
    private const val TIMEOUT_MILLIS = 8_000

    fun png(host: String, side: Int): ByteArray? {
        for (path in listOf("/apple-touch-icon.png", "/favicon.ico")) {
            val bitmap = fetch("https://$host$path") ?: continue
            return render(bitmap, side)
        }
        return null
    }

    fun render(bitmap: Bitmap, side: Int): ByteArray {
        val scaled = Bitmap.createScaledBitmap(bitmap, side, side, true)
        return ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    }

    private fun fetch(address: String): Bitmap? = runCatching {
        val connection = URL(address).openConnection() as HttpURLConnection
        connection.connectTimeout = TIMEOUT_MILLIS
        connection.readTimeout = TIMEOUT_MILLIS
        try {
            if (connection.responseCode !in 200..299) return null
            connection.inputStream.use { BitmapFactory.decodeStream(it) }
        } finally {
            connection.disconnect()
        }
    }.getOrNull()
}

@Composable
fun SystemSnapshotExport(model: AppModel) {
    val context = LocalContext.current.applicationContext
    LaunchedEffect(model) {
        val exporter = SystemSnapshotExporter(context, SystemSnapshots.store(context, model), publishes = !model.isDemo)
        snapshotFlow { SystemSnapshots.of(model) }.distinctUntilChanged().collectLatest { exporter.export(it) }
    }
}
