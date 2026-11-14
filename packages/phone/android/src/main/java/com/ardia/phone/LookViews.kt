package com.ardia.phone

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.BlendMode
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewTreeObserver
import androidx.compose.ui.graphics.toArgb
import com.ardia.design.DeckBackdropStyle
import com.ardia.design.DeckMesh
import com.ardia.design.Frosting
import com.ardia.design.GrainTexture
import com.ardia.design.ProfileBackdropStyle
import com.ardia.design.ProfileLook
import com.ardia.design.TabsBackdropMotion
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import kotlin.math.PI
import kotlin.math.ceil

internal object LookPaint {
    private val grainBitmap: Bitmap by lazy {
        val pixels = GrainTexture.values().map { value -> (0xFF shl 24) or (value shl 16) or (value shl 8) or value }.toIntArray()
        Bitmap.createBitmap(pixels, GrainTexture.SIDE, GrainTexture.SIDE, Bitmap.Config.ARGB_8888)
    }

    private val meshes = object : LinkedHashMap<Pair<ProfileLook, Boolean>, Bitmap>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Pair<ProfileLook, Boolean>, Bitmap>?): Boolean = size > 12
    }

    fun grain(density: Float, opacity: Float): Paint = Paint().apply {
        shader = BitmapShader(grainBitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT).apply {
            setLocalMatrix(Matrix().apply { setScale(density / 2f, density / 2f) })
        }
        blendMode = BlendMode.OVERLAY
        alpha = (opacity.coerceIn(0f, 1f) * 255f).toInt()
    }

    fun mesh(look: ProfileLook, dark: Boolean): Bitmap = synchronized(meshes) {
        meshes.getOrPut(look to dark) { Bitmap.createBitmap(DeckMesh.pixels(look, dark), DeckMesh.WIDTH, DeckMesh.HEIGHT, Bitmap.Config.ARGB_8888) }
    }
}

abstract class LookView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    var color: String? = null
    var themeColors: List<String>? = null
    var darkThemeColors: List<String>? = null
    var dark: Boolean? = null

    protected val density: Float get() = resources.displayMetrics.density

    protected val isDark: Boolean
        get() = dark ?: (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)

    protected val look: ProfileLook get() = LookRules.look(color, themeColors, darkThemeColors)

    protected val lookOrNull: ProfileLook? get() = LookRules.lookOrNull(color, themeColors, darkThemeColors)

    init {
        setWillNotDraw(false)
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    open fun update() = invalidate()
}

class DeckBackdropView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var reduceMotion: Boolean = false
    var reduceTransparency: Boolean = false

    private val meshPaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val blobPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val source = Rect()
    private val target = Rect()

    override fun onDraw(canvas: Canvas) {
        val dark = isDark
        val look = look
        val mesh = LookPaint.mesh(look, dark)
        source.set(0, 0, mesh.width, mesh.height)
        target.set(0, 0, width + 1, height + 1)
        canvas.drawBitmap(mesh, source, target, meshPaint)
        if (reduceTransparency) return
        val w = width.toFloat()
        val h = height.toFloat()
        val radius = LookRules.blobRadius(w, h)
        val animated = !reduceMotion
        val now = SystemClock.uptimeMillis()
        look.deckBlobs(dark).forEachIndexed { index, blob ->
            val angle = if (animated) angle(index, now) else 0f
            val (x, y) = LookRules.blobCenter(index, angle, w, h)
            val argb = blob.toArgb()
            blobPaint.shader = RadialGradient(x, y, radius, intArrayOf(argb, argb and 0x00FFFFFF), null, Shader.TileMode.CLAMP)
            blobPaint.alpha = (DeckBackdropStyle.blobOpacity(dark) * 255f).toInt()
            canvas.drawCircle(x, y, radius, blobPaint)
        }
        canvas.drawRect(0f, 0f, w, h, LookPaint.grain(density, DeckBackdropStyle.grainOpacity(dark)))
        if (animated && isShown) postInvalidateOnAnimation()
    }

    private fun angle(index: Int, now: Long): Float {
        val loop = TabsBackdropMotion.loopsMillis[index]
        val progress = (now % loop).toFloat() / loop
        val full = (2 * PI).toFloat()
        return if (index % 2 == 0) full * progress else full * (1f - progress)
    }
}

class ProfileBackdropView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var themed: Boolean = false
    var softened: Boolean = false

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
        val dark = isDark
        val look = look
        val colors = look.backdropColors(dark, themed).map { it.toArgb() }.toIntArray()
        val w = width.toFloat()
        val h = height.toFloat()
        paint.shader = null
        if (colors.size >= 2) {
            val diagonal = look.showsTheme(dark, themed)
            paint.shader = LinearGradient(0f, 0f, if (diagonal) w else 0f, h, colors, null, Shader.TileMode.CLAMP)
        } else {
            paint.color = colors.firstOrNull() ?: Color.TRANSPARENT
        }
        canvas.drawRect(0f, 0f, w, h, paint)
        if (softened) {
            paint.shader = null
            paint.color = ProfileBackdropStyle.softening.resolve(dark).toArgb()
            canvas.drawRect(0f, 0f, w, h, paint)
        }
        canvas.drawRect(0f, 0f, w, h, LookPaint.grain(density, ProfileBackdropStyle.grainOpacity(dark)))
    }
}

