package com.ardia.design

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.RenderEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.GlobalPositionAwareModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.node.requireGraphicsContext
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.ceil

object LookFrosting {
    fun bar(look: ProfileLook): FrostedStyle = tinted(FrostedStyle.bar, look.surface)

    fun sheet(look: ProfileLook): FrostedStyle = tinted(FrostedStyle.sheet, look.surface)

    fun tinted(style: FrostedStyle, surface: AdaptiveColor, share: Float = BrowseLayout.sheetTintShare): FrostedStyle = style.copy(
        tint = AdaptiveColor(surface.light.copy(alpha = share), surface.dark.copy(alpha = share)),
        fallback = surface,
    )
}

@Immutable
data class FrostedStyle(
    val blurRadius: Dp,
    val saturation: Float,
    val tint: AdaptiveColor,
    val fallback: AdaptiveColor,
    val edge: AdaptiveColor? = null,
    val edgeWidth: Dp = 0.5.dp,
) {
    companion object {
        val bar = FrostedStyle(
            blurRadius = 24.dp,
            saturation = 1.8f,
            tint = adaptive(ardiaColor(0xFFFFFF, 0.3f), ardiaColor(0x1C1C1E, 0.38f)),
            fallback = adaptive(ardiaColor(0xF7F7F9, 0.94f), ardiaColor(0x1C1C1E, 0.94f)),
        )
        val sheet = FrostedStyle(
            blurRadius = 30.dp,
            saturation = 1.8f,
            tint = adaptive(ardiaColor(0xFFFFFF, 0.62f), ardiaColor(0x1C1C1E, 0.64f)),
            fallback = adaptive(ardiaColor(0xF2F2F7, 0.97f), ardiaColor(0x1C1C1E, 0.97f)),
        )
        val glass = FrostedStyle(
            blurRadius = 12.dp,
            saturation = 1.5f,
            tint = adaptive(ardiaColor(0xFFFFFF, 0.45f), ardiaColor(0xFFFFFF, 0.1f)),
            fallback = adaptive(ardiaColor(0xFFFFFF, 0.82f), ardiaColor(0x3A3A3C, 0.82f)),
            edge = adaptive(Color.Black.copy(alpha = 0.06f), Color.White.copy(alpha = 0.1f)),
        )
        val thin = FrostedStyle(
            blurRadius = 20.dp,
            saturation = 1.6f,
            tint = adaptive(ardiaColor(0xFFFFFF, 0.18f), ardiaColor(0x000000, 0.22f)),
            fallback = adaptive(ardiaColor(0xF2F2F7, 0.9f), ardiaColor(0x1C1C1E, 0.9f)),
        )
    }
}

object Frosting {
    val isBlurSupported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
}

@Stable
class FrostedBackdrop internal constructor(internal val layer: GraphicsLayer?) {
    internal var positionInRoot: Offset by mutableStateOf(Offset.Zero)
    internal var size: IntSize by mutableStateOf(IntSize.Zero)

    val isLive: Boolean get() = layer != null
}

@Composable
fun rememberFrostedBackdrop(): FrostedBackdrop {
    if (!Frosting.isBlurSupported) return remember { FrostedBackdrop(null) }
    val layer = rememberGraphicsLayer()
    return remember(layer) { FrostedBackdrop(layer) }
}

fun Modifier.frostedBackdropSource(backdrop: FrostedBackdrop): Modifier {
    val layer = backdrop.layer ?: return this
    return onGloballyPositioned { coordinates ->
        backdrop.positionInRoot = coordinates.positionInRoot()
        backdrop.size = coordinates.size
    }.drawWithContent {
        layer.record { this@drawWithContent.drawContent() }
        drawLayer(layer)
    }
}

fun Modifier.frosted(backdrop: FrostedBackdrop?, shape: Shape = RectangleShape, style: FrostedStyle = FrostedStyle.bar): Modifier =
    this then FrostedElement(backdrop, shape, style)

@Composable
fun FrostedSurface(
    backdrop: FrostedBackdrop?,
    modifier: Modifier = Modifier,
    shape: Shape = RectangleShape,
    style: FrostedStyle = FrostedStyle.bar,
    contentAlignment: Alignment = Alignment.TopStart,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier.frosted(backdrop, shape, style), contentAlignment = contentAlignment, content = content)
}

private data class FrostedElement(val backdrop: FrostedBackdrop?, val shape: Shape, val style: FrostedStyle) : ModifierNodeElement<FrostedNode>() {
    override fun create(): FrostedNode = FrostedNode(backdrop, shape, style)

