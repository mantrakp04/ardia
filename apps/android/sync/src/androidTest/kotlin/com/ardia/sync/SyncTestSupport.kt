package com.ardia.sync

import android.content.res.AssetManager
import androidx.test.platform.app.InstrumentationRegistry
import com.ardia.shared.ScriptEngine
import com.ardia.shared.SharedScript
import com.ardia.sync.core.FileKeyStore
import com.ardia.sync.core.FolderStorage
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncVault
import java.io.File
import java.util.UUID
import kotlin.random.Random
import org.json.JSONArray
import org.json.JSONObject

val testAssets: AssetManager get() = InstrumentationRegistry.getInstrumentation().targetContext.assets

class Sandbox {
    val root = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "ardia-sync-${UUID.randomUUID()}")
    val folder = File(root, "Ardia Sync")
    val state = File(root, "State")
    val keys = File(root, "Keys")

    init {
        folder.mkdirs()
    }

    fun remove() {
        root.walkTopDown().forEach { it.setWritable(true) }
        root.deleteRecursively()
    }

    fun contents(directory: File): List<String> = directory.list()?.sorted() ?: emptyList()
}

class TestClock(var now: Long = System.currentTimeMillis()) {
    fun advance(seconds: Long) {
        now += seconds * 1000
    }
}

class FakeSource : LocalBrowsingSource {
    var tabs: List<LocalTabRecord> = emptyList()
    var visits: List<LocalVisitRecord> = emptyList()
    val received = ArrayList<ReceivedTab>()
    var savesReceived = true

    override fun syncedTabs() = tabs

    override fun syncedVisits(since: Long) = visits.filter { visit -> visit.visitedAt.any { it >= since } }

    override fun removeVisits(urls: Set<String>, profileSyncId: String?) {}

    override fun receive(tabs: List<ReceivedTab>): Boolean {
        received += tabs
        return savesReceived
    }
}

class FakeMac(folder: File, entropy: ByteArray, var clock: TestClock? = null) : AutoCloseable {
    val device = "macbookpro0000000000000000"
    val keys = SyncKeys(entropy)
    val vault = SyncVault(FolderStorage(folder), keys)
    private val script = ScriptEngine(testAssets, listOf(SharedScript.SYNC), listOf(SOURCE))

    init {
        vault.createChain()
        script.register("read") { args -> SyncHost.listingJson(vault.read(args[0], SyncHost.decodeList(args[1]).toSet())) }
        script.register("write") { args -> vault.write(args[0], args[1].toByteArray()) }
        script.register("remove") { args ->
            vault.remove(args[0], SyncHost.decodeList(args[1]))
            ""
        }
    }

    fun put(scope: String, key: String, valueJson: String) {
        script.call(SharedScript.SYNC, "macPut", listOf("{\"scope\":${JSONObject.quote(scope)},\"key\":${JSONObject.quote(key)},\"value\":$valueJson}"))
    }

    fun delete(scope: String, key: String) {
        script.call(SharedScript.SYNC, "macDelete", listOf("{\"scope\":${JSONObject.quote(scope)},\"key\":${JSONObject.quote(key)}}"))
    }

    fun sync(scopes: List<String>) {
        val at = clock?.now?.toString() ?: "null"
        script.callAsync(SharedScript.SYNC, "macSync", listOf("{\"device\":\"$device\",\"scopes\":${JSONArray(scopes)},\"at\":$at}"))
    }

    fun store(scope: String): JSONObject = JSONObject(script.call(SharedScript.SYNC, "macStore", listOf("{\"scope\":${JSONObject.quote(scope)}}")))

    fun storeText(scope: String): String = script.call(SharedScript.SYNC, "macStoreCanonical", listOf("{\"scope\":${JSONObject.quote(scope)}}"))

    fun scopeFolder(scope: String) = File(File(vault.storage.let { (it as FolderStorage).root }, keys.chainTag), keys.scopeTag(scope))

    fun files(scope: String): List<JSONObject> = vault.read(scope, emptySet()).files.mapNotNull { runCatching { JSONObject(String(it.payload)) }.getOrNull() }

    fun logs(scope: String, device: String): List<JSONObject> =
        files(scope).filter { it.optString("kind") == "log" && it.optString("device") == device }.sortedBy { it.getInt("seq") }

    override fun close() = script.close()

