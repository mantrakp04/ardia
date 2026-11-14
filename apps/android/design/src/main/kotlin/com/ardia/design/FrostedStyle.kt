package com.ardia.design

import android.os.Build
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

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
