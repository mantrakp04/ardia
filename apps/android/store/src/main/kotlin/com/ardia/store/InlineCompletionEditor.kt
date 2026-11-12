package com.ardia.store

data class CompletionOffer(val query: String, val completion: String?)

class InlineCompletionEditor(typed: String = "") {
    enum class Edit { CONSUMED, INSERT_TYPED }

    var typed: String = typed
        private set

    var suffix: String = ""
        private set

    var isSuppressed: Boolean = false
        private set

    val display: String get() = typed + suffix
    val hasSuffix: Boolean get() = suffix.isNotEmpty()

    fun receive(offer: CompletionOffer?): Boolean {
        offer ?: return false
        val before = suffix
        val completion = offer.completion
        if (isSuppressed || typed.isEmpty()) {
            suffix = ""
        } else if (completion != null && typed.startsWith(offer.query, ignoreCase = true) && completion.startsWith(typed, ignoreCase = true)) {
            suffix = completion.substring(typed.length)
        } else if (offer.query == typed) {
            suffix = ""
        }
        return before != suffix
    }

    fun insert(text: String): Edit {
        isSuppressed = false
        if (!hasSuffix || text.isEmpty()) return Edit.INSERT_TYPED
        if (suffix.startsWith(text, ignoreCase = true)) {
            typed += text
            suffix = suffix.substring(text.length)
            return Edit.CONSUMED
        }
        suffix = ""
        return Edit.INSERT_TYPED
    }

    fun deleteBackward(): Edit {
        isSuppressed = true
        if (!hasSuffix) return Edit.INSERT_TYPED
        suffix = ""
        return Edit.CONSUMED
    }

    fun accept() {
        typed += suffix
        suffix = ""
    }

    fun dropSuffix() {
        suffix = ""
    }

    fun reset(text: String) {
        typed = text
        suffix = ""
        isSuppressed = false
    }

    fun syncTyped(text: String) {
        if (text == typed) return
        typed = text
        suffix = ""
    }
}