class FilmGrainView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var opacity: Float = ProfileBackdropStyle.LIGHT_GRAIN

    override fun dispatchDraw(canvas: Canvas) {
        super.dispatchDraw(canvas)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), LookPaint.grain(density, opacity))
    }
}

internal object FrostSources {
    private val sources = HashMap<String, WeakReference<FrostSourceView>>()

    fun register(id: String, view: FrostSourceView) = synchronized(sources) { sources[id] = WeakReference(view) }

    fun unregister(id: String, view: FrostSourceView) = synchronized(sources) {
        if (sources[id]?.get() === view) sources.remove(id)
    }

    fun find(id: String?): FrostSourceView? = id?.let { synchronized(sources) { sources[it]?.get() } }
}

class FrostSourceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    internal val node: RenderNode? = RenderNode("ardiaFrostSource")

    var sourceId: String? = null
        set(value) {
            if (field == value) return
            field?.let { FrostSources.unregister(it, this) }
            field = value
            if (isAttachedToWindow) value?.let { FrostSources.register(it, this) }
        }

    internal val hasContent: Boolean get() = node?.hasDisplayList() == true

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        sourceId?.let { FrostSources.register(it, this) }
    }

    override fun onDetachedFromWindow() {
        sourceId?.let { FrostSources.unregister(it, this) }
        super.onDetachedFromWindow()
    }

    override fun dispatchDraw(canvas: Canvas) {
        val recorder = node
        if (recorder == null || !canvas.isHardwareAccelerated || width == 0 || height == 0) {
            super.dispatchDraw(canvas)
            return
        }
        recorder.setPosition(0, 0, width, height)
        val recording = recorder.beginRecording(width, height)
        try {
            super.dispatchDraw(recording)
        } finally {
            recorder.endRecording()
        }
        canvas.drawRenderNode(recorder)
    }
}

class FrostView(context: Context, appContext: AppContext) : LookView(context, appContext) {
    var source: String? = null
    var variant: String? = null
    var cornerRadius: Float = 0f
    var reduceTransparency: Boolean = false

    private val blurNode = RenderNode("ardiaFrost")
    private var effectRadius = -1f
    private var effectSaturation = -1f
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bounds = RectF()
    private val clip = Path()
    private val here = IntArray(2)
    private val there = IntArray(2)
    private var lastOffset = Long.MIN_VALUE

    private val moved = ViewTreeObserver.OnPreDrawListener {
        val from = FrostSources.find(source)
        if (from != null) {
            val offset = offsetTo(from)
            if (offset != lastOffset) invalidate()
        }
        true
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        viewTreeObserver.addOnPreDrawListener(moved)
    }

    override fun onDetachedFromWindow() {
        viewTreeObserver.removeOnPreDrawListener(moved)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val dark = isDark
        val style = LookRules.frost(variant, lookOrNull)
        val radius = cornerRadius * density
        bounds.set(0f, 0f, width.toFloat(), height.toFloat())
        clip.reset()
        clip.addRoundRect(bounds, radius, radius, Path.Direction.CW)
        val from = FrostSources.find(source)
        val blurs = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && Frosting.isBlurSupported && !reduceTransparency &&
            from != null && from.hasContent && canvas.isHardwareAccelerated && !isInside(from)
        if (blurs && from != null) {
            val blur = style.blurRadius.value * density
            applyEffect(blur, style.saturation)
            val margin = ceil(blur * 2)
            val offset = offsetTo(from)
            lastOffset = offset
            val dx = (offset shr 32).toInt()
            val dy = offset.toInt()
            blurNode.setPosition(0, 0, ceil(width + margin * 2).toInt(), ceil(height + margin * 2).toInt())
            val recording = blurNode.beginRecording()
            try {
                recording.translate(dx + margin, dy + margin)
                from.node?.let(recording::drawRenderNode)
            } finally {
                blurNode.endRecording()
            }
            canvas.save()
            canvas.clipPath(clip)
            canvas.translate(-margin, -margin)
            canvas.drawRenderNode(blurNode)
            canvas.restore()
            paint.style = Paint.Style.FILL
            paint.color = style.tint.resolve(dark).toArgb()
            canvas.drawPath(clip, paint)
        } else {
            paint.style = Paint.Style.FILL
            paint.color = style.fallback.resolve(dark).toArgb()
            canvas.drawPath(clip, paint)
        }
        style.edge?.let { edge ->
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = style.edgeWidth.value * density
            paint.color = edge.resolve(dark).toArgb()
            canvas.drawPath(clip, paint)
        }
    }

    private fun applyEffect(radius: Float, saturation: Float) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        if (radius == effectRadius && saturation == effectSaturation) return
        effectRadius = radius
        effectSaturation = saturation
        val blur = RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
        blurNode.setRenderEffect(
            if (saturation == 1f) {
                blur
            } else {
                val matrix = android.graphics.ColorMatrix().apply { setSaturation(saturation) }
                RenderEffect.createChainEffect(RenderEffect.createColorFilterEffect(android.graphics.ColorMatrixColorFilter(matrix)), blur)
            },
        )
    }

    private fun offsetTo(from: View): Long {
        from.getLocationInWindow(there)
        getLocationInWindow(here)
        val dx = there[0] - here[0]
        val dy = there[1] - here[1]
        return (dx.toLong() shl 32) or (dy.toLong() and 0xFFFFFFFFL)
    }

    private fun isInside(from: View): Boolean {
        var current: android.view.ViewParent? = parent
        while (current != null) {
            if (current === from) return true
            current = current.parent
        }
        return false
    }
}
