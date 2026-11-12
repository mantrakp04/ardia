package com.ardia.browser

import android.content.Context
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

object DownloadHarness {
    fun run(downloads: SystemDownloads, download: PageDownload): DownloadOutcome = runBlocking {
        val id = downloads.enqueue(download)
        check(id != null) { "the download was not started" }
        withTimeout(30_000) { downloads.outcomes.first() }
    }

    fun contents(context: Context, outcome: DownloadOutcome): String? {
        val uri = (outcome as? DownloadOutcome.Finished)?.uri ?: return null
        return context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
    }

    fun delete(context: Context, outcome: DownloadOutcome?) {
        val uri = (outcome as? DownloadOutcome.Finished)?.uri ?: return
        runCatching { context.contentResolver.delete(uri, null, null) }
    }
}

@RunWith(AndroidJUnit4::class)
class SystemDownloadsTest {
    private val harness = PageHarness()
    private val server = harness.server
    private val created = ArrayList<DownloadOutcome>()

    @After
    fun tearDown() {
        created.forEach { DownloadHarness.delete(harness.context, it) }
        harness.close()
    }

    private fun download(url: String, fileName: String, isPrivate: Boolean = false) = PageDownload(
        url = url,
        fileName = fileName,
        mimeType = null,
        contentLength = -1,
        userAgent = "ArdiaTest",
        contentDisposition = null,
        referer = null,
        isPrivate = isPrivate,
    )

    private fun hostedOnLocalhost(path: String) = "http://localhost:${server.port}$path"

    @Test
    fun aRedirectToAnotherHostCarriesNoCookies() {
        server.route("/login") {
            TestServer.Response(body = "<title>In</title>", headers = mapOf("Set-Cookie" to "session=secret; Path=/"))
        }
        server.route("/statement") { TestServer.Response(302, headers = mapOf("Location" to hostedOnLocalhost("/collect"))) }
        server.route("/collect") { TestServer.Response(body = "statement body", contentType = "application/pdf") }
        val page = harness.open("tab", "/login")
        harness.awaitTitle(page, "In")
        assertEquals("session=secret", onMain { harness.engine.cookieHeader(server.url("/statement"), isPrivate = false) })

        val outcome = DownloadHarness.run(SystemDownloads(harness.context, harness.engine), download(server.url("/statement"), "statement.pdf"))
        created += outcome
        assertTrue("$outcome", outcome is DownloadOutcome.Finished)
        assertEquals("statement body", DownloadHarness.contents(harness.context, outcome))
        val first = server.requests.last { it.path == "/statement" }
        val second = server.requests.last { it.path == "/collect" }
        assertEquals("session=secret", first.headers["cookie"])
        assertEquals("localhost:${server.port}", second.headers["host"])
        assertNull(second.headers["cookie"])
        assertEquals("ArdiaTest", second.headers["user-agent"])
    }

    @Test
    fun theFileLandsInDownloadsWithASafeUniqueName() {
        server.route("/file") { TestServer.Response(body = "one", contentType = "text/plain") }
        val downloads = SystemDownloads(harness.context, harness.engine)
        val first = DownloadHarness.run(downloads, download(server.url("/file"), "../../secret/notes.txt"))
        created += first
        val second = DownloadHarness.run(downloads, download(server.url("/file"), "notes.txt"))
        created += second
        assertTrue(first is DownloadOutcome.Finished && second is DownloadOutcome.Finished)
        assertTrue(first.fileName.startsWith("notes") && !first.fileName.contains('/'))
        assertNotEquals(first.fileName, second.fileName)
        val uri = (first as DownloadOutcome.Finished).uri!!
        val path = harness.context.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.RELATIVE_PATH), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
        assertEquals("Download/", path)
        assertTrue(downloads.active.value.isEmpty())
    }

    @Test
    fun aMissingFileFailsAndLeavesNothingBehind() {
        val downloads = SystemDownloads(harness.context, harness.engine)
        val outcome = DownloadHarness.run(downloads, download(server.url("/nothing-here"), "gone.txt"))
        assertEquals(DownloadOutcome.Failed("gone.txt", DownloadFailure.Server), outcome)
        assertTrue(downloads.active.value.isEmpty())
    }

    @Test
    fun blobAndDataAddressesAreNotStarted() {
        val downloads = SystemDownloads(harness.context, harness.engine)
        assertNull(downloads.enqueue(download("blob:http://127.0.0.1/1", "a.bin")))
        assertNull(downloads.enqueue(download("data:text/plain,hi", "a.txt")))
    }
}
