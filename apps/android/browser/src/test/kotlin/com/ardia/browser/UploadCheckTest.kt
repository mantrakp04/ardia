package com.ardia.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadCheckTest {
    private val own = setOf("com.ardia.browser.android.browsing.captures", "com.ardia.browser.android.androidx-startup", "com.ardia.browser.android.files")
    private val capture = UploadLocation("com.ardia.browser.android.browsing.captures", "/captures/")

    private fun accepts(uri: String) = UploadCheck.accepts(uri, own, capture)

    @Test
    fun picksFromOtherAppsAreAccepted() {
        assertTrue(accepts("content://com.android.providers.media.documents/document/image%3A1000"))
        assertTrue(accepts("content://media/external/images/media/12"))
        assertTrue(accepts("content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3D2"))
    }

    @Test
    fun theCaptureFolderIsTheOnlyOwnPathAllowed() {
        assertTrue(accepts("content://com.ardia.browser.android.browsing.captures/captures/photo-1.jpg"))
        assertFalse(accepts("content://com.ardia.browser.android.browsing.captures/captures/"))
        assertFalse(accepts("content://com.ardia.browser.android.browsing.captures/other/photo.jpg"))
        assertFalse(accepts("content://com.ardia.browser.android.browsing.captures/captures/../databases/browser.db"))
        assertFalse(accepts("content://com.ardia.browser.android.browsing.captures/captures/%2E%2E/databases/browser.db"))
        assertFalse(accepts("content://com.ardia.browser.android.files/browser.db"))
        assertFalse(accepts("content://COM.ARDIA.BROWSER.ANDROID.FILES/browser.db"))
    }

    @Test
    fun ownProvidersCannotBeReachedThroughAUserPrefix() {
        assertFalse(accepts("content://0@com.ardia.browser.android.files/browser.db"))
        assertFalse(accepts("content://evil@media/external/images/media/1"))
        assertTrue(accepts("content://10@media/external/images/media/1"))
    }

    @Test
    fun anythingButContentIsRejected() {
        assertFalse(accepts("file:///data/user/0/com.ardia.browser.android/databases/browser.db"))
        assertFalse(accepts("FILE:///sdcard/a.jpg"))
        assertFalse(accepts("CONTENT://media/external/images/media/1"))
        assertFalse(accepts("https://example.com/a.jpg"))
        assertFalse(accepts("android.resource://com.ardia.browser.android/raw/a"))
        assertFalse(accepts("content://"))
        assertFalse(accepts("content://media:80/external/images/media/1"))
        assertFalse(accepts("content://media/external/%ZZ"))
        assertFalse(accepts("content://media/external\\..\\x"))
    }

    @Test
    fun withoutACaptureLocationNoOwnUriPasses() {
        assertFalse(UploadCheck.accepts("content://com.ardia.browser.android.browsing.captures/captures/a.jpg", own, null))
        assertTrue(UploadCheck.accepts("content://media/external/images/media/1", own, null))
    }
}
