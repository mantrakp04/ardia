package com.ardia.design

import androidx.compose.ui.graphics.Color

object ProfileBackdropStyle {
    const val LIGHT_GRAIN = 0.06f
    const val DARK_GRAIN = 0.03f
    val softening = adaptive(Color.White.copy(alpha = 0.72f), Color.Black.copy(alpha = 0.55f))

    fun grainOpacity(dark: Boolean): Float = if (dark) DARK_GRAIN else LIGHT_GRAIN
}
