package com.ardia.browser.android

import android.content.Intent
import android.net.Uri
import com.ardia.browser.android.system.ShortcutActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class ShortcutForwardTest {
    @Test
    fun aShortcutReachesTheRunningAppWithoutClearingItsTask() {
        val context = RuntimeEnvironment.getApplication()
        val launched = Intent(Intent.ACTION_VIEW, Uri.parse("ardia://voice"))
            .putExtra("com.ardia.SOURCE", "shortcut")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        val forwarded = ShortcutActivity.forward(context, launched)
        assertEquals(MainActivity::class.java.name, forwarded.component?.className)
        assertEquals(Intent.ACTION_VIEW, forwarded.action)
        assertEquals("ardia://voice", forwarded.dataString)
        assertEquals("shortcut", forwarded.getStringExtra("com.ardia.SOURCE"))
        assertTrue(forwarded.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(0, forwarded.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }
}
