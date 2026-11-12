package com.ardia.settings

import android.content.res.Resources
import android.icu.text.ListFormatter
import com.ardia.appmodel.AppModel
import com.ardia.store.ClearRange
import java.util.Locale

object ClearDataWords {
    fun choice(history: Boolean, cache: Boolean, cookies: Boolean, archive: Boolean, range: ClearRange): AppModel.ClearChoice =
        AppModel.ClearChoice(history = history, cache = cache, cookies = cookies, archive = archive && range == ClearRange.ALL_TIME)

    fun names(resources: Resources, choice: AppModel.ClearChoice): List<String> = buildList {
        if (choice.history) add(resources.getString(R.string.clear_history))
        if (choice.cache) add(resources.getString(R.string.clear_cache))
        if (choice.cookies) add(resources.getString(R.string.clear_cookies))
        if (choice.archive) add(resources.getString(R.string.clear_archived_tabs))
    }

    fun confirmationTitle(resources: Resources, choice: AppModel.ClearChoice, range: ClearRange): String {
        val list = ListFormatter.getInstance(resources.configuration.locales[0] ?: Locale.getDefault()).format(names(resources, choice))
        return resources.getString(R.string.clear_confirm_title, list, range.phrase)
    }

    fun confirmationMessage(resources: Resources, choice: AppModel.ClearChoice): String =
        resources.getString(if (choice.cookies) R.string.clear_message_cookies else R.string.clear_message_signed_in)

    fun footer(resources: Resources, choice: AppModel.ClearChoice): String {
        if (choice.isEmpty) return resources.getString(R.string.clear_footer_choose)
        val lines = buildList {
            if (choice.history) add(resources.getString(R.string.clear_footer_history))
            add(resources.getString(if (choice.cookies) R.string.clear_footer_cookies else R.string.clear_footer_signed_in))
        }
        return lines.joinToString(" ")
    }
}
