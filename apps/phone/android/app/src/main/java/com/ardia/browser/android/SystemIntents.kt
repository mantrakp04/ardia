package com.ardia.browser.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.ardia.appmodel.SystemLink

object SystemIntents {
    fun main(context: Context, link: SystemLink): Intent = main(context, link.uri)

    fun main(context: Context, uri: String): Intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
        .setClass(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
