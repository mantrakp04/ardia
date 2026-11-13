package com.ardia.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp

object BrowsePalette {
    val foregroundPrimary = adaptive(ardiaColor(0x0E0F10, 0.9f), Color.White.copy(alpha = 0.8f))
    val foregroundSecondary = adaptive(Color.Black.copy(alpha = 0.5f), Color.White.copy(alpha = 0.5f))
    val foregroundTertiary = adaptive(Color.Black.copy(alpha = 0.3f), Color.White.copy(alpha = 0.3f))
    val popover = Palette.panel
    val loadingBorder = Palette.accent
    val findError = ardiaColor(0xC93333)
    val fieldFill = adaptive(Color.Black.copy(alpha = 0.06f), Color.White.copy(alpha = 0.12f))
    val fieldStroke = adaptive(Color.Black.copy(alpha = 0.06f), Color.White.copy(alpha = 0.08f))
    val searchAccent = Palette.formAccent
    val rowIcon = adaptive(Color.Black.copy(alpha = 0.42f), Color.White.copy(alpha = 0.5f))
    val incognitoSheet = ardiaColor(0x151517)
    val incognitoField = Color.White.copy(alpha = 0.12f)
    val incognitoCaption = Color.White.copy(alpha = 0.55f)
    val toolbarTile = adaptive(Color.Black.copy(alpha = 0.05f), Color.White.copy(alpha = 0.08f))
}

object BarPalette {
    val plusFill = adaptive(ardiaColor(0x767680, 0.16f), Color.White.copy(alpha = 0.16f))
    val chevronFill = adaptive(ardiaColor(0x767680, 0.12f), Color.White.copy(alpha = 0.13f))
    val controlEdge = adaptive(Color.Black.copy(alpha = 0.06f), Color.White.copy(alpha = 0.1f))
    val tileFill = adaptive(ardiaColor(0x767680, 0.2f), Color.White.copy(alpha = 0.2f))
    val tileEdge = adaptive(Color.Black.copy(alpha = 0.14f), Color.White.copy(alpha = 0.28f))
}

object BrowseLayout {
    val sheetTopRadius = 40.dp
    const val sheetTintShare = 0.8f
    val searchFieldHeight = 47.5.dp
    val searchFieldInset = 15.dp
    val suggestionPitch = 58.5.dp
    val suggestionIcon = 15.dp
    val sheetAboveKeyboard = 274.dp
    val trayFieldTop = 15.dp
    const val trayDim = 0.28f
    val logoSize = 132.dp
    val plusCapsule = DpSize(78.dp, 40.dp)
    val chevronCircle = 35.dp
    val tabStackRadius = 5.dp
    val tabStackTile = DpSize(20.dp, 26.dp)
    val barCenterFromBottom = 44.dp
    val barSideInset = 20.dp
    val hitTarget = 44.dp
    val barHeight = 75.dp
    val barCollapseTravel = 30.dp
    const val barControlScale = 0.93f
    val progressHeight = 2.5.dp
    val toolbarTile = 78.dp
}