    companion object {
        const val SOURCE = """
(() => {
  const S = globalThis.ArdiaSync;
  const scopes = {};
  const stores = {};
  let clock = null;
  let current = null;
  const now = () => current ?? Date.now();
  const transport = {
    read: async (scope, known) => JSON.parse(__host.read(scope, JSON.stringify(known))),
    write: async (scope, payload) => __host.write(scope, payload),
    remove: async (scope, ids) => { __host.remove(scope, JSON.stringify(ids)); },
  };
  const adapter = (scope) => {
    const store = (stores[scope] ??= {});
    return {
      prefix: "",
      extract: () => ({ values: new Map(Object.entries(store)) }),
      apply: (view, changed) => {
        for (const key of changed) {
          if (view.has(key)) store[key] = view.get(key);
          else delete store[key];
        }
      },
    };
  };
  const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
  S.macPut = ({ scope, key, value }) => { (stores[scope] ??= {})[key] = value; return true; };
  S.macDelete = ({ scope, key }) => { delete (stores[scope] ??= {})[key]; return true; };
  S.macStore = ({ scope }) => stores[scope] ?? {};
  S.macStoreCanonical = ({ scope }) => canonical(stores[scope] ?? {});
  S.macSync = async ({ device, scopes: list, at }) => {
    current = at ?? null;
    clock ??= new S.Clock(device, undefined, now);
    for (const scope of list) {
      await S.syncScope({ scope, state: (scopes[scope] ??= S.emptyScope()), transport, adapters: [adapter(scope)], clock, device, now });
    }
    return true;
  };
})();
"""
    }
}

class FakeCarrier(root: File, seed: Long) {
    val macFolder = File(root, "Mac/Ardia Sync").apply { mkdirs() }
    val phoneFolder = File(root, "Phone/Ardia Sync").apply { mkdirs() }
    private val random = Random(seed)
    private var synced = HashSet<String>()
    private val partial = HashSet<String>()
    var deletionsDelivered = 0
        private set
    var halfWrittenDelivered = 0
        private set

    private fun entries(folder: File): Map<String, Boolean> =
        folder.walkTopDown().filter { it != folder && !it.name.endsWith(".partial") }.associate { it.relativeTo(folder).path to it.isDirectory }

    val hasUndelivered: Boolean
        get() = entries(macFolder).keys != entries(phoneFolder).keys || partial.isNotEmpty()

    fun deliverEverything() {
        repeat(4) { if (hasUndelivered) deliver() }
    }

    fun deliver(chance: Double = 1.0, halfWritten: Double = 0.0) {
        val mac = entries(macFolder)
        val phone = entries(phoneFolder)
        val everywhere = (mac.keys + phone.keys).shuffled(random)
        val next = HashSet(synced.intersect(everywhere.toSet()))
        for (path in everywhere) {
            if (random.nextDouble() >= chance) continue
            val onMac = mac[path]
            val onPhone = phone[path]
            when {
                onMac != null && onPhone == null -> if (path in synced) {
                    File(macFolder, path).deleteRecursively()
                    deletionsDelivered++
                    partial -= path
                    next -= path
                } else {
                    copy(path, onMac, macFolder, phoneFolder, halfWritten)
                    next += path
                }
                onMac == null && onPhone != null -> if (path in synced) {
                    File(phoneFolder, path).deleteRecursively()
                    deletionsDelivered++
                    partial -= path
                    next -= path
                } else {
                    copy(path, onPhone, phoneFolder, macFolder, halfWritten)
                    next += path
                }
                onMac != null && onPhone != null -> {
                    next += path
                    if (path in partial) {
                        val source = if (File(macFolder, path).length() >= File(phoneFolder, path).length()) macFolder else phoneFolder
                        val target = if (source == macFolder) phoneFolder else macFolder
                        File(target, path).writeBytes(File(source, path).readBytes())
                        partial -= path
                    }
                }
            }
        }
        synced = next
    }

    private fun copy(path: String, isDirectory: Boolean, from: File, to: File, halfWritten: Double) {
        val destination = File(to, path)
        destination.parentFile?.mkdirs()
        if (isDirectory) {
            destination.mkdirs()
            return
        }
        val bytes = File(from, path).readBytes()
        if (bytes.size > 1 && random.nextDouble() < halfWritten) {
            destination.writeBytes(bytes.copyOf(bytes.size / 2))
            partial += path
            halfWrittenDelivered++
        } else {
            destination.writeBytes(bytes)
        }
    }
}

fun JSONObject.keyList(): List<String> = keys().asSequence().toList().sorted()

fun canonical(value: Any?): String = when (value) {
    is JSONObject -> value.keyList().joinToString(",", "{", "}") { JSONObject.quote(it) + ":" + canonical(value.get(it)) }
    is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
    is String -> JSONObject.quote(value)
    JSONObject.NULL, null -> "null"
    else -> value.toString()
}

fun JSONObject.without(keys: Collection<String>): JSONObject = JSONObject(toString()).also { copy -> keys.forEach { copy.remove(it) } }
