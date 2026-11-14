package com.ardia.phone

import android.app.Activity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PhoneA11yDumpTest {
    @Test
    fun onlyWhatAScreenReaderWouldReachIsListed() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val root = FrameLayout(activity)
        val behind = FrameLayout(activity).apply {
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            addView(Button(activity).apply { text = "Behind the tray" })
        }
        val cover = FrameLayout(activity).apply {
            addView(TextView(activity).apply { text = "Search or enter address" })
            addView(Button(activity).apply { contentDescription = "Close tray" })
            addView(Button(activity).apply { text = "Gone button"; visibility = View.GONE })
            addView(TextView(activity).apply { text = "Not important"; importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO })
        }
        root.addView(behind)
        root.addView(cover)
        activity.setContentView(root)
        root.measure(View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(2000, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, 1080, 2000)
        val lines = PhoneA11yDump.lines(activity.window.decorView) { view, _ -> view.isShown }
        val text = lines.joinToString("\n")
        assertTrue(text, text.contains("Search or enter address"))
        assertTrue(text, text.contains("Close tray"))
        assertFalse(text, text.contains("Behind the tray"))
        assertFalse(text, text.contains("Gone button"))
        assertFalse(text, text.contains("Not important"))
        assertTrue(lines.all { it.startsWith("PAGELAB a11y ") })
    }
}
