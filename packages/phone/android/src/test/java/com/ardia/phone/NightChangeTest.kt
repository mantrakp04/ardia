package com.ardia.phone

import android.content.res.Configuration
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NightChangeTest {
    @Test
    fun onlyASwitchBetweenLightAndDarkCountsAndTheFirstLookAlwaysDoes() {
        val night = NightChange()
        assertTrue(night.changed(Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_NO))
        assertFalse(night.changed(Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_NO))
        assertTrue(night.changed(Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_YES))
        assertFalse(night.changed(Configuration.UI_MODE_TYPE_DESK or Configuration.UI_MODE_NIGHT_YES))
        assertTrue(night.changed(Configuration.UI_MODE_TYPE_NORMAL or Configuration.UI_MODE_NIGHT_NO))
    }
}
