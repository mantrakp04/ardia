package com.ardia.browser.android

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartupTimingTest {
    @Test
    fun timeToFirstFrameIsMeasuredAndLogged() {
        AppTest.freshModel()
        AppTest.shell("logcat -c")
        val before = AppTest.onMain { StartupTiming.lastFirstFrame }
        val scenario = AppTest.launch(demo = true)
        AppTest.waitUntil("the first frame") { StartupTiming.lastFirstFrame.let { it != null && it !== before } }
        val frame = AppTest.onMain { StartupTiming.lastFirstFrame }!!
        Log.i(StartupTiming.TAG, "baseline: first frame ${frame.sinceActivityCreatedMillis} ms after activity created")
        assertTrue("first frame took ${frame.sinceActivityCreatedMillis} ms", frame.sinceActivityCreatedMillis in 1 until FIRST_FRAME_BUDGET_MILLIS)
        val log = AppTest.shell("logcat -d -s ${StartupTiming.TAG}:I")
        assertTrue("the ArdiaTiming log has no first frame line:\n$log", log.contains("first frame"))
        scenario.close()
        AppTest.freshModel()
    }

    companion object {
        const val FIRST_FRAME_BUDGET_MILLIS = 5_000L
    }
}
