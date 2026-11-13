package com.ardia.settings

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaLogoMark
import com.ardia.design.SettingsLayout
import com.ardia.design.SystemPalette
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object AppIconImages {
    private const val ADAPTIVE_VISIBLE_SHARE = 72f / 108f
    private val cache = HashMap<Int, ImageBitmap?>()

    fun load(context: Context, sidePx: Int): ImageBitmap? = synchronized(cache) {
        cache.getOrPut(sidePx) { render(runCatching { context.packageManager.getApplicationIcon(context.packageName) }.getOrNull(), sidePx) }
    }

    private fun render(drawable: Drawable?, side: Int): ImageBitmap? {
        drawable ?: return null
        if (side <= 0) return null
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        if (drawable is AdaptiveIconDrawable) {
            val full = (side / ADAPTIVE_VISIBLE_SHARE).roundToInt()
            val inset = (full - side) / 2
            for (layer in listOfNotNull(drawable.background, drawable.foreground)) {
                layer.setBounds(-inset, -inset, side + inset, side + inset)
                layer.draw(canvas)
            }
        } else {
            drawable.setBounds(0, 0, side, side)
            drawable.draw(canvas)
        }
        return bitmap.asImageBitmap()
    }
}

@Composable
fun AppIcon(modifier: Modifier = Modifier, side: Dp = 29.dp, shadow: Boolean = false, scalesWithText: Boolean = true) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val scaled = if (scalesWithText) side * minOf(density.fontScale, SettingsLayout.appIconMaxScale) else side
    val sidePx = with(density) { scaled.roundToPx() }
    val image by produceState<ImageBitmap?>(null, context, sidePx) {
        value = withContext(Dispatchers.Default) { AppIconImages.load(context.applicationContext, sidePx) }
    }
    val shape = RoundedCornerShape(scaled * 0.225f)
    Box(
        modifier
            .size(scaled)
            .let { if (shadow) it.shadow(10.dp, shape, ambientColor = Color.Black.copy(alpha = 0.12f), spotColor = Color.Black.copy(alpha = 0.12f)) else it }
            .clip(shape)
            .background(Color.White)
            .border(0.5.dp, SystemPalette.label.current.copy(alpha = 0.08f), shape)
            .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        val loaded = image
        if (loaded != null) {
            Image(loaded, null, Modifier.size(scaled))
        } else {
            ArdiaLogoMark(Modifier.padding(scaled * 0.18f))
        }
    }
}
