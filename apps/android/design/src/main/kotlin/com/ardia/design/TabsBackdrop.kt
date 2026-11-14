package com.ardia.design

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.graphics.drawscope.translate
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

internal object TabsBackdropMotion {
    val loopsMillis = intArrayOf(
        TabsMotion.backdropSlowLoopMillis,
        TabsMotion.backdropFastLoopMillis,
        (TabsMotion.backdropSlowLoopMillis * 1.3).toInt(),
    )
    val anchors = floatArrayOf(0.42f, 0.38f, 0.6f, 0.58f, 0.5f, 0.45f)
    val placements = floatArrayOf(0.18f, 0.22f, 0.86f, 0.5f, 0.3f, 0.86f)
}

@Composable
fun TabsBackdrop(modifier: Modifier = Modifier, look: ProfileLook = LocalProfileLook.current) {
    val dark = LocalArdiaDarkTheme.current
    val reduceMotion = LocalReduceMotion.current
    val reduceTransparency = LocalReduceTransparency.current
    val mesh = remember(dark, look) { MeshGrid.uniform(3, 2, look.deckBase(dark)) }
    val image = remember(mesh) { MeshImageCache.image(mesh) }
    val blobColors = remember(dark, look) { look.deckBlobs(dark) }
    val angles = blobAngles(animated = !reduceMotion && !reduceTransparency)
    val blobOpacity = if (dark) 0.7f else 0.85f
    val grainOpacity = if (dark) 0.06f else 0.08f
    Box(
        modifier
            .clearAndSetSemantics {}
            .drawWithCache {
                val side = max(size.width, size.height) * 0.95f
                val radius = side / 2f
                val brushes = blobColors.map { color ->
                    Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = Offset.Zero, radius = radius)
                }
                val grain = FilmGrainBrush.brush(density)
                onDrawBehind {
                    drawMeshImage(image)
                    if (!reduceTransparency) {
                        for (index in brushes.indices) {
                            val angle = angles[index].value
                            val dx = (0.5f - TabsBackdropMotion.anchors[index * 2]) * side
                            val dy = (0.5f - TabsBackdropMotion.anchors[index * 2 + 1]) * side
                            val pivotX = size.width * TabsBackdropMotion.placements[index * 2]
                            val pivotY = size.height * TabsBackdropMotion.placements[index * 2 + 1]
                            val centerX = pivotX + dx * cos(angle) - dy * sin(angle)
                            val centerY = pivotY + dx * sin(angle) + dy * cos(angle)
                            translate(centerX, centerY) {
                                drawCircle(brushes[index], radius = radius, center = Offset.Zero, alpha = blobOpacity)
                            }
                        }
                        drawRect(grain, alpha = grainOpacity, blendMode = BlendMode.Overlay)
                    }
                }
            },
    )
}

@Composable
private fun blobAngles(animated: Boolean): List<State<Float>> {
    if (!animated) return remember { List(3) { mutableFloatStateOf(0f) } }
    val transition = rememberInfiniteTransition(label = "tabsBackdrop")
    return List(3) { index ->
        val full = (2 * PI).toFloat()
        val forward = index % 2 == 0
        transition.animateFloat(
            initialValue = if (forward) 0f else full,
            targetValue = if (forward) full else 0f,
            animationSpec = infiniteRepeatable(tween(TabsBackdropMotion.loopsMillis[index], easing = LinearEasing), RepeatMode.Restart),
            label = "blob$index",
        )
    }
}
