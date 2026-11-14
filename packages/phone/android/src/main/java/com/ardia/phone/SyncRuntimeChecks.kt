package com.ardia.phone

import android.content.res.AssetManager
import com.ardia.shared.ScriptEngine
import com.ardia.shared.SharedScript
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

internal object SyncRuntimeChecks {
    data class Outcome(val name: String, val pass: Boolean, val actual: String, val expected: String)

    fun compare(actualJson: String, expectedJson: String): List<Outcome> {
        val actual = runCatching { Json.parseToJsonElement(actualJson).jsonObject }.getOrElse { JsonObject(emptyMap()) }
        val expected = Json.parseToJsonElement(expectedJson).jsonObject
        return (expected.keys + actual.keys).distinct().map { name ->
            val wanted: JsonElement? = expected[name]
            val got: JsonElement? = actual[name]
            Outcome(name, wanted != null && wanted == got, got?.toString() ?: "missing", wanted?.toString() ?: "not expected")
        }
    }

    fun run(assets: AssetManager): List<Outcome> {
        check(PhoneLab.isOn) { "the runtime checks exist only in lab builds" }
        val expected = assets.open(EXPECTED_ASSET).use { it.readBytes().toString(Charsets.UTF_8) }
        val actual = ScriptEngine(assets, listOf(SharedScript.SYNC, SharedScript.SYNC_CHECKS)).use { engine ->
            engine.register("labEcho") { arguments -> "echo:${arguments.firstOrNull().orEmpty()}" }
            engine.callAsync(SharedScript.SYNC_CHECKS, "run")
        }
        return compare(actual, expected)
    }

    private const val EXPECTED_ASSET = "ardia-sync-checks.json"
}
