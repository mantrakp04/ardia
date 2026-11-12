package com.ardia.settings

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import com.ardia.appmodel.AppModel
import com.ardia.browser.BrowserUrl
import com.ardia.store.TabOrigin

fun AppModel.openFromSettings(url: String) {
    if (!BrowserUrl.isWeb(url)) return
    sheet = null
    isIncognito = false
    openPage(url, TabOrigin.LINK)
}

fun AppModel.exportableTabUrls(): List<String> =
    tabs.openTabs.filter { !it.isPrivate }.map { it.url }.filter { it.startsWith("https://") || it.startsWith("http://") }

fun AppModel.showOnboardingFromSettings() {
    sheet = null
    settings.showOnboarding()
}

object BrowserRole {
    fun requestIntent(context: Context): Intent? {
        val roles = context.getSystemService(RoleManager::class.java) ?: return null
        if (!roles.isRoleAvailable(RoleManager.ROLE_BROWSER) || roles.isRoleHeld(RoleManager.ROLE_BROWSER)) return null
        return roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
    }

    fun isHeld(context: Context): Boolean = context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_BROWSER) == true

    fun defaultAppsIntent(): Intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
}
