package com.ardia.settings

import android.content.res.Resources
import android.text.format.DateUtils
import androidx.compose.ui.graphics.vector.ImageVector
import com.ardia.design.ArdiaSymbols
import com.ardia.sync.SyncDeviceIcon
import com.ardia.sync.SyncedDevice

object SyncDeviceWords {
    private const val JUST_NOW_MILLIS = 60_000L

    fun ordered(devices: List<SyncedDevice>): List<SyncedDevice> =
        devices.sortedWith(compareBy<SyncedDevice> { it.isCurrent }.thenByDescending { it.lastSeen ?: Double.NEGATIVE_INFINITY })

    fun lastSeen(resources: Resources, device: SyncedDevice, now: Long): String {
        if (device.isCurrent) return resources.getString(R.string.sync_this_phone)
        val seen = device.lastSeen?.toLong() ?: return resources.getString(R.string.sync_not_yet_synced)
        if (now - seen < JUST_NOW_MILLIS) return resources.getString(R.string.sync_just_now)
        return DateUtils.getRelativeTimeSpanString(seen, now, DateUtils.MINUTE_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE).toString()
    }

    fun icon(device: SyncedDevice): ImageVector = when (SyncDeviceIcon.of(device.kind, device.name)) {
        SyncDeviceIcon.PHONE -> ArdiaSymbols.iphone
        SyncDeviceIcon.LAPTOP -> ArdiaSymbols.laptopcomputer
        SyncDeviceIcon.DESKTOP, SyncDeviceIcon.STUDIO, SyncDeviceIcon.MINI -> ArdiaSymbols.macbook
    }
}
