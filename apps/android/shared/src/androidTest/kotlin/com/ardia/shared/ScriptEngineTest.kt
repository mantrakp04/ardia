package com.ardia.shared

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScriptEngineTest {
    private val assets = InstrumentationRegistry.getInstrumentation().targetContext.assets

    @Test
    fun syncAndAsyncCallsRoundTripJson() {
        ScriptEngine(
            assets,
            listOf(SharedScript.SYNC, SharedScript.CORE),
            listOf(
                "ArdiaSync.__probe = async (n) => { const listing = await __host.read(JSON.stringify(n)); return { n, listing: JSON.parse(listing) }; };",
                "ArdiaSync.__fail = async () => { await null; throw new Error('nope'); };",
                "ArdiaSync.__never = () => new Promise(() => {});",
                "ArdiaSync.__hostThrows = () => { try { __host.boom(); return 'no'; } catch (e) { return String(e.message); } };",
                "ArdiaSync.__text = (s) => s + '\\u00e9\\ud83d\\ude00';",
            ),
        ).use { engine ->
            engine.register("read") { args -> "{\"echo\":${args[0]}}" }
            engine.register("boom") { throw IllegalStateException("host broke") }
            assertEquals("\"https://apple.com\"", engine.call(SharedScript.CORE, "resolveInput", listOf("\"apple.com\"")))
            assertEquals("{\"n\":{\"a\":1},\"listing\":{\"echo\":{\"a\":1}}}", engine.callAsync(SharedScript.SYNC, "__probe", listOf("{\"a\":1}")))
            assertThrows("nope") { engine.callAsync(SharedScript.SYNC, "__fail") }
            assertThrows("never resolves") { engine.callAsync(SharedScript.SYNC, "__never") }
            assertThrows("doesn't exist") { engine.call(SharedScript.CORE, "missing") }
            assertThrows("bad argument") { engine.call(SharedScript.CORE, "resolveInput", listOf("{nope")) }
            assertTrue(engine.call(SharedScript.SYNC, "__hostThrows").contains("host broke"))
            assertEquals("\"xé😀\"", engine.call(SharedScript.SYNC, "__text", listOf("\"x\"")))
        }
    }

    @Test
    fun letInALoopGetsItsOwnBindingInBytecodeAndSource() {
        ScriptEngine(assets, listOf(SharedScript.SYNC), listOf("ArdiaSync.__loop = () => { const f = []; for (let i = 0; i < 3; i++) f.push(() => i); return f.map((g) => g()); };")).use { engine ->
            assertEquals("[0,1,2]", engine.call(SharedScript.SYNC, "__loop"))
        }
    }

    @Test
    fun theRuntimeReadsTheBytecodeHermescWrote() {
        val header = assets.open(SharedScript.SYNC.assetName).use { it.readNBytes(12) }
        val version = (header[8].toInt() and 0xff) or ((header[9].toInt() and 0xff) shl 8) or ((header[10].toInt() and 0xff) shl 16) or ((header[11].toInt() and 0xff) shl 24)
        assertEquals(ScriptEngine.bytecodeVersion, version)
    }

    private fun assertThrows(fragment: String, body: () -> Unit) {
        try {
            body()
        } catch (error: ScriptError) {
            assertTrue("${error.message} should mention $fragment", error.message.orEmpty().contains(fragment))
            return
        }
        fail("expected a ScriptError mentioning $fragment")
    }
}
