package com.ardia.browsing

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.browser.PageColors
import com.ardia.browser.PageState
import com.ardia.browser.PageTone
import com.ardia.design.Toasts
import com.ardia.store.BrowserTab
import com.ardia.store.TabDestination
import com.ardia.store.TabOrigin
import com.ardia.store.TabPlacement

val AppModel.swipeOrder: List<BrowserTab> get() = SwipeOrder.resolve(deckOrder, browse.frozenOrder)

fun AppModel.tone(tab: BrowserTab, themeColor: Int?, backgroundColor: Int?): PageTone = PageTone.resolve(
    themeColor = themeColor,
    backgroundColor = backgroundColor,
    sampled = browse.tones[tab.id],
    stored = PageColors.parseHex(tab.themeColorHex),
)

fun AppModel.tone(tab: BrowserTab, state: PageState?): PageTone = tone(tab, state?.themeColor, state?.backgroundColor)

fun AppModel.openLink(url: String, fromTabId: String, inBackground: Boolean) {
    val store = tabStore ?: return
    val opener = store.tab(fromTabId)
    val tab = store.open(
        TabDestination.Url(url, TabOrigin.LINK),
        TabPlacement.After(fromTabId),
        selecting = !inBackground,
        isPrivate = opener?.isPrivate ?: isIncognito,
    )
    if (!inBackground) openTab(tab.id)
}

fun AppModel.copyLinkToClipboard(context: Context, url: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("URL", url))
    toasts.show(Toasts.copiedUrl())
}

fun AppModel.shareLink(context: Context, url: String, title: String = "") {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
    if (title.isNotEmpty()) send.putExtra(Intent.EXTRA_TITLE, title)
    try {
        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (missing: ActivityNotFoundException) {
        return
    }
}

fun AppModel.editQuery(tab: BrowserTab) {
    browse.isToolbarPresented = false
    browse.presentSearch(BrowseSession.SearchOrigin.Page, text = currentQuery(tab), selectsAll = true)
}

fun AppModel.openSiteSettingsRoute(route: com.ardia.appmodel.SettingsRoute) {
    browse.isToolbarPresented = false
    settings.pendingRoute = route
    sheet = AppModel.Sheet.Settings
}
