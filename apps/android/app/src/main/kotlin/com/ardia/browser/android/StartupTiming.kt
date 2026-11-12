package com.ardia.browser.android

import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

data class FirstFrame(val sinceProcessStartMillis: Long, val sinceActivityCreatedMillis: Long, val coldStart: Boolean)

object StartupTiming {
    const val TAG = "ArdiaTiming"

    private var applicationCreatedAt = 0L
    private var hadFrame = false

    var lastFirstFrame: FirstFrame? by mutableStateOf(null)
        private set

    fun applicationCreated() {
        applicationCreatedAt = SystemClock.uptimeMillis()
        Log.i(TAG, "application created ${applicationCreatedAt - Process.getStartUptimeMillis()} ms after process start")
    }

    fun watchFirstFrame(root: View, activityCreatedAt: Long) {
        val coldStart = !hadFrame
        val listener = object : ViewTreeObserver.OnDrawListener {
            private var reported = false

            override fun onDraw() {
                if (reported) return
                reported = true
                val now = SystemClock.uptimeMillis()
                root.post { root.viewTreeObserver.takeIf { it.isAlive }?.removeOnDrawListener(this) }
                record(FirstFrame(now - Process.getStartUptimeMillis(), now - activityCreatedAt, coldStart))
            }
        }
        root.viewTreeObserver.addOnDrawListener(listener)
    }

    fun storeReady(activityCreatedAt: Long) {
        Log.i(TAG, "store ready ${SystemClock.uptimeMillis() - activityCreatedAt} ms after activity created")
    }

    private fun record(frame: FirstFrame) {
        hadFrame = true
        lastFirstFrame = frame
        val start = if (frame.coldStart) "cold" else "warm"
        Log.i(TAG, "first frame ($start) ${frame.sinceActivityCreatedMillis} ms after activity created, ${frame.sinceProcessStartMillis} ms after process start")
    }
}
