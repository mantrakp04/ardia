package com.ardia.browsing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PickedFileRuleTest {
    private val packageName = "com.ardia.browser.android"
    private val own = setOf("$packageName.browsing.captures", "androidx.startup")
    private val capture = "content://$packageName.browsing.captures/captures/abc.jpg"

    private fun file(uri: String, granted: Boolean = true): PickedFile {
        val scheme = uri.substringBefore(':', "").ifEmpty { null }
        val authority = uri.substringAfter("://", "").substringBefore('/').ifEmpty { null }
        return PickedFile(uri, scheme, authority, granted)
    }

    private fun accepts(uri: String, granted: Boolean = true, captureUri: String? = null) =
        PickedFileRule.accepts(file(uri, granted), own, packageName, captureUri)

    @Test
    fun aGrantedContentUriFromTheSystemPickerPasses() {
        assertTrue(accepts("content://com.android.providers.media.documents/document/image%3A12"))
        assertTrue(accepts("content://media/picker/0/com.android.providers.media.photopicker/media/1000"))
    }

    @Test
    fun fileUrisAndOtherSchemesAreRefusedEvenWhenTheyPointAtOurData() {
        assertFalse(accepts("file:///data/user/0/$packageName/databases/browser.db"))
        assertFalse(accepts("FILE:///sdcard/Download/a.pdf"))
        assertFalse(accepts("https://example.com/a.pdf"))
        assertFalse(accepts("android.resource://$packageName/raw/x"))
        assertFalse(accepts("content:///no-authority"))
    }

    @Test
    fun aContentUriWeWereNotGrantedIsRefused() {
        assertFalse(accepts("content://com.hostile.app.files/stolen", granted = false))
    }

    @Test
    fun ourOwnProvidersAreRefusedUnlessItIsThisRequestsCaptureFile() {
        assertTrue(accepts(capture, granted = false, captureUri = capture))
        assertFalse(accepts(capture, captureUri = null))
        assertFalse(accepts("content://$packageName.browsing.captures/captures/other.jpg", captureUri = capture))
        assertFalse(accepts("content://$packageName.browsing.captures/captures/../../databases/browser.db", captureUri = capture))
        assertFalse(accepts("content://androidx.startup/anything"))
        assertFalse(accepts("content://$packageName.someprovider/data"))
        assertFalse(accepts("content://${packageName.uppercase()}/data"))
    }

    @Test
    fun onlyThePassingFilesAreKeptAndNoneLeavesAnEmptyAnswer() {
        val picked = listOf(
            file("content://com.android.externalstorage.documents/document/primary%3Aa.pdf"),
            file("file:///data/user/0/$packageName/databases/browser.db"),
            file("content://$packageName.browsing.captures/captures/old.jpg"),
        )
        assertEquals(listOf(picked[0]), PickedFileRule.filter(picked, own, packageName, captureUri = null))
        assertTrue(PickedFileRule.filter(picked.drop(1), own, packageName, captureUri = null).isEmpty())
    }

    @Test
    fun imageAndVideoOnlyInputsUseThePhotoPickerAndOthersTheDocumentPicker() {
        assertEquals(VisualMedia.Images, PickerChoice.visualMedia(arrayOf("image/*")))
        assertEquals(VisualMedia.ImagesAndVideos, PickerChoice.visualMedia(arrayOf("image/png", "video/mp4")))
        assertEquals(VisualMedia.Videos, PickerChoice.visualMedia(arrayOf("video/*")))
        assertNull(PickerChoice.visualMedia(arrayOf("*/*")))
        assertNull(PickerChoice.visualMedia(arrayOf("image/*", "application/pdf")))
    }
}
