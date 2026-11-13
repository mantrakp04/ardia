package com.ardia.phone

import android.app.Activity
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.ardia.browser.FullscreenVideo

class FullscreenHost {
    private var shown: FullscreenVideo? = null
    private var frame: FrameLayout? = null
    private var activity: Activity? = null

    val isShowing: Boolean get() = shown != null

    fun show(activity: Activity?, video: FullscreenVideo) {
        if (shown === video) return
        hide()
        activity ?: return
        val decor = activity.window.decorView as? ViewGroup ?: return
        val holder = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        (video.view.parent as? ViewGroup)?.removeView(video.view)
        holder.addView(video.view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        decor.addView(holder, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        bars(activity, holder).run {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
        shown = video
        frame = holder
        this.activity = activity
    }

    fun hide() {
        val holder = frame
        val activity = activity
        shown = null
        frame = null
        this.activity = null
        holder ?: return
        holder.removeAllViews()
        (holder.parent as? ViewGroup)?.removeView(holder)
        activity?.let { bars(it, it.window.decorView).show(WindowInsetsCompat.Type.systemBars()) }
    }

    fun owns(video: FullscreenVideo?): Boolean = video != null && shown === video

    private fun bars(activity: Activity, view: View) = WindowCompat.getInsetsController(activity.window, view)
}
