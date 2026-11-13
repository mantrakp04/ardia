package com.ardia.tabs

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.ardia.design.SwiftEasing
import com.ardia.design.TabsMotion
import com.ardia.design.TabsPalette
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

object PoofPuffs {
    const val COUNT = 9

    val angles = FloatArray(COUNT) { index -> (index.toDouble() / COUNT * 2 * PI + if (index % 2 == 0) 0.2 else -0.15).toFloat() }
    val distances = FloatArray(COUNT) { index -> if (index % 3 == 0) 0.46f else 0.36f }
    val radii = FloatArray(COUNT) { index -> if (index % 2 == 0) 0.2f else 0.15f }
}

@Composable
internal fun PoofBurst(spec: PoofSpec) {
    val progress = remember(spec.id) { Animatable(0f) }
    LaunchedEffect(spec.id) { progress.animateTo(1f, tween(TabsMotion.poofDurationMillis, easing = SwiftEasing.easeOut)) }
    Canvas(
        Modifier
            .fillMaxSize()
            .clearAndSetSemantics {}
            .graphicsLayer { alpha = (1 - progress.value) * 0.95f }
            .blur((2 + 4 * progress.value).dp),
    ) {
        val t = progress.value
        val size = spec.size * density
        val center = Offset(spec.x * density, spec.y * density)
        val color = TabsPalette.poof
        for (index in 0 until PoofPuffs.COUNT) {
            val travel = size * PoofPuffs.distances[index] * (0.35f + 0.65f * t)
            val radius = size * PoofPuffs.radii[index] * (0.45f + 0.75f * t)
            val angle = PoofPuffs.angles[index]
            drawCircle(color, radius, Offset(center.x + cos(angle) * travel, center.y + sin(angle) * travel))
        }
        drawCircle(color, size * 0.21f * (1 - 0.5f * t), center)
    }
}
