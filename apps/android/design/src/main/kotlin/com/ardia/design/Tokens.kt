package com.ardia.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object Palette {
    val indigo = Color(0xFF3139FB)
    val gradientDeep = Color(0xFF090092)
    val gradientViolet = Color(0xFF3413AF)
    val gradientPlum = Color(0xFF6E38B1)
    val gradientPink = Color(0xFFFF5686)

    val launchGradient = listOf(gradientDeep, gradientViolet, gradientPlum, gradientPink)
}

object Spacing {
    val hairline = 4.dp
    val tight = 8.dp
    val small = 12.dp
    val page = 16.dp
    val medium = 20.dp
    val large = 24.dp
    val section = 32.dp
}

object Radius {
    val field = 16.dp
    val card = 20.dp
    val sheet = 32.dp
}
