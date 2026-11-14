package com.ardia.phone

import com.ardia.browser.PageRequest
import com.ardia.browser.SitePermission
import com.ardia.browser.VisitKind
import expo.modules.kotlin.exception.CodedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PagePayloadsTest {
    @Test
    fun answersParseIntoPageAnswers() {
        assertEquals(PagePayloads.Answer.Page(PageRequest.Answer.Dismissed), PagePayloads.answer("dismiss", null, null, null, null))
        assertEquals(PagePayloads.Answer.Page(PageRequest.Answer.Accepted), PagePayloads.answer("accept", null, null, null, null))
        assertEquals(PagePayloads.Answer.Page(PageRequest.Answer.Text("hi")), PagePayloads.answer("text", "hi", null, null, null))
        assertEquals(
            PagePayloads.Answer.Page(PageRequest.Answer.Credential("ada", "secret")),
            PagePayloads.answer("credential", null, "ada", "secret", null),
        )
        assertSame(PagePayloads.Answer.PickFiles, PagePayloads.answer("pickFiles", null, null, null, null))
    }

    @Test
    fun incompleteAnswersAreBadArguments() {
        listOf(
            { PagePayloads.answer("text", null, null, null, null) },
            { PagePayloads.answer("credential", null, "ada", null, null) },
            { PagePayloads.answer("files", null, null, null, null) },
            { PagePayloads.answer("maybe", null, null, null, null) },
        ).forEach { call ->
            val error = assertThrows(CodedException::class.java) { call() }
            assertEquals("ERR_BAD_ARGS", error.code)
        }
    }

    @Test
    fun namesMatchTheTypeScriptUnions() {
        assertEquals(listOf("typed", "link", "backForward", "restored", "redirect", "sameDocument"), VisitKind.entries.map(PagePayloads::visitKind))
        assertEquals(listOf("camera", "microphone", "cameraAndMicrophone", "location"), SitePermission.entries.map(PagePayloads::permission))
        assertEquals(2, PagePayloads.androidPermissions(SitePermission.CameraAndMicrophone).size)
    }

    @Test
    fun snapshotFileStemsAreSafeAndStable() {
        assertEquals("tab_42", PageSnapshots.fileStem("tab_42"))
        val odd = PageSnapshots.fileStem("../tab one/ä")
        assertTrue(odd.matches(Regex("[0-9a-f]{32}")))
        assertEquals(odd, PageSnapshots.fileStem("../tab one/ä"))
        assertNotEquals(odd, PageSnapshots.fileStem("../tab two/ä"))
    }

    @Test
    fun siteKeysDropSchemeAndWww() {
        assertEquals("example.com", PhoneSitePreferences.siteKey("https://www.Example.com/path"))
        assertEquals("example.com", PhoneSitePreferences.siteKey("www.example.com"))
        assertEquals("news.example.com", PhoneSitePreferences.siteKey("news.example.com."))
    }

    @Test
    fun aFileRequestSaysWhetherToOfferTakePhotoAndRecordVideo() {
        val images = PagePayloads.fileChooser(PageRequest.Kind.FileChooser(listOf("image/*"), allowsMultiple = false, prefersCapture = false))
        assertEquals(true, images["offersPhoto"])
        assertEquals(false, images["offersVideo"])
        assertEquals(false, images["capturesDirectly"])
        val anything = PagePayloads.fileChooser(PageRequest.Kind.FileChooser(emptyList(), allowsMultiple = true, prefersCapture = false))
        assertEquals(true, anything["offersPhoto"])
        assertEquals(true, anything["offersVideo"])
        val pdf = PagePayloads.fileChooser(PageRequest.Kind.FileChooser(listOf(".pdf"), allowsMultiple = false, prefersCapture = true))
        assertEquals(false, pdf["offersPhoto"])
        assertEquals(false, pdf["capturesDirectly"])
        val capture = PagePayloads.fileChooser(PageRequest.Kind.FileChooser(listOf("video/*"), allowsMultiple = false, prefersCapture = true))
        assertEquals(true, capture["capturesDirectly"])
        assertEquals(listOf("video/*"), capture["acceptTypes"])
        assertEquals(PagePayloads.Answer.Capture(photo = true), PagePayloads.answer("takePhoto", null, null, null, null))
        assertEquals(PagePayloads.Answer.Capture(photo = false), PagePayloads.answer("recordVideo", null, null, null, null))
    }
}
