package com.ardia.phone

import android.content.Context
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import com.ardia.settings.CameraAccessCheck
import com.ardia.settings.QrCameraSession
import com.ardia.settings.QrFrameAnalyzer
import com.ardia.settings.SyncCodeJudge
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class ScanView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    private val onCode by EventDispatcher()
    private val onRejected by EventDispatcher()
    private val onError by EventDispatcher()

    private val preview = PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    private val judge = SyncCodeJudge()
    private var session: QrCameraSession? = null
    private var analyzer: QrFrameAnalyzer? = null
    private var reported: String? = null

    var isActive: Boolean = true
        set(value) {
            field = value
            update()
        }

    init {
        addView(preview, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    fun update() {
        if (isActive && isAttachedToWindow) start() else stop()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        update()
    }

    override fun onDetachedFromWindow() {
        stop()
        super.onDetachedFromWindow()
    }

    private fun start() {
        if (session != null) return
        val problem = when {
            !CameraAccessCheck.hasCamera(context) -> "unsupported"
            !CameraAccessCheck.isGranted(context) -> "permission"
            appContext.currentActivity !is LifecycleOwner -> "camera"
            else -> null
        }
        if (problem != null) {
            fail(problem)
            return
        }
        reported = null
        val owner = appContext.currentActivity as LifecycleOwner
        val frames = QrFrameAnalyzer { payload ->
            val event = ScanPayloads.event(judge.judge(payload)) ?: return@QrFrameAnalyzer
            when (event.name) {
                "onCode" -> onCode(event.body)
                else -> onRejected(event.body)
            }
        }
        analyzer = frames
        session = QrCameraSession(context, owner, preview, frames) { fail("camera") }.also { it.start() }
    }

    private fun stop() {
        session?.close()
        session = null
        analyzer?.close()
        analyzer = null
    }

    private fun fail(code: String) {
        if (reported == code) return
        reported = code
        onError(mapOf("code" to code))
    }

    private val layOutAgain = Runnable { layOutChildren() }

    private fun layOutChildren() {
        if (width == 0 || height == 0) return
        preview.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        preview.layout(0, 0, width, height)
    }

    override fun requestLayout() {
        super.requestLayout()
        @Suppress("SENSELESS_COMPARISON")
        if (layOutAgain != null) post(layOutAgain)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        preview.layout(0, 0, r - l, b - t)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        preview.measure(MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY))
    }
}
