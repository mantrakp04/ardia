package com.ardia.phone

import com.ardia.design.DeckBackdropStyle
import com.ardia.design.FrostedStyle
import com.ardia.design.LookFrosting
import com.ardia.design.ProfileBackdropStyle
import com.ardia.design.ProfileLook
import com.ardia.design.TabsBackdropMotion
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

object LookRules {
    fun frost(variant: String?, look: ProfileLook?): FrostedStyle = when (variant) {
        "sheet" -> look?.let(LookFrosting::sheet) ?: FrostedStyle.sheet
        "glass" -> FrostedStyle.glass
        "thin" -> FrostedStyle.thin
        else -> look?.let(LookFrosting::bar) ?: FrostedStyle.bar
    }

    fun blobSide(width: Float, height: Float): Float = max(width, height) * DeckBackdropStyle.BLOB_SIDE_SHARE

    fun blobRadius(width: Float, height: Float): Float = blobSide(width, height) / 2f

    fun blobCenter(index: Int, angle: Float, width: Float, height: Float): Pair<Float, Float> {
        val side = blobSide(width, height)
        val dx = (0.5f - TabsBackdropMotion.anchors[index * 2]) * side
        val dy = (0.5f - TabsBackdropMotion.anchors[index * 2 + 1]) * side
        val pivotX = width * TabsBackdropMotion.placements[index * 2]
        val pivotY = height * TabsBackdropMotion.placements[index * 2 + 1]
        return (pivotX + dx * cos(angle) - dy * sin(angle)) to (pivotY + dx * sin(angle) + dy * cos(angle))
    }

    const val INCOGNITO = "incognito"

    fun look(color: String?, themeColors: List<String>?, darkThemeColors: List<String>?): ProfileLook =
        if (color == INCOGNITO) ProfileLook.incognito else ProfileLook.of(color, themeColors.orEmpty(), darkThemeColors)

    fun lookOrNull(color: String?, themeColors: List<String>?, darkThemeColors: List<String>?): ProfileLook? =
        if (color == null && themeColors.isNullOrEmpty() && darkThemeColors.isNullOrEmpty()) null else look(color, themeColors, darkThemeColors)

    fun dark(requested: Boolean?, system: Boolean, look: ProfileLook?): Boolean = (requested ?: system) || look?.isAlwaysDark == true

    fun fadeMask(): Pair<FloatArray, FloatArray> =
        ProfileBackdropStyle.fadeStops.map { it.first }.toFloatArray() to ProfileBackdropStyle.fadeStops.map { it.second }.toFloatArray()
}
