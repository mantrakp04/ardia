package com.ardia.browser.android.share

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.remember
import com.ardia.browser.android.ArdiaApplication
import com.ardia.browser.android.SystemIntents
import com.ardia.browser.android.system.SystemDevice
import com.ardia.browser.android.system.SystemStore
import com.ardia.design.ArdiaTheme

class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val page = sharedPage(intent)
        val snapshot = SystemStore.shared(this).loadSnapshot()
        val app = ArdiaApplication.of(this)
        setContent {
            val model = remember {
                ShareSheetModel(
                    page = page,
                    snapshot = snapshot,
                    scope = app.appScope,
                    open = ::openInMain,
                    send = { shared, device -> sendFromShare(app, shared, device) },
                    finish = ::finish,
                    cancel = ::finish,
                )
            }
            ArdiaTheme(darkTheme = isSystemInDarkTheme(), look = snapshot.look) {
                ShareSheetView(model)
            }
        }
    }

    private fun openInMain(uri: String): Boolean = try {
        startActivity(SystemIntents.main(this, uri))
        true
    } catch (missing: ActivityNotFoundException) {
        false
    }

    companion object {
        suspend fun sendFromShare(app: ArdiaApplication, page: SharedPage, device: SystemDevice): Boolean {
            val url = page.url ?: return false
            return app.model().sendFromShare(url, page.displayTitle, device.id)
        }

        fun sharedPage(intent: Intent?): SharedPage {
            val text = intent?.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            val subject = intent?.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent?.getStringExtra(Intent.EXTRA_TITLE)
            return SharedPage.from(text, subject)
        }
    }
}
