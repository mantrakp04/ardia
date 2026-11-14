package com.ardia.browser

class OnlineAgain(startedOffline: Boolean) {
    @Volatile
    private var sawOffline = startedOffline

    fun lost() {
        sawOffline = true
    }

    fun available(): Boolean {
        if (!sawOffline) return false
        sawOffline = false
        return true
    }
}
