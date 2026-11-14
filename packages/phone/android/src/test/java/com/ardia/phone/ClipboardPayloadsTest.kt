package com.ardia.phone

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ClipboardPayloadsTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val clipboard = context.getSystemService(ClipboardManager::class.java)

    @Test
    fun aCopiedLinkAndCopiedWordsAreToldApartWithoutReadingTheText() {
        assertNull(ClipboardPayloads.offer(context))
        clipboard.setPrimaryClip(ClipData("link", arrayOf(ClipDescription.MIMETYPE_TEXT_URILIST), ClipData.Item("https://example.com/")))
        assertEquals("link", ClipboardPayloads.offer(context))
        clipboard.setPrimaryClip(ClipData.newPlainText("words", "red pandas"))
        assertEquals("text", ClipboardPayloads.offer(context))
        clipboard.setPrimaryClip(ClipData("image", arrayOf("image/png"), ClipData.Item("x")))
        assertNull(ClipboardPayloads.offer(context))
    }
}
