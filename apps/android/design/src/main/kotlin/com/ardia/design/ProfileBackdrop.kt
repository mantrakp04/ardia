package com.ardia.design

import android.graphics.Bitmap
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

object ProfileBackdropStyle {
    const val LIGHT_GRAIN = 0.06f
    const val DARK_GRAIN = 0.03f
    val softening = adaptive(Color.White.copy(alpha = 0.72f), Color.Black.copy(alpha = 0.55f))

    fun grainOpacity(dark: Boolean): Float = if (dark) DARK_GRAIN else LIGHT_GRAIN
}

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

object GrainTexture {
    const val SIDE = 128

    fun values(): IntArray {
        var state = 0x9E3779B9.toInt()
        val values = IntArray(SIDE * SIDE)
        for (index in values.indices) {
            state = state xor (state shl 13)
            state = state xor (state ushr 17)
            state = state xor (state shl 5)
            values[index] = 64 + (state.toUInt() % 128u).toInt()
        }
        return values
    }

    internal val bitmap: Bitmap by lazy {
        val pixels = values().map { value -> (0xFF shl 24) or (value shl 16) or (value shl 8) or value }.toIntArray()
        Bitmap.createBitmap(pixels, SIDE, SIDE, Bitmap.Config.ARGB_8888)
    }
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
