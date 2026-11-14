package com.ardia.browsing

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ardia.browser.Page
import com.ardia.browser.ReadableContent
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.Palette
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.ardiaColor
import com.ardia.design.medium
import com.ardia.design.semibold
import com.ardia.browser.BrowserUrl as WebUrl
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class ReaderTheme(val key: String, val background: Color, val ink: Color) {
    Light("light", Color.White, ardiaColor(0x1C1C1E)),
    Sepia("sepia", ardiaColor(0xF8F1E3), ardiaColor(0x4F321C)),
    Dark("dark", ardiaColor(0x121214), ardiaColor(0xE3E3E6)),
    ;

    val secondary: Color get() = ink.copy(alpha = 0.6f)

    val usesDarkStatusIcons: Boolean get() = this != Dark

    companion object {
        fun resolve(stored: String?, systemDark: Boolean): ReaderTheme = entries.firstOrNull { it.key == stored } ?: if (systemDark) Dark else Light
    }
}

object ReaderSizes {
    val steps = listOf(0.8f, 0.9f, 1f, 1.12f, 1.25f, 1.4f, 1.6f)
    const val DEFAULT_STEP = 2
    const val BASE_SP = 19f

    fun clamp(step: Int): Int = step.coerceIn(0, steps.lastIndex)

    fun bodySize(step: Int): Float = BASE_SP * steps[clamp(step)]
}

internal class ReaderSettings(context: Context) {
    private val store = context.applicationContext.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    var step by mutableIntStateOf(ReaderSizes.clamp(store.getInt(KEY_STEP, ReaderSizes.DEFAULT_STEP)))
        private set
    var serif by mutableStateOf(store.getBoolean(KEY_SERIF, true))
        private set
    var theme by mutableStateOf(store.getString(KEY_THEME, null))
        private set

    fun changeStep(value: Int) {
        step = ReaderSizes.clamp(value)
        store.edit().putInt(KEY_STEP, step).apply()
    }

    fun changeSerif(value: Boolean) {
        serif = value
        store.edit().putBoolean(KEY_SERIF, value).apply()
    }

    fun changeTheme(value: ReaderTheme) {
        theme = value.key
        store.edit().putString(KEY_THEME, value.key).apply()
    }

    companion object {
        const val STORE = "ardia.reader"
        const val KEY_STEP = "reader.sizeStep"
        const val KEY_SERIF = "reader.serif"
        const val KEY_THEME = "reader.theme"
    }
}

private sealed interface ReaderLoad {
    data object Loading : ReaderLoad

    data object Failed : ReaderLoad

    data class Loaded(val content: ReadableContent) : ReaderLoad
}

@Composable
internal fun rememberReaderSettings(): ReaderSettings {
    val context = LocalContext.current
    return remember(context) { ReaderSettings(context) }
}

@Composable
internal fun ReaderView(page: Page?, settings: ReaderSettings, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val theme = ReaderTheme.resolve(settings.theme, LocalArdiaDarkTheme.current)
    var load by remember(page) { mutableStateOf<ReaderLoad>(ReaderLoad.Loading) }
    LaunchedEffect(page) {
        load = if (page == null) {
            ReaderLoad.Failed
        } else {
            runCatching { page.readableContent() }.getOrNull()?.takeIf { it.paragraphs.isNotEmpty() }?.let { ReaderLoad.Loaded(it) } ?: ReaderLoad.Failed
        }
    }
    Column(modifier.testTag(BrowsingTags.READER).fillMaxSize().background(theme.background).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.tight).heightIn(min = 52.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (load is ReaderLoad.Loaded) AppearanceMenu(settings, theme)
            Box(Modifier.weight(1f))
            Box(
                Modifier
                    .heightIn(min = 44.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .clickable(role = Role.Button, onClick = onDone)
                    .padding(horizontal = Spacing.small),
                contentAlignment = Alignment.Center,
            ) {
                Text(stringResource(R.string.browsing_done), style = ArdiaType.body.semibold, color = Palette.formAccent.current)
            }
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            when (val state = load) {
                ReaderLoad.Loading -> {
                    val label = stringResource(R.string.browsing_loading_article)
                    CircularProgressIndicator(Modifier.size(28.dp).semantics { contentDescription = label }, color = theme.secondary, strokeWidth = 2.5.dp)
                }
                ReaderLoad.Failed -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    Icon(ArdiaSymbols.docPlaintext, null, Modifier.size(44.dp), tint = theme.secondary)
                    Text(stringResource(R.string.browsing_no_article), style = ArdiaType.title3.semibold, color = theme.ink)
                }
                is ReaderLoad.Loaded -> Article(state.content, settings, theme)
            }
        }
    }
}

@Composable
private fun Article(content: ReadableContent, settings: ReaderSettings, theme: ReaderTheme) {
    val size by animateFloatAsState(ReaderSizes.bodySize(settings.step), label = "readerSize")
    val family = if (settings.serif) FontFamily.Serif else FontFamily.SansSerif
    val body = TextStyle(fontFamily = family, fontSize = size.sp, lineHeight = (size * 1.52f).sp, color = theme.ink)
    SelectionContainer {
        LazyColumn(
            Modifier.fillMaxSize().navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item(key = "header") {
                Header(content, theme, family, size, Modifier.widthIn(max = 680.dp).fillMaxWidth().padding(horizontal = Spacing.medium).padding(top = Spacing.tight))
            }
            content.leadImage?.takeIf { WebUrl.isWeb(it) }?.let { url ->
                item(key = "lead") { LeadImage(url, Modifier.widthIn(max = 680.dp).fillMaxWidth().padding(horizontal = Spacing.medium).padding(bottom = size.dp)) }
            }
            itemsIndexed(content.paragraphs, key = { index, _ -> index }) { index, paragraph ->
                val last = index == content.paragraphs.lastIndex
                Text(
                    paragraph,
                    style = body,
                    modifier = Modifier
                        .widthIn(max = 680.dp)
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.medium)
                        .padding(bottom = if (last) Spacing.section else (size * 0.9f).dp),
                )
            }
        }
    }
}

