package com.ardia.browser.android.system

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.ardia.browser.android.MainActivity

class ShortcutActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching { startActivity(forward(this, intent)) }
        finish()
    }

    companion object {
        fun forward(context: Context, intent: Intent): Intent = Intent(intent)
            .setComponent(ComponentName(context, MainActivity::class.java))
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
