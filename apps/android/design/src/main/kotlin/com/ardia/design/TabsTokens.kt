package com.ardia.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import kotlin.math.abs

object TabsPalette {
    val cardShadow = Color.Black.copy(alpha = 0.18f)
    val cardShadowBase = adaptive(Color.White, ardiaColor(0x1B1C1C))
    val cardEdge = adaptive(Color.Black.copy(alpha = 0.08f), Color.White.copy(alpha = 0.12f))
    val headerText = adaptive(ardiaColor(0x0E0F10, 0.88f), Color.White.copy(alpha = 0.92f))
    val incognitoCard = ardiaColor(0x1C1D22)
    val incognitoCardRaised = ardiaColor(0x2A2B31)
    val archiveTile = ardiaColor(0xB059EE)
    val receivedBadge = Palette.primaryAction
    val poof = ardiaColor(0xF7F5FF)
    val placeholderTints: List<Long> = listOf(0xE8E6FB, 0xFBE7EE, 0xE3F0FB, 0xE6F5EA, 0xFDF0DD, 0xEFE6F8)
    val placeholderTintsDark: List<Long> = listOf(0x262447, 0x3F2532, 0x1E3046, 0x1F3527, 0x3D3020, 0x30243F)
}

object TabsLayout {
    val cardRadius = 13.dp
    val displayCornerRadius = 55.dp
    val faviconSize = 16.dp
    val faviconRadius = 4.dp
    val headerSpacing = 6.dp
    val headerGap = 8.dp
    val barCircle = 35.dp
    val barPlus = DpSize(78.dp, 40.dp)
    val barSideInset = 16.dp
    val tileRadius = 16.dp
    val archiveCardRadius = 16.dp
    val archiveCardTile = 28.dp
}

object TabsMotion {
    val openScale = ArdiaSpring(response = 0.19f, dampingFraction = 1f)
    val openPosition = ArdiaSpring(response = 0.3f, dampingFraction = 1f)
    val expand = ArdiaSpring(response = 0.3f, dampingFraction = 1f)
    val gapClose = Motion.tabStack
    val release = ArdiaSpring(response = 0.3f, dampingFraction = 0.9f)
    val fade = ArdiaTween(200, SwiftEasing.easeOut)
    const val poofDurationMillis = 420
    const val flyAwayMillis = 200
    const val backdropSlowLoopMillis = 10_000
    const val backdropFastLoopMillis = 7_000
    val settle = ArdiaSpring.withBounce(duration = 0.4f, bounce = 0f)

    fun settleVelocity(distance: Double, velocity: Double): Double {
        if (abs(distance) <= 0.001) return 0.0
        return (velocity / distance).coerceIn(-30.0, 30.0) * distance
    }
}
