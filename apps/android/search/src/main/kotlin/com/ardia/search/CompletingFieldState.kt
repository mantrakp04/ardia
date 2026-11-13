package com.ardia.search

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.ardia.store.CompletionOffer
import com.ardia.store.InlineCompletionEditor

@Stable
class CompletingFieldState(initial: String = "", selectsAll: Boolean = false) {
    private val editor = InlineCompletionEditor(initial)

    var value: TextFieldValue by mutableStateOf(
        TextFieldValue(initial, if (selectsAll) TextRange(0, initial.length) else TextRange(initial.length)),
    )
        private set

    var suffix: String by mutableStateOf("")
        private set

    var isFocused: Boolean = false
        private set

    val typed: String get() = editor.typed

    val display: String get() = editor.display

    fun edit(next: TextFieldValue): Boolean {
        val previous = value
        val before = editor.typed
        if (next.text == previous.text) {
            value = next
            if (editor.hasSuffix && !caretAtEnd(next)) {
                editor.accept()
                value = TextFieldValue(editor.typed, next.selection)
                publishSuffix()
                return true
            }
            if (editor.hasSuffix && isComposingScript(next)) dropSuffix()
            return false
        }
        val endEdit = caretAtEnd(previous) && next.selection.collapsed && next.selection.start == next.text.length
        when {
            endEdit && next.text.length < before.length && before.startsWith(next.text) -> {
                if (editor.deleteBackward() == InlineCompletionEditor.Edit.CONSUMED) {
                    value = TextFieldValue(before, TextRange(before.length))
                    publishSuffix()
                    return false
                }
                editor.syncTyped(next.text)
            }
            endEdit && next.text.length > before.length && next.text.startsWith(before) -> {
                if (editor.insert(next.text.substring(before.length)) == InlineCompletionEditor.Edit.INSERT_TYPED) editor.syncTyped(next.text)
            }
            next.text.length < before.length -> {
                editor.deleteBackward()
                editor.syncTyped(next.text)
            }
            else -> editor.reset(next.text)
        }
        value = next
        if (isComposingScript(next)) editor.dropSuffix()
        publishSuffix()
        return editor.typed != before
    }

    fun offer(offer: CompletionOffer?) {
        if (!canShowCompletion()) {
            if (editor.hasSuffix && !isFocused) dropSuffix()
            return
        }
        if (editor.receive(offer)) publishSuffix()
    }

    fun focusChanged(focused: Boolean) {
        isFocused = focused
        if (!focused) dropSuffix()
    }

    fun reset(text: String, selectsAll: Boolean = false) {
        editor.reset(text)
        value = TextFieldValue(text, if (selectsAll) TextRange(0, text.length) else TextRange(text.length))
        publishSuffix()
    }

    fun dropSuffix() {
        if (!editor.hasSuffix) return
        editor.dropSuffix()
        publishSuffix()
    }

    private fun canShowCompletion(): Boolean = isFocused && caretAtEnd(value) && !isComposingScript(value)

    private fun caretAtEnd(field: TextFieldValue): Boolean = field.selection.collapsed && field.selection.start == field.text.length

    private fun publishSuffix() {
        if (suffix != editor.suffix) suffix = editor.suffix
    }

    companion object {
        private const val FIRST_COMPOSING_SCRIPT = 0x2E80

        fun isComposingScript(field: TextFieldValue): Boolean {
            val composition = field.composition ?: return false
            if (composition.collapsed) return false
            val start = composition.min.coerceIn(0, field.text.length)
            val end = composition.max.coerceIn(0, field.text.length)
            for (index in start until end) {
                if (field.text[index].code >= FIRST_COMPOSING_SCRIPT) return true
            }
            return false
        }
    }
}
