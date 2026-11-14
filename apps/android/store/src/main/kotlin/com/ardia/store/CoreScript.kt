package com.ardia.store

import android.content.res.AssetManager
import com.ardia.shared.ScriptEngine
import com.ardia.shared.SharedScript

fun interface CoreScript {
    fun call(function: String, arguments: List<String>): String
}

class HermesCoreScript(private val engine: ScriptEngine) : CoreScript, AutoCloseable {
    constructor(assets: AssetManager) : this(ScriptEngine(assets, listOf(SharedScript.CORE)))

    override fun call(function: String, arguments: List<String>): String = engine.call(SharedScript.CORE, function, arguments)

    override fun close() {
        engine.close()
    }
}
