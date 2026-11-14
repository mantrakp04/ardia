package com.ardia.phone

import android.content.Context
import com.ardia.search.ClipboardOffer
import com.ardia.search.ClipboardOffers

object ClipboardPayloads {
    fun offer(context: Context): String? = when (ClipboardOffers.peek(context)) {
        ClipboardOffer.Link -> "link"
        ClipboardOffer.Text -> "text"
        null -> null
    }
}
