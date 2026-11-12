package com.ardia.design

import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

object ArdiaType {
    val largeTitle = style(34.sp, 41.sp)
    val title = style(28.sp, 34.sp)
    val title2 = style(22.sp, 28.sp)
    val title3 = style(20.sp, 25.sp)
    val headline = style(17.sp, 22.sp, FontWeight.SemiBold)
    val body = style(17.sp, 22.sp)
    val callout = style(16.sp, 21.sp)
    val subheadline = style(15.sp, 20.sp)
    val footnote = style(13.sp, 18.sp)
    val caption = style(12.sp, 16.sp)
    val caption2 = style(11.sp, 13.sp)

    private fun style(size: TextUnit, lineHeight: TextUnit, weight: FontWeight = FontWeight.Normal) = TextStyle(
        fontSize = size,
        lineHeight = lineHeight,
        fontWeight = weight,
        platformStyle = PlatformTextStyle(includeFontPadding = false),
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    )
}

fun TextStyle.weight(weight: FontWeight): TextStyle = copy(fontWeight = weight)

val TextStyle.semibold: TextStyle get() = weight(FontWeight.SemiBold)

val TextStyle.bold: TextStyle get() = weight(FontWeight.Bold)

val TextStyle.medium: TextStyle get() = weight(FontWeight.Medium)

val TextStyle.monospacedDigits: TextStyle get() = copy(fontFeatureSettings = "tnum")
