package com.ardia.browser.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.ardia.browser.DevelopmentWebViewEngine
import com.ardia.browser.Omnibox
import com.ardia.browser.Page
import com.ardia.browser.PageEngine
import com.ardia.browser.PageSetup
import com.ardia.browser.PageSurface
import com.ardia.design.ArdiaTheme
import com.ardia.design.Spacing
import com.ardia.shared.ScriptEngine
import com.ardia.shared.SharedScript

class MainActivity : ComponentActivity() {
    private lateinit var engine: PageEngine
    private lateinit var page: Page
    private lateinit var script: ScriptEngine

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        engine = DevelopmentWebViewEngine(this)
        engine.attach(this)
        script = ScriptEngine(assets, listOf(SharedScript.CORE))
        val omnibox = Omnibox(script)
        val start = intent.getStringExtra(EXTRA_URL) ?: START_URL
        page = engine.open("main", PageSetup(url = omnibox.resolve(start)?.url ?: start))
        setContent {
            ArdiaTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    BrowseScreen(page, engine, omnibox)
                }
            }
        }
    }

    override fun onDestroy() {
        engine.close("main")
        engine.detach(this)
        script.close()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val START_URL = "https://example.com"
    }
}

@Composable
private fun BrowseScreen(page: Page, engine: PageEngine, omnibox: Omnibox) {
    val state by page.state.collectAsState()
    var text by remember { mutableStateOf("") }
    BackHandler(enabled = state.canGoBack) { page.goBack() }
    Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.tight, vertical = Spacing.hairline).testTag("address"),
            singleLine = true,
            placeholder = { Text(state.url ?: "Search or enter address") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = {
                omnibox.resolve(text)?.let { page.load(it.url) }
                text = ""
            }),
        )
        if (state.isLoading) LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth())
        if (engine.isDevelopmentOnly) {
            Text(
                text = engine.name,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(horizontal = Spacing.page, vertical = Spacing.hairline).testTag("engine"),
            )
        }
        PageSurface(page, modifier = Modifier.fillMaxSize())
    }
}