@Composable
private fun Header(content: ReadableContent, theme: ReaderTheme, family: FontFamily, size: Float, modifier: Modifier) {
    Column(modifier.padding(bottom = (size * 1.2f).dp), verticalArrangement = Arrangement.spacedBy(Spacing.tight)) {
        PageMenuText.readerSource(content.siteName, content.byline)?.let {
            Text(it, style = ArdiaType.subheadline.medium, color = theme.secondary, maxLines = 2)
        }
        Text(
            content.title,
            style = TextStyle(fontFamily = family, fontWeight = FontWeight.Bold, fontSize = (size * 1.55f).sp, lineHeight = (size * 1.55f * 1.2f).sp),
            color = theme.ink,
            modifier = Modifier.semantics { heading() },
        )
        if (content.wordCount > 0) {
            Text(stringResource(R.string.browsing_minutes_read, PageMenuText.readingMinutes(content.wordCount)), style = ArdiaType.subheadline, color = theme.secondary)
        }
    }
}

@Composable
private fun LeadImage(url: String, modifier: Modifier) {
    var image by remember(url) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(url) { image = withContext(Dispatchers.IO) { LeadImageLoader.load(url) } }
    val loaded = image ?: return
    val bitmap = remember(loaded) { loaded.asImageBitmap() }
    Image(bitmap, null, modifier.clip(RoundedCornerShape(10.dp)).clearAndSetSemantics {}, contentScale = ContentScale.FillWidth)
}

private object LeadImageLoader {
    private const val MAX_BYTES = 8 * 1024 * 1024
    private const val MAX_WIDTH = 1400

    fun load(url: String): Bitmap? = runCatching {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 8_000
        connection.readTimeout = 10_000
        connection.instanceFollowRedirects = true
        try {
            if (connection.responseCode !in 200..299) return null
            val bytes = connection.inputStream.use { input ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(16 * 1024)
                while (true) {
                    val read = input.read(chunk)
                    if (read < 0) break
                    buffer.write(chunk, 0, read)
                    if (buffer.size() > MAX_BYTES) return null
                }
                buffer.toByteArray()
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= MAX_WIDTH) sample *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        } finally {
            connection.disconnect()
        }
    }.getOrNull()
}

@Composable
private fun AppearanceMenu(settings: ReaderSettings, theme: ReaderTheme) {
    var expanded by remember { mutableStateOf(false) }
    val label = stringResource(R.string.browsing_text_appearance)
    Box {
        Box(
            Modifier
                .size(44.dp)
                .clip(RoundedCornerShape(22.dp))
                .clickable(role = Role.Button) { expanded = true }
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(ArdiaSymbols.textformatSize, null, Modifier.size(22.dp), tint = Palette.formAccent.current)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.browsing_smaller_text)) },
                leadingIcon = { Icon(ArdiaSymbols.textformatSizeSmaller, null, Modifier.size(18.dp)) },
                enabled = settings.step > 0,
                onClick = { settings.changeStep(settings.step - 1) },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.browsing_larger_text)) },
                leadingIcon = { Icon(ArdiaSymbols.textformatSizeLarger, null, Modifier.size(18.dp)) },
                enabled = settings.step < ReaderSizes.steps.lastIndex,
                onClick = { settings.changeStep(settings.step + 1) },
            )
            HorizontalDivider()
            MenuHeading(stringResource(R.string.browsing_font))
            CheckItem(stringResource(R.string.browsing_font_serif), settings.serif) { settings.changeSerif(true) }
            CheckItem(stringResource(R.string.browsing_font_sans), !settings.serif) { settings.changeSerif(false) }
            HorizontalDivider()
            MenuHeading(stringResource(R.string.browsing_theme))
            CheckItem(stringResource(R.string.browsing_theme_light), theme == ReaderTheme.Light) { settings.changeTheme(ReaderTheme.Light) }
            CheckItem(stringResource(R.string.browsing_theme_sepia), theme == ReaderTheme.Sepia) { settings.changeTheme(ReaderTheme.Sepia) }
            CheckItem(stringResource(R.string.browsing_theme_dark), theme == ReaderTheme.Dark) { settings.changeTheme(ReaderTheme.Dark) }
        }
    }
}

@Composable
private fun MenuHeading(text: String) {
    Text(text, style = ArdiaType.footnote, color = SystemPalette.secondaryLabel.current, modifier = Modifier.padding(horizontal = Spacing.page, vertical = Spacing.hairline))
}

@Composable
private fun CheckItem(text: String, checked: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(text) },
        trailingIcon = if (checked) ({ Icon(ArdiaSymbols.checkmark, null, Modifier.size(16.dp)) }) else null,
        onClick = onClick,
    )
}
