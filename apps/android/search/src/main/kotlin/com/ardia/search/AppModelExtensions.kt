package com.ardia.search

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.snapshots.Snapshot
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.appmodel.SearchSuggestionsModel
import com.ardia.design.ArdiaSymbols
import com.ardia.design.Toast
import com.ardia.store.TabOrigin

internal fun AppModel.makeTraySuggestions(): SearchSuggestionsModel = Snapshot.withoutReadObservation { makeSuggestionsModel() }

internal fun AppModel.copySuggestionLink(context: Context, url: String, copiedMessage: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("URL", url))
    toasts.show(Toast(copiedMessage, ArdiaSymbols.link))
}

internal fun AppModel.shareSuggestionLink(context: Context, url: String, title: String) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, url)
        .putExtra(Intent.EXTRA_TITLE, title)
    runCatching { context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

internal fun AppModel.openSwitchingMode(url: String) {
    browse.dismissSearch()
    isIncognito = !isIncognito
    openPage(url, TabOrigin.TYPED)
}

internal fun AppModel.searchSwitchingMode(query: String) {
    browse.dismissSearch()
    isIncognito = !isIncognito
    openSearch(query)
}

internal val AppModel.mayFocusSearch: Boolean get() = !settings.isShowingOnboarding && !browse.isVoicePresented

internal fun AppModel.openTrayIfWanted() {
    if (!settings.autoOpensKeyboard || settings.isShowingOnboarding || browse.search != null || sheet != null) return
    browse.presentSearch(BrowseSession.SearchOrigin.Home, incognitoOnCancel = isIncognito)
}
