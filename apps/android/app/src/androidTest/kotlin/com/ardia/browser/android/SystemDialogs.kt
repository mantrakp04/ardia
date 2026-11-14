package com.ardia.browser.android

import android.accessibilityservice.AccessibilityService
import android.app.UiAutomation
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

class BlockingDialog(val kind: SystemDialogs.Kind, val packageName: String, val window: AccessibilityWindowInfo, val root: AccessibilityNodeInfo) {
    fun describe(): String =
        "$kind from $packageName (window \"${window.title}\", type ${window.type}, focused ${window.isFocused}): " +
            "labels ${SystemDialogs.labels(root).take(12)}, ids ${SystemDialogs.resourceIds(root).take(8)}"
}

object SystemDialogs {
    enum class Kind { NotResponding, Crashed, PermissionPrompt, RoleRequest, SystemScreen, OtherWindow }

    const val TIMEOUT_MILLIS = 30_000L
    const val AFTER_DISMISS_MILLIS = 600L

    private const val WAIT = "android:id/aerr_wait"
    private const val CLOSE_CRASHED = "android:id/aerr_close"
    private const val ERROR_PREFIX = "android:id/aerr_"
    private const val CANCEL = "android:id/button2"
    private val denyIds = listOf("permission_deny_button", "permission_deny_and_dont_ask_again_button", "permission_deny_dont_ask_again_button")
    private val denyWords = listOf("Don’t allow", "Don't allow", "Deny")
    private val cancelWords = listOf("Cancel", "Not now")
    private val systemScreenPackages = listOf("com.android.settings", "permissioncontroller")
    private val ignoredTypes = setOf(AccessibilityWindowInfo.TYPE_INPUT_METHOD, AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY, AccessibilityWindowInfo.TYPE_SPLIT_SCREEN_DIVIDER)

    fun blocking(windows: List<AccessibilityWindowInfo>, ours: String): BlockingDialog? {
        val ourTop = windows.filter { it.root?.packageName?.toString() == ours }.maxOfOrNull { it.layer } ?: Int.MIN_VALUE
        for (window in windows.sortedByDescending { it.layer }) {
            if (window.type in ignoredTypes) continue
            val root = window.root ?: continue
            val packageName = root.packageName?.toString() ?: continue
            if (packageName == ours) continue
            val kind = classify(window, root, packageName, ourTop) ?: continue
            return BlockingDialog(kind, packageName, window, root)
        }
        return null
    }

    private fun classify(window: AccessibilityWindowInfo, root: AccessibilityNodeInfo, packageName: String, ourTop: Int): Kind? {
        val ids = resourceIds(root)
        val isSystemScreen = systemScreenPackages.any { packageName.contains(it) }
        return when {
            WAIT in ids -> Kind.NotResponding
            ids.any { it.startsWith(ERROR_PREFIX) } -> Kind.Crashed
            packageName.contains("permissioncontroller") && ids.any { id -> denyIds.any { id.endsWith(":id/$it") } } -> Kind.PermissionPrompt
            packageName.contains("permissioncontroller") && (ids.any { "role" in it } || labels(root).any { it.contains("default", ignoreCase = true) } && CANCEL in ids) -> Kind.RoleRequest
            isSystemScreen && window.type == AccessibilityWindowInfo.TYPE_APPLICATION -> Kind.SystemScreen
            ourTop != Int.MIN_VALUE && window.type == AccessibilityWindowInfo.TYPE_APPLICATION && window.layer > ourTop -> Kind.OtherWindow
            else -> null
        }
    }

    fun dismiss(dialog: BlockingDialog, automation: UiAutomation): Boolean = when (dialog.kind) {
        Kind.NotResponding -> click(dialog.root.findAccessibilityNodeInfosByViewId(WAIT).firstOrNull() ?: byWords(dialog.root, listOf("Wait")))
        Kind.Crashed -> click(dialog.root.findAccessibilityNodeInfosByViewId(CLOSE_CRASHED).firstOrNull())
        Kind.PermissionPrompt -> click(denyIds.firstNotNullOfOrNull { id -> dialog.root.findAccessibilityNodeInfosByViewId("${dialog.packageName}:id/$id").firstOrNull() } ?: byWords(dialog.root, denyWords))
        Kind.RoleRequest -> click(dialog.root.findAccessibilityNodeInfosByViewId(CANCEL).firstOrNull() ?: byWords(dialog.root, cancelWords)) || back(dialog, automation)
        Kind.SystemScreen, Kind.OtherWindow -> back(dialog, automation)
    }

    private fun back(dialog: BlockingDialog, automation: UiAutomation): Boolean =
        dialog.window.isFocused && automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)

    fun labels(root: AccessibilityNodeInfo): List<String> {
        val found = ArrayList<String>()
        walk(root) { node -> listOfNotNull(node.text?.toString(), node.contentDescription?.toString()).forEach(found::add) }
        return found
    }

    fun resourceIds(root: AccessibilityNodeInfo): Set<String> {
        val found = LinkedHashSet<String>()
        walk(root) { node -> node.viewIdResourceName?.let(found::add) }
        return found
    }

    private fun byWords(root: AccessibilityNodeInfo, words: List<String>): AccessibilityNodeInfo? {
        var match: AccessibilityNodeInfo? = null
        walk(root) { node ->
            if (match == null && node.isClickable && words.any { word -> node.text?.toString().equals(word, ignoreCase = true) }) match = node
        }
        return match
    }

    private fun click(node: AccessibilityNodeInfo?): Boolean = node?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true

    private fun walk(node: AccessibilityNodeInfo, visit: (AccessibilityNodeInfo) -> Unit) {
        visit(node)
        for (index in 0 until node.childCount) node.getChild(index)?.let { walk(it, visit) }
    }
}
