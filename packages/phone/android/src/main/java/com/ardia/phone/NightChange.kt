package com.ardia.phone

import android.content.res.Configuration

class NightChange {
    private var last: Int? = null

    @Synchronized
    fun changed(uiMode: Int): Boolean {
        val night = uiMode and Configuration.UI_MODE_NIGHT_MASK
        if (night == last) return false
        last = night
        return true
    }
}
