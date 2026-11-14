package com.ardia.tabs

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToUpIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.ardia.design.DeckHeaderMetrics
import com.ardia.design.TabsDeckGeometry
import kotlin.math.max
import kotlin.math.roundToInt

internal class CardShapeCache {
    private var radius = -1f
    private var shape: Shape = RectangleShape

    fun shape(pixels: Float): Shape {
        if (pixels != radius) {
            radius = pixels
            shape = RoundedCornerShape(pixels)
        }
        return shape
    }
}

internal fun Modifier.deckCardPlacement(
    state: DeckState,
    id: String,
    index: Int,
    isLast: Boolean,
    pose: DeckPose,
    shapes: CardShapeCache,
    shadow: Color,
): Modifier = layout { measurable, _ ->
    val size = state.geometry.cardSize
    val width = (size.width * density).roundToInt().coerceAtLeast(1)
    val height = (size.height * density).roundToInt().coerceAtLeast(1)
    val placeable = measurable.measure(Constraints.fixed(width, height))
    layout(width, height) {
        placeable.placeWithLayer(0, 0) {
            state.cardPose(id, index, isLast, pose)
            val scale = pose.scale.toFloat()
            translationX = pose.centerX.toFloat() * density - width / 2f
            translationY = pose.centerY.toFloat() * density - height / 2f
            scaleX = scale
            scaleY = scale
            alpha = pose.opacity.toFloat() * state.cardsOpacity.value
            shape = shapes.shape(pose.corner.toFloat() * density / max(scale, 0.01f))
            clip = true
            shadowElevation = CARD_SHADOW_ELEVATION.toPx()
            ambientShadowColor = shadow
            spotShadowColor = shadow
        }
    }
}

internal fun Modifier.deckCardEdge(state: DeckState, id: String, index: Int, frame: DeckPose, edge: Color): Modifier = drawWithContent {
    drawContent()
    state.cardFrame(id, index, frame)
    val scale = max(frame.scale.toFloat(), 0.01f)
    val stroke = 0.5.dp.toPx() / scale
    val radius = frame.corner.toFloat() * density / scale
    drawRoundRect(
        color = edge,
        topLeft = Offset(stroke / 2, stroke / 2),
        size = Size(size.width - stroke, size.height - stroke),
        cornerRadius = CornerRadius(radius, radius),
        style = Stroke(stroke),
    )
}

internal fun Modifier.deckHeaderPlacement(state: DeckState, id: String, index: Int, isLast: Boolean, pose: DeckPose): Modifier =
    layout { measurable, _ ->
        val geometry = state.geometry
        state.cardPose(id, index, isLast, pose)
        val cardHeight = geometry.cardSize.height * pose.scale
        val cardWidth = geometry.cardSize.width * pose.scale
        val leading = pose.centerX - cardWidth / 2
        val width = max(pose.visibleWidth, 0.0)
        val available = max(width - 8, 0.0)
        val centerX = max(leading + width / 2, FAVICON_SIZE / 2 + 8)
        val centerY = pose.centerY - cardHeight / 2 - HEADER_GAP - TabsDeckGeometry.HEADER_HEIGHT / 2
        val opacity = pose.headerOpacity * DeckHeaderMetrics.iconReveal(available, FAVICON_SIZE)
        val widthPx = (available * density).roundToInt().coerceAtLeast(0)
        val placeable = measurable.measure(Constraints(minWidth = widthPx, maxWidth = widthPx))
        layout(widthPx, placeable.height) {
            val x = (centerX * density - widthPx / 2.0).roundToInt()
            val y = (centerY * density - placeable.height / 2.0).roundToInt()
            placeable.placeWithLayer(x, y) {
                alpha = opacity.toFloat() * state.cardsOpacity.value
            }
        }
    }

internal fun Modifier.deckGestures(state: DeckState): Modifier = pointerInput(state) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Main)
        if (down.isConsumed) return@awaitEachGesture
        val startX = down.position.x / density.toDouble()
        val startY = down.position.y / density.toDouble()
        if (!state.acceptsTouch(startX, startY)) return@awaitEachGesture
        val hit = state.cardAt(startX, startY)
        val tracker = VelocityTracker()
        tracker.addPosition(down.uptimeMillis, down.position)
        val slop = viewConfiguration.touchSlop
        val outcome = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
            var result: PressOutcome? = null
            while (result == null) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == down.id }
                if (change == null) {
                    result = PressOutcome.Cancelled
                    continue
                }
                tracker.addPosition(change.uptimeMillis, change.position)
                result = when {
                    change.changedToUpIgnoreConsumed() -> if (change.isConsumed) PressOutcome.Cancelled else PressOutcome.Tap
                    (change.position - down.position).getDistance() > slop -> PressOutcome.Drag
                    else -> null
                }
            }
            result
        }
        when (outcome) {
            null -> {
                if (hit != null) state.showMenu(hit)
                do {
                    val event = awaitPointerEvent()
                    event.changes.forEach { it.consume() }
                } while (event.changes.any { it.pressed })
            }
            PressOutcome.Tap -> if (hit != null) state.open(hit)
            PressOutcome.Cancelled -> Unit
            PressOutcome.Drag -> {
                var position = down.position
                val first = currentEvent.changes.firstOrNull { it.id == down.id }
                if (first != null) position = first.position
                state.beginDrag(hit, (position.x - down.position.x) / density.toDouble(), (position.y - down.position.y) / density.toDouble())
                state.drag((position.x - down.position.x) / density.toDouble(), (position.y - down.position.y) / density.toDouble())
                var ended = false
                while (!ended) {
                    val event = awaitPointerEvent()
                    val change = event.changes.firstOrNull { it.id == down.id }
                    if (change == null) {
                        ended = true
                        continue
                    }
                    tracker.addPosition(change.uptimeMillis, change.position)
                    position = change.position
                    if (change.changedToUpIgnoreConsumed()) {
                        ended = true
                    } else {
                        change.consume()
                        state.drag((position.x - down.position.x) / density.toDouble(), (position.y - down.position.y) / density.toDouble())
                    }
                }
                val velocity = tracker.calculateVelocity()
                state.endDrag(
                    dy = (position.y - down.position.y) / density.toDouble(),
                    velocityX = velocity.x / density.toDouble(),
                    velocityY = velocity.y / density.toDouble(),
                )
            }
        }
    }
}

internal fun Modifier.shieldsDeck(): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false).consume()
    }
}

private enum class PressOutcome { Tap, Drag, Cancelled }

private val CARD_SHADOW_ELEVATION = 14.dp
internal const val FAVICON_SIZE = 16.0
internal const val HEADER_GAP = 8.0
