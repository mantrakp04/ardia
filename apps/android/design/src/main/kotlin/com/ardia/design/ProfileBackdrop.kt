package com.ardia.design

import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Shader
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize

fun Modifier.profileBackdrop(look: ProfileLook, dark: Boolean, themed: Boolean = false, softened: Boolean = false): Modifier {
    val colors = look.backdropColors(dark, themed)
    val diagonal = look.showsTheme(dark, themed)
    val softening = if (softened) ProfileBackdropStyle.softening.resolve(dark) else Color.Transparent
    val grainOpacity = ProfileBackdropStyle.grainOpacity(dark)
    return drawWithCache {
        val gradient = if (diagonal) {
            Brush.linearGradient(colors, start = Offset.Zero, end = Offset(size.width, size.height))
        } else {
            Brush.verticalGradient(colors)
        }
        val grain = FilmGrainBrush.brush(density)
        onDrawBehind {
            drawRect(gradient)
            if (softening.alpha > 0f) drawRect(softening)
            drawRect(grain, alpha = grainOpacity, blendMode = BlendMode.Overlay)
        }
    }
}

@Composable
fun ProfileBackdrop(modifier: Modifier = Modifier, look: ProfileLook? = null, themed: Boolean = false, softened: Boolean = false) {
    Box(modifier.clearAndSetSemantics {}.profileBackdrop(look ?: LocalProfileLook.current, LocalArdiaDarkTheme.current, themed, softened))
}

@Composable
fun FilmGrain(modifier: Modifier = Modifier, opacity: Float = ProfileBackdropStyle.LIGHT_GRAIN) {
    Box(modifier.fillMaxSize().clearAndSetSemantics {}.filmGrain(opacity))
}

fun Modifier.filmGrain(opacity: Float): Modifier = drawWithCache {
    val grain = FilmGrainBrush.brush(density)
    onDrawWithContent {
        drawContent()
        drawRect(grain, alpha = opacity, blendMode = BlendMode.Overlay)
    }
}

internal fun DrawScope.drawMeshImage(image: ImageBitmap) {
    drawImage(
        image = image,
        srcOffset = IntOffset.Zero,
        srcSize = IntSize(image.width, image.height),
        dstOffset = IntOffset.Zero,
        dstSize = IntSize(size.width.toInt() + 1, size.height.toInt() + 1),
        filterQuality = FilterQuality.Low,
    )
}

internal object FilmGrainBrush {
    private val brushes = HashMap<Float, ShaderBrush>()

    fun brush(density: Float): ShaderBrush = synchronized(brushes) {
        brushes.getOrPut(density) {
            val shader = BitmapShader(GrainTexture.bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT)
            shader.setLocalMatrix(Matrix().apply { setScale(density / 2f, density / 2f) })
            ShaderBrush(shader)
        }
    }
}
