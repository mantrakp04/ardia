package com.ardia.phone

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.view.inspector.WindowInspector
import android.webkit.WebView
import androidx.core.content.ContextCompat

object PhoneA11yDump {
    const val ACTION = "com.ardia.phone.A11Y_DUMP"
    private const val TAG = "PAGELAB"
    private const val PREFIX = "PAGELAB a11y "

    private var registered: Pair<Context, BroadcastReceiver>? = null

    fun lines(root: View, visible: (View, AccessibilityNodeInfo) -> Boolean = { _, node -> node.isVisibleToUser }): List<String> {
        val out = ArrayList<String>()
        walk(root, 0, out, visible)
        return out
    }

    fun windows(): List<View> = runCatching { WindowInspector.getGlobalWindowViews() }.getOrDefault(emptyList())

    fun dump(activity: Activity?) {
        val roots = windows().ifEmpty { listOfNotNull(activity?.window?.decorView) }
        Log.i(TAG, "${PREFIX}begin ${roots.size} window(s)")
        for (root in roots) {
            if (!root.isShown) continue
            Log.i(TAG, "${PREFIX}window ${root.javaClass.simpleName} ${root.width}x${root.height}")
            lines(root).forEach { Log.i(TAG, it) }
        }
        Log.i(TAG, "${PREFIX}end")
    }

    fun listen(context: Context, activity: () -> Activity?) {
        if (!PhoneLab.isOn || registered != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = dump(activity())
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(ACTION), ContextCompat.RECEIVER_EXPORTED)
        registered = context to receiver
    }

    fun stopListening() {
        val (context, receiver) = registered ?: return
        registered = null
        runCatching { context.unregisterReceiver(receiver) }
    }

    private fun walk(view: View, depth: Int, out: MutableList<String>, visible: (View, AccessibilityNodeInfo) -> Boolean) {
        if (view.isImportantForAccessibility && view.isShown) describe(view, depth, visible)?.let(out::add)
        if (view is WebView) return
        val children = ArrayList<View>()
        view.addChildrenForAccessibility(children)
        for (child in children) walk(child, depth + 1, out, visible)
    }

    private fun describe(view: View, depth: Int, visible: (View, AccessibilityNodeInfo) -> Boolean): String? {
        val node = view.createAccessibilityNodeInfo()
        try {
            if (!visible(view, node)) return null
            val traits = buildList {
                if (node.isClickable) add("clickable")
                if (node.isFocusable) add("focusable")
                if (node.isHeading) add("heading")
                if (node.isCheckable) add(if (node.isChecked) "checked" else "unchecked")
                if (!node.isEnabled) add("disabled")
                if (view is WebView) add("page")
            }
            val text = node.text?.toString()?.replace('\n', ' ')?.take(80)
            val description = node.contentDescription?.toString()?.replace('\n', ' ')?.take(80)
            val pane = node.paneTitle?.toString()
            return buildString {
                append(PREFIX)
                append("  ".repeat(depth))
                append(node.className ?: view.javaClass.simpleName)
                if (text != null) append(" text=\"").append(text).append('"')
                if (description != null) append(" desc=\"").append(description).append('"')
                if (pane != null) append(" pane=\"").append(pane).append('"')
                if (traits.isNotEmpty()) append(" [").append(traits.joinToString(",")).append(']')
            }
        } finally {
            @Suppress("DEPRECATION")
            node.recycle()
        }
    }
}
