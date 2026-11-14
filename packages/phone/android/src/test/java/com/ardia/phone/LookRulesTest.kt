package com.ardia.phone

import com.ardia.design.FrostedStyle
import com.ardia.design.LookFrosting
import com.ardia.design.ProfileLook
import com.ardia.design.TabsBackdropMotion
import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LookRulesTest {
    @Test
    fun aFrostVariantIsTheComposeStyleAndBarsAndSheetsTakeTheLooksTint() {
        val look = ProfileLook.of("blue")
        assertEquals(FrostedStyle.glass, LookRules.frost("glass", null))
        assertEquals(FrostedStyle.thin, LookRules.frost("thin", look))
        assertEquals(FrostedStyle.bar, LookRules.frost("bar", null))
        assertEquals(LookFrosting.bar(look), LookRules.frost("bar", look))
        assertEquals(LookFrosting.sheet(look), LookRules.frost("sheet", look))
        assertEquals(FrostedStyle.bar, LookRules.frost("unknown", null))
    }

    @Test
    fun eachDeckBlobOrbitsItsPlacementAsTheComposeBackdropDoes() {
        val width = 400f
        val height = 800f
        val side = 800f * 0.95f
        for (index in 0 until 3) {
            val angle = 0.7f * (index + 1)
            val dx = (0.5f - TabsBackdropMotion.anchors[index * 2]) * side
            val dy = (0.5f - TabsBackdropMotion.anchors[index * 2 + 1]) * side
            val pivotX = width * TabsBackdropMotion.placements[index * 2]
            val pivotY = height * TabsBackdropMotion.placements[index * 2 + 1]
            val center = LookRules.blobCenter(index, angle, width, height)
            assertEquals(pivotX + dx * cos(angle) - dy * sin(angle), center.first, 0.01f)
            assertEquals(pivotY + dx * sin(angle) + dy * cos(angle), center.second, 0.01f)
        }
        assertEquals(side / 2f, LookRules.blobRadius(width, height), 0.01f)
    }

    @Test
    fun aLookComesFromTheSameThreeValuesProfileLookTakes() {
        assertEquals(ProfileLook.of("green", listOf("#4F7CFF", "#9B6BFF"), null), LookRules.look("green", listOf("#4F7CFF", "#9B6BFF"), null))
        assertNull(LookRules.lookOrNull(null, null, null))
    }
}