    override fun update(node: FrostedNode) {
        node.backdrop = backdrop
        node.shape = shape
        node.style = style
        node.invalidateDraw()
    }

    override fun InspectorInfo.inspectableProperties() {
        name = "frosted"
        properties["shape"] = shape
        properties["style"] = style
    }
}

private class FrostedNode(var backdrop: FrostedBackdrop?, var shape: Shape, var style: FrostedStyle) :
    Modifier.Node(),
    DrawModifierNode,
    GlobalPositionAwareModifierNode,
    CompositionLocalConsumerModifierNode {

    private var positionInRoot: Offset by mutableStateOf(Offset.Zero)
    private var blurLayer: GraphicsLayer? = null
    private var effectRadius = -1f
    private var effectSaturation = -1f
    private var cachedSize = Size.Unspecified
    private var cachedDirection: LayoutDirection? = null
    private var cachedShape: Shape? = null
    private var cachedOutline: Outline? = null
    private var cachedPath: Path? = null

    override val shouldAutoInvalidate: Boolean get() = false

    override fun onAttach() {
        if (Frosting.isBlurSupported) blurLayer = requireGraphicsContext().createGraphicsLayer()
    }

    override fun onDetach() {
        blurLayer?.let { requireGraphicsContext().releaseGraphicsLayer(it) }
        blurLayer = null
        effectRadius = -1f
    }

    override fun onGloballyPositioned(coordinates: LayoutCoordinates) {
        positionInRoot = coordinates.positionInRoot()
    }

    override fun ContentDrawScope.draw() {
        val dark = currentValueOf(LocalArdiaDarkTheme)
        val reduceTransparency = currentValueOf(LocalReduceTransparency)
        val outline = outline(this)
        val source = backdrop?.layer
        val blur = blurLayer
        val sourceSize = backdrop?.size ?: IntSize.Zero
        if (source != null && blur != null && !reduceTransparency && sourceSize != IntSize.Zero && Frosting.isBlurSupported) {
            val radius = style.blurRadius.toPx()
            applyEffect(blur, radius, style.saturation)
            val margin = ceil(radius * 2)
            val offset = (backdrop?.positionInRoot ?: Offset.Zero) - positionInRoot
            blur.record(IntSize(ceil(size.width + margin * 2).toInt(), ceil(size.height + margin * 2).toInt())) {
                translate(offset.x + margin, offset.y + margin) { drawLayer(source) }
            }
            clipTo(outline) { translate(-margin, -margin) { drawLayer(blur) } }
            drawOutline(outline, style.tint.resolve(dark))
        } else {
            drawOutline(outline, style.fallback.resolve(dark))
        }
        style.edge?.let { drawOutline(outline, it.resolve(dark), style = Stroke(width = style.edgeWidth.toPx())) }
        drawContent()
    }

    private fun applyEffect(layer: GraphicsLayer, radius: Float, saturation: Float) {
        if (radius == effectRadius && saturation == effectSaturation) return
        effectRadius = radius
        effectSaturation = saturation
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) layer.renderEffect = frostedEffect(radius, saturation)
    }

    private fun outline(scope: DrawScope): Outline {
        val existing = cachedOutline
        if (existing != null && cachedSize == scope.size && cachedDirection == scope.layoutDirection && cachedShape == shape) return existing
        val created = shape.createOutline(scope.size, scope.layoutDirection, scope)
        cachedOutline = created
        cachedSize = scope.size
        cachedDirection = scope.layoutDirection
        cachedShape = shape
        cachedPath = when (created) {
            is Outline.Rectangle -> null
            is Outline.Rounded -> Path().apply { addRoundRect(created.roundRect) }
            is Outline.Generic -> created.path
        }
        return created
    }

    private inline fun DrawScope.clipTo(outline: Outline, block: DrawScope.() -> Unit) {
        val path = cachedPath
        if (outline is Outline.Rectangle || path == null) {
            val rect = outline.bounds
            clipRect(rect.left, rect.top, rect.right, rect.bottom, block = block)
        } else {
            clipPath(path, block = block)
        }
    }
}

@RequiresApi(Build.VERSION_CODES.S)
private fun frostedEffect(radius: Float, saturation: Float): RenderEffect {
    val blur = android.graphics.RenderEffect.createBlurEffect(radius, radius, android.graphics.Shader.TileMode.CLAMP)
    if (saturation == 1f) return blur.asComposeRenderEffect()
    val matrix = ColorMatrix().apply { setSaturation(saturation) }
    val saturate = android.graphics.RenderEffect.createColorFilterEffect(ColorMatrixColorFilter(matrix))
    return android.graphics.RenderEffect.createChainEffect(saturate, blur).asComposeRenderEffect()
}
