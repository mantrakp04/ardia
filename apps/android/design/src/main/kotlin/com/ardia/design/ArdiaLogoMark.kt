package com.ardia.design

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.min

object LogoGeometry {
    val canvas = Rect(26f, 186f, 26f + 972f, 186f + 772f)
    val aspectRatio: Float get() = canvas.width / canvas.height

    class LogoShape(val path: Path, val top: Color, val bottom: Color) {
        val bounds: Rect = path.getBounds()
        val brush: Brush = Brush.verticalGradient(listOf(top, bottom), startY = bounds.top, endY = bounds.bottom)
    }

    val sun: Path by lazy { Path().apply { addOval(Rect(432f, 192f, 432f + 248f, 192f + 248f)) } }

    val backHill: Path by lazy {
        Path().apply {
            moveTo(66f, 828f)
            cubicTo(22f, 700f, 40f, 520f, 150f, 430f)
            cubicTo(210f, 375f, 300f, 352f, 372f, 388f)
            cubicTo(460f, 425f, 530f, 486f, 610f, 548f)
            lineTo(640f, 780f)
            lineTo(300f, 820f)
            close()
        }
    }

    val frontHill: Path by lazy {
        Path().apply {
            moveTo(68f, 834f)
            cubicTo(250f, 700f, 500f, 556f, 690f, 466f)
            cubicTo(770f, 432f, 868f, 424f, 935f, 482f)
            cubicTo(1004f, 545f, 1000f, 705f, 978f, 820f)
            cubicTo(962f, 902f, 922f, 952f, 842f, 952f)
            lineTo(204f, 952f)
            cubicTo(124f, 950f, 70f, 904f, 68f, 834f)
            close()
        }
    }

    val shapes: List<LogoShape> by lazy {
        listOf(
            LogoShape(sun, ardiaColor(0xFFCB45), ardiaColor(0xF5A812)),
            LogoShape(backHill, ardiaColor(0x8DAF63), ardiaColor(0x5E7D3E)),
            LogoShape(frontHill, ardiaColor(0x17604B), ardiaColor(0x063528)),
        )
    }

    internal fun fit(size: Size, inset: Float): Pair<Float, Offset> {
        val scale = min((size.width - inset * 2) / canvas.width, (size.height - inset * 2) / canvas.height)
        return scale to Offset(inset - canvas.left * scale, inset - canvas.top * scale)
    }

    internal val silhouette = GenericShape { size, _ ->
        val (scale, origin) = fit(size, 1f)
        for (shape in listOf(sun, backHill, frontHill)) {
            val copy = Path().apply { addPath(shape) }
            copy.asAndroidPath().transform(android.graphics.Matrix().apply {
                setScale(scale, scale)
                postTranslate(origin.x, origin.y)
            })
            addPath(copy)
        }
    }
}

@Composable
fun ArdiaLogoMark(modifier: Modifier = Modifier, outline: Boolean = true, outlineWeight: Float = 0.075f) {
    Canvas(modifier.aspectRatio(LogoGeometry.aspectRatio).clearAndSetSemantics {}) { drawLogo(outline, outlineWeight) }
}

internal fun DrawScope.drawLogo(outline: Boolean, outlineWeight: Float) {
    val strokeWidth = if (outline) size.width * outlineWeight else 0f
    val inset = strokeWidth / 2 + 1.dp.toPx()
    val (scale, origin) = LogoGeometry.fit(size, inset)
    translate(origin.x, origin.y) {
        scale(scale, scale, pivot = Offset.Zero) {
            if (outline) {
                val stroke = Stroke(width = strokeWidth / scale, cap = StrokeCap.Round, join = StrokeJoin.Round)
                for (shape in LogoGeometry.shapes) {
                    drawPath(shape.path, Color.White, style = stroke)
                    drawPath(shape.path, Color.White)
                }
            }
            for (shape in LogoGeometry.shapes) drawPath(shape.path, shape.brush)
        }
    }
}

@Composable
fun FidgetLogo(modifier: Modifier = Modifier, contentDescription: String = "Ardia") {
    val reduceMotion = LocalReduceMotion.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val angle = remember { Animatable(0f) }
    Box(
        modifier
            .semantics {
                this.contentDescription = contentDescription
                role = Role.Image
            }
            .pointerInput(reduceMotion) {
                var dragStart = 0f
                var startBearing = 0f
                var lastAngle = 0f
                var lastTime = 0L
                var velocity = 0f
                detectDragGestures(
                    onDragStart = { position ->
                        scope.launch { angle.stop() }
                        dragStart = angle.value
                        startBearing = bearing(position, Offset(size.width / 2f, size.height / 2f))
                        lastAngle = dragStart
                        lastTime = 0L
                        velocity = 0f
                    },
                    onDrag = { change, _ ->
                        val now = bearing(change.position, Offset(size.width / 2f, size.height / 2f))
                        var delta = now - startBearing
                        if (delta > 180f) delta -= 360f
                        if (delta < -180f) delta += 360f
                        val target = dragStart + delta
                        val time = change.uptimeMillis
                        if (lastTime != 0L) {
                            val elapsed = (time - lastTime) / 1000f
                            if (elapsed > 0.004f) velocity = (target - lastAngle) / elapsed
                        }
                        lastAngle = target
                        lastTime = time
                        scope.launch { angle.snapTo(target) }
                        change.consume()
                    },
                    onDragEnd = {
                        val clamped = velocity.coerceIn(-2400f, 2400f)
                        velocity = 0f
                        if (abs(clamped) <= 60f) return@detectDragGestures
                        if (reduceMotion) {
                            scope.launch { angle.animateTo(0f, Motion.logoReset.spec()) }
                            return@detectDragGestures
                        }
                        val travel = clamped * 0.42f
                        if (abs(travel) >= 360f) haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
                        scope.launch { angle.animateTo(angle.value + travel, Motion.logoSpin.spec()) }
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { rotationZ = angle.value },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(
                Modifier
                    .aspectRatio(LogoGeometry.aspectRatio)
                    .dropShadow(LogoGeometry.silhouette, Shadow(radius = 14.dp, color = Color.Black.copy(alpha = 0.22f), offset = DpOffset(0.dp, 6.dp))),
            ) { drawLogo(outline = true, outlineWeight = 0.05f) }
        }
    }
}

private fun bearing(point: Offset, center: Offset): Float =
    (atan2(point.y - center.y, point.x - center.x) * 180.0 / PI).toFloat()
