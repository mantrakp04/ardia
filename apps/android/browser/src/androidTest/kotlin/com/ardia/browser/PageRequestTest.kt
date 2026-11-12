package com.ardia.browser

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PageRequestTest {
    private val harness = PageHarness()
    private val server = harness.server
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @After
    fun tearDown() = harness.close()

    private fun awaitRequest(page: Page, matches: (PageRequest.Kind) -> Boolean): PageRequest =
        harness.await(page.request) { request -> request != null && matches(request.kind) }!!

    @Test
    fun alertWaitsForItsAnswer() {
        server.page("/alert", "<title>Before</title><script>onload = () => { alert('Hello there'); document.title = 'After' }</script>")
        val page = harness.open("tab", "/alert")
        val request = awaitRequest(page) { it is PageRequest.Kind.Alert }
        assertEquals(PageRequest.Kind.Alert("Hello there"), request.kind)
        assertEquals("127.0.0.1", request.title(context))
        assertEquals("Hello there", request.message(context))
        harness.await(page.state) { it.title == "Before" }
        request.answer(PageRequest.Answer.Accepted)
        harness.awaitTitle(page, "After")
        assertNull(page.request.value)
        assertTrue(request.isAnswered)
    }

    @Test
    fun confirmAndPromptReturnTheAnswers() {
        server.page("/ask", "<script>onload = () => { const sure = confirm('Sure?'); const name = prompt('Name?', 'Ada'); document.title = sure + ':' + name }</script>")
        val page = harness.open("tab", "/ask")
        awaitRequest(page) { it is PageRequest.Kind.Confirm }.answer(PageRequest.Answer.Accepted)
        val prompt = awaitRequest(page) { it is PageRequest.Kind.Prompt }
        assertEquals("Ada", (prompt.kind as PageRequest.Kind.Prompt).defaultText)
        prompt.answer(PageRequest.Answer.Text("Grace"))
        harness.awaitTitle(page, "true:Grace")
    }

    @Test
    fun dismissingConfirmAndPromptIsNo() {
        server.page("/no", "<script>onload = () => { const sure = confirm('Sure?'); const name = prompt('Name?'); document.title = sure + ':' + name }</script>")
        val page = harness.open("tab", "/no")
        awaitRequest(page) { it is PageRequest.Kind.Confirm }.dismiss()
        awaitRequest(page) { it is PageRequest.Kind.Prompt }.dismiss()
        harness.awaitTitle(page, "false:null")
    }

    private fun awaitRequestOrPageError(page: Page): PageRequest {
        val outcome = harness.poll {
            page.request.value?.takeIf { it.kind is PageRequest.Kind.Permission }
                ?: page.state.value.title.takeIf { it.startsWith("error:") }
        }
        assumeTrue("The emulator refused before asking: $outcome", outcome is PageRequest)
        return outcome as PageRequest
    }

    @Test
    fun cameraAccessAsksAndDenialReachesThePage() {
        server.page(
            "/camera",
            "<title>Waiting</title><script>setTimeout(() => navigator.mediaDevices.getUserMedia({ video: true })" +
                ".then(() => document.title = 'granted', (error) => document.title = 'error:' + error.name), 200)</script>",
        )
        val page = harness.open("tab", "/camera")
        val request = awaitRequestOrPageError(page)
        assertEquals(PageRequest.Kind.Permission(SitePermission.Camera), request.kind)
        assertEquals("“127.0.0.1” Would Like to Access the Camera", request.title(context))
        request.dismiss()
        assertTrue(harness.await(page.state) { it.title.startsWith("error:") }.title.contains("NotAllowed"))
    }

    @Test
    fun locationAsksForTheSite() {
        server.page(
            "/where",
            "<title>Waiting</title><script>setTimeout(() => navigator.geolocation.getCurrentPosition(() => document.title = 'found'," +
                " (error) => document.title = 'error:' + error.code), 200)</script>",
        )
        val page = harness.open("tab", "/where")
        val request = awaitRequestOrPageError(page)
        assertEquals(PageRequest.Kind.Permission(SitePermission.Location), request.kind)
        assertEquals("“127.0.0.1” Would Like to Use Your Current Location", request.title(context))
        request.dismiss()
        harness.await(page.state) { it.title == "error:1" }
    }

    @Test
    fun linksForOtherAppsAskFirst() {
        server.page("/call", "<title>Call</title><script>onload = () => setTimeout(() => location.href = 'tel:5551234', 100)</script>")
        val page = harness.open("tab", "/call")
        val request = awaitRequest(page) { it is PageRequest.Kind.OpenExternal }
        assertEquals(PageRequest.Kind.OpenExternal("tel:5551234", ExternalApp.Phone), request.kind)
        assertEquals("Open in “Phone”?", request.title(context))
        assertEquals("5551234", request.message(context))
        request.dismiss()
        assertEquals(server.url("/call"), page.state.value.url)
    }

    @Test
    fun httpSignInAsksAndRetriesKnowTheyFailed() {
        server.route("/secret") { request ->
            if (request.headers["authorization"] == "Basic YWRhOmxvdmVsYWNl") {
                TestServer.Response(body = "<title>Inside</title>")
            } else {
                TestServer.Response(401, "<title>No</title>", headers = mapOf("WWW-Authenticate" to "Basic realm=\"Staff\""))
            }
        }
        val page = harness.open("tab", "/secret")
        val first = awaitRequest(page) { it is PageRequest.Kind.HttpAuthentication }
        val kind = first.kind as PageRequest.Kind.HttpAuthentication
        assertEquals("Staff", kind.realm)
        assertFalse(kind.isSecure)
        assertFalse(kind.failedBefore)
        assertEquals("Your password will be sent unencrypted.", first.message(context))
        first.answer(PageRequest.Answer.Credential("ada", "wrong"))
        val retry = awaitRequest(page) { it is PageRequest.Kind.HttpAuthentication && it.failedBefore }
        assertEquals("The user name or password you entered isn’t correct. Try again.", retry.message(context))
        retry.answer(PageRequest.Answer.Credential("ada", "lovelace"))
        harness.awaitTitle(page, "Inside")
    }

    @Test
    fun aNewRequestDismissesTheOldOne() {
        server.page("/blank", "<title>Blank</title>")
        val page = harness.open("tab", "/blank")
        harness.awaitTitle(page, "Blank")
        val answers = ArrayList<PageRequest.Answer>()
        val pageImpl = page as WebViewPage
        val first = onMain { pageImpl.ask(PageRequest.Kind.Alert("one"), "a") { answers += it } }
        val second = onMain { pageImpl.ask(PageRequest.Kind.Alert("two"), "a") { answers += it } }
        assertTrue(first.isAnswered)
        assertFalse(second.isAnswered)
        assertTrue(page.request.value === second)
        onMain { second.answer(PageRequest.Answer.Accepted) }
        second.answer(PageRequest.Answer.Dismissed)
        assertEquals(listOf(PageRequest.Answer.Dismissed, PageRequest.Answer.Accepted), answers)
    }

    @Test
    fun signInCopyMatchesTheIphone() {
        fun signIn(realm: String?, failedBefore: Boolean = false, isSecure: Boolean) =
            PageRequest(PageRequest.Kind.HttpAuthentication(realm, false, failedBefore, isSecure), "intranet.example") {}
        assertEquals("Your password will be sent unencrypted.", signIn("Staff", isSecure = false).message(context))
        assertEquals("Your password will be sent unencrypted.", signIn(null, isSecure = false).message(context))
        assertEquals("Your login information will be sent securely to “Staff”.", signIn("Staff", isSecure = true).message(context))
        assertNull(signIn(null, isSecure = true).message(context))
        for (isSecure in listOf(true, false)) {
            assertEquals("The user name or password you entered isn’t correct. Try again.", signIn("Staff", true, isSecure).message(context))
        }
        assertEquals("Sign In to “intranet.example”", signIn(null, isSecure = true).title(context))
    }
}
