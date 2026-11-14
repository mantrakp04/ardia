package com.ardia.shared

import android.content.res.AssetManager
import androidx.annotation.Keep

class ScriptEngine(
    assets: AssetManager,
    scripts: List<SharedScript>,
    extra: List<String> = emptyList(),
) : AutoCloseable {
    fun interface HostFunction {
        fun invoke(arguments: List<String>): String
    }

    private val functions = HashMap<String, HostFunction>()
    private var handle: Long

    init {
        handle = nativeCreate()
        try {
            for (script in scripts) {
                val bytes = assets.open(script.assetName).use { it.readBytes() }
                evaluate(bytes, script.assetName)
            }
            extra.forEachIndexed { index, source -> evaluate(source, "extra-$index.js") }
        } catch (error: Throwable) {
            close()
            throw error
        }
    }

    @Synchronized
    fun evaluate(source: String, name: String = "eval.js") {
        evaluate(source.toByteArray(Charsets.UTF_8), name)
    }

    @Synchronized
    private fun evaluate(bytes: ByteArray, name: String) {
        nativeEvaluate(live(), bytes, name)
    }

    @Synchronized
    fun register(name: String, body: HostFunction) {
        functions[name] = body
        nativeRegister(live(), name)
    }

    @Synchronized
    fun call(script: SharedScript, function: String, json: List<String> = emptyList()): String =
        nativeCall(live(), script.global, function, json.toTypedArray())

    @Synchronized
    fun callAsync(script: SharedScript, function: String, json: List<String> = emptyList()): String =
        nativeCallAsync(live(), script.global, function, json.toTypedArray())

    @Synchronized
    override fun close() {
        if (handle != 0L) {
            nativeDestroy(handle)
            handle = 0L
        }
    }

    @Keep
    private fun callHost(name: String, arguments: Array<String>): String {
        val body = functions[name] ?: throw ScriptError("__host.$name isn't registered")
        return body.invoke(arguments.asList())
    }

    private fun live(): Long {
        check(handle != 0L) { "the script engine is closed" }
        return handle
    }

    private external fun nativeCreate(): Long
    private external fun nativeDestroy(handle: Long)
    private external fun nativeEvaluate(handle: Long, source: ByteArray, name: String)
    private external fun nativeRegister(handle: Long, name: String)
    private external fun nativeCall(handle: Long, global: String, function: String, arguments: Array<String>): String
    private external fun nativeCallAsync(handle: Long, global: String, function: String, arguments: Array<String>): String

    companion object {
        init {
            System.loadLibrary("ardiahermes")
        }

        val bytecodeVersion: Int get() = nativeBytecodeVersion()

        @JvmStatic
        private external fun nativeBytecodeVersion(): Int
    }
}
