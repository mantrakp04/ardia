package com.ardia.shared

import android.os.Bundle
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlin.random.Random
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KeystrokeTimingTest {
    private val words = listOf("news", "docs", "mail", "maps", "shop", "play", "code", "wiki", "blog", "home", "status", "music", "video", "photos", "notes", "travel", "recipes", "sports", "finance", "weather")
    private val hosts = (0 until 500).map { i -> "${words[i % words.size]}${i / words.size}.${listOf("com", "org", "net", "dev", "io")[i % 5]}" } +
        listOf("github.com", "google.com", "youtube.com", "wikipedia.org", "reddit.com")

    private fun source(): String {
        val random = Random(42)
        val now = System.currentTimeMillis()
        val history = JSONArray()
        repeat(5_000) { i ->
            val host = hosts[random.nextInt(hosts.size)]
            val path = if (i % 25 == 0) "mantrakp04/ardia/pull/${i / 25}" else (0 until random.nextInt(0, 4)).joinToString("/") { words[random.nextInt(words.size)] + random.nextInt(100) }
            history.put(
                JSONObject()
                    .put("url", if (i % 25 == 0) "https://github.com/$path" else "https://$host/$path")
                    .put("title", "${words[random.nextInt(words.size)].replaceFirstChar { it.uppercase() }} $i on $host")
                    .put("favicon", JSONObject.NULL)
                    .put("visits", 1 + random.nextInt(40))
                    .put("lastVisit", now - random.nextLong(90L * 86_400_000)),
            )
        }
        val bookmarks = JSONArray()
        repeat(500) { i ->
            val host = hosts[random.nextInt(hosts.size)]
            bookmarks.put(JSONObject().put("url", "https://$host/saved/$i").put("title", "Saved ${words[i % words.size]} $i").put("favicon", JSONObject.NULL))
        }
        val tabs = JSONArray()
        repeat(30) { i ->
            val host = hosts[random.nextInt(hosts.size)]
            tabs.put(JSONObject().put("id", "tab-$i").put("url", "https://$host/open/$i").put("title", "Open ${words[i % words.size]} $i").put("favicon", JSONObject.NULL))
        }
        return JSONObject().put("tabs", tabs).put("history", history).put("bookmarks", bookmarks).toString()
    }

    @Test
    fun mobileSuggestPerKeystroke() {
        val typed = "github.com/mantrakp04/ardia/pu"
        check(typed.length == 30)
        val assets = InstrumentationRegistry.getInstrumentation().targetContext.assets
        val loadStart = System.nanoTime()
        ScriptEngine(assets, listOf(SharedScript.CORE)).use { engine ->
            val loadMs = (System.nanoTime() - loadStart) / 1e6
            val seedStart = System.nanoTime()
            engine.call(SharedScript.CORE, "mobileSetSources", listOf(source()))
            val seedMs = (System.nanoTime() - seedStart) / 1e6
            for (i in 1..typed.length) engine.call(SharedScript.CORE, "mobileSuggest", listOf(JSONObject.quote(typed.substring(0, i))))
            val samples = ArrayList<Double>()
            val perKey = List(typed.length) { ArrayList<Double>() }
            val items = IntArray(typed.length)
            repeat(3) {
                for (i in 1..typed.length) {
                    val start = System.nanoTime()
                    val result = engine.call(SharedScript.CORE, "mobileSuggest", listOf(JSONObject.quote(typed.substring(0, i)), "{\"now\":${System.currentTimeMillis()}}"))
                    val ms = (System.nanoTime() - start) / 1e6
                    samples += ms
                    perKey[i - 1] += ms
                    items[i - 1] = JSONObject(result).getJSONArray("items").length()
                }
            }
            val lastItems = items.last()
            Log.i("ArdiaTiming", "per key median ms: " + perKey.mapIndexed { i, list -> "${typed[i]}=%.2f(${items[i]})".format(list.sorted()[1]) }.joinToString(" "))
            val sorted = samples.sorted()
            val median = (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2
            val p75 = sorted[(sorted.size * 3) / 4]
            val worst = sorted.last()
            val line = "mobileSuggest n=${samples.size} median=%.2f ms p75=%.2f ms best=%.2f ms worst=%.2f ms; engine load %.1f ms, mobileSetSources %.1f ms; last result %d items".format(median, p75, sorted.first(), worst, loadMs, seedMs, lastItems)
            Log.i("ArdiaTiming", line)
            InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply { putString("ArdiaTiming", line) })
            assertTrue(lastItems > 0)
        }
    }
}
