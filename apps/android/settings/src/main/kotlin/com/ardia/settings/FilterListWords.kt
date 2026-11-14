package com.ardia.settings

import android.content.res.Resources
import android.text.format.DateUtils
import com.ardia.blocking.FilterListInfo
import com.ardia.blocking.FilterListState
import com.ardia.blocking.MyFiltersResult
import java.text.NumberFormat

data class FilterListFacts(val text: String, val isWarning: Boolean)

object FilterListWords {
    private const val JUST_NOW_MILLIS = 60_000L

    fun number(resources: Resources, value: Int): String = NumberFormat.getIntegerInstance(resources.configuration.locales[0]).format(value)

    fun rules(resources: Resources, count: Int): String = resources.getQuantityString(R.plurals.lists_rules, count, number(resources, count))

    fun lists(resources: Resources, count: Int): String = resources.getQuantityString(R.plurals.lists_lists, count, number(resources, count))

    fun summary(resources: Resources, lists: Int, rules: Int): String =
        resources.getString(R.string.lists_summary, lists(resources, lists), rules(resources, rules))

    fun updated(resources: Resources, date: Long?, now: Long): String {
        date ?: return resources.getString(R.string.lists_not_updated)
        if (now - date < JUST_NOW_MILLIS) return resources.getString(R.string.lists_updated_now)
        val relative = DateUtils.getRelativeTimeSpanString(date, now, DateUtils.MINUTE_IN_MILLIS).toString()
        return resources.getString(R.string.lists_updated, relative)
    }

    fun status(resources: Resources, isUpdating: Boolean, isOffline: Boolean, lastUpdated: Long?, now: Long): String = when {
        isUpdating -> resources.getString(R.string.lists_updating)
        isOffline -> resources.getString(R.string.lists_offline_status, updated(resources, lastUpdated, now))
        else -> updated(resources, lastUpdated, now)
    }

    fun facts(resources: Resources, list: FilterListInfo, now: Long): FilterListFacts = when (list.state) {
        FilterListState.Downloading -> FilterListFacts(resources.getString(R.string.lists_downloading), false)
        FilterListState.Compiling -> FilterListFacts(resources.getString(R.string.lists_compiling), false)
        is FilterListState.Failed -> FilterListFacts(resources.getString(R.string.lists_couldnt_update_row), true)
        FilterListState.TooLarge -> FilterListFacts(resources.getString(R.string.lists_too_large_row), true)
        FilterListState.Offline -> FilterListFacts(resources.getString(R.string.lists_waiting, rules(resources, list.ruleCount)), false)
        FilterListState.Ready -> if (!list.isEnabled && list.updatedAt == null) {
            FilterListFacts(resources.getString(R.string.lists_downloads_when_on), false)
        } else {
            FilterListFacts(resources.getString(R.string.lists_summary, rules(resources, list.ruleCount), updated(resources, list.updatedAt, now)), false)
        }
    }

    fun detailStatus(resources: Resources, list: FilterListInfo): String = resources.getString(
        when (list.state) {
            FilterListState.Downloading -> R.string.lists_downloading
            FilterListState.Compiling -> R.string.lists_compiling
            is FilterListState.Failed -> R.string.list_state_couldnt_update
            FilterListState.TooLarge -> R.string.list_state_too_large
            FilterListState.Offline -> R.string.list_state_offline
            FilterListState.Ready -> if (list.isEnabled) R.string.list_state_on else R.string.list_state_off
        },
    )

    fun isBusy(list: FilterListInfo): Boolean = list.state == FilterListState.Downloading || list.state == FilterListState.Compiling

    fun resetMessage(resources: Resources, customLists: Int): String {
        if (customLists <= 0) return resources.getString(R.string.lists_restore_message)
        val removed = resources.getQuantityString(R.plurals.lists_you_added, customLists, number(resources, customLists))
        return resources.getString(R.string.lists_restore_message_custom, removed)
    }

    fun myFiltersCount(resources: Resources, result: MyFiltersResult): String =
        if (result.ruleCount == 0) resources.getString(R.string.settings_none) else rules(resources, result.ruleCount)

    fun myFiltersSummary(resources: Resources, result: MyFiltersResult, hasChanges: Boolean): String {
        if (hasChanges) return resources.getString(R.string.my_filters_unapplied)
        if (result.ruleCount == 0 && result.skippedCount == 0) return resources.getString(R.string.my_filters_no_rules)
        val rules = rules(resources, result.ruleCount)
        if (result.skippedCount <= 0) return rules
        return resources.getString(R.string.my_filters_skipped, rules, number(resources, result.skippedCount))
    }
}
