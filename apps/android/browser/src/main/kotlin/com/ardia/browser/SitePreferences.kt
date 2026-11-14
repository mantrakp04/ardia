package com.ardia.browser

interface SitePreferences {
    fun nightShade(host: String?, isPrivate: Boolean): NightShadeMode

    fun pageZoom(host: String?, isPrivate: Boolean): Double?

    fun setPageZoom(host: String, isPrivate: Boolean, zoom: Double?)

    fun opensLinksInApps(host: String?, isPrivate: Boolean): Boolean

    object Defaults : SitePreferences {
        override fun nightShade(host: String?, isPrivate: Boolean) = NightShadeMode.Disabled

        override fun pageZoom(host: String?, isPrivate: Boolean): Double? = null

        override fun setPageZoom(host: String, isPrivate: Boolean, zoom: Double?) = Unit

        override fun opensLinksInApps(host: String?, isPrivate: Boolean) = false
    }
}
