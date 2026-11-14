package com.ardia.browser.android.system

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.color.ColorProvider as DayNightColorProvider
import androidx.glance.unit.ColorProvider
import com.ardia.appmodel.SystemLink
import com.ardia.browser.android.R
import com.ardia.browser.android.SystemIntents
import com.ardia.design.Monogram
import com.ardia.design.ProfileLook
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object ArdiaWidgets {
    suspend fun refreshSearch(context: Context) {
        runCatching { SearchWidget().updateAll(context) }
    }

    suspend fun refreshMacTabs(context: Context) {
        runCatching { MacTabsWidget().updateAll(context) }
    }

    fun isDark(context: Context): Boolean =
        context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

    fun open(context: Context, link: SystemLink): Action = actionStartActivity(SystemIntents.main(context, link))

    fun open(context: Context, uri: String): Action = actionStartActivity(SystemIntents.main(context, uri))

    fun backdrop(look: ProfileLook, dark: Boolean, themed: Boolean, softened: Boolean): Bitmap {
        val colors = look.backdropColors(dark, themed).map { it.toArgb() }.toIntArray()
        val bitmap = Bitmap.createBitmap(BACKDROP_WIDTH, BACKDROP_HEIGHT, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val diagonal = look.showsTheme(dark, themed)
        val endX = if (diagonal) BACKDROP_WIDTH.toFloat() else 0f
        paint.shader = if (colors.size >= 2) {
            LinearGradient(0f, 0f, endX, BACKDROP_HEIGHT.toFloat(), colors, null, Shader.TileMode.CLAMP)
        } else {
            null
        }
        if (colors.size < 2) paint.color = colors.firstOrNull() ?: android.graphics.Color.WHITE
        canvas.drawRect(0f, 0f, BACKDROP_WIDTH.toFloat(), BACKDROP_HEIGHT.toFloat(), paint)
        if (softened) canvas.drawColor(if (dark) Color.Black.copy(alpha = 0.55f).toArgb() else Color.White.copy(alpha = 0.72f).toArgb())
        return bitmap
    }

    val label = DayNightColorProvider(day = Color.Black, night = Color.White)
    val secondaryLabel = DayNightColorProvider(day = Color(0x993C3C43), night = Color(0x99EBEBF5))
    val accent = DayNightColorProvider(day = Color(0xFF007AFF), night = Color(0xFF0A84FF))
    val monogramFill = DayNightColorProvider(day = Color(0x14787880), night = Color(0x29787880))
    val inkOnLightBackdrop = Color(0xE60E0F10)

    const val BACKDROP_WIDTH = 120
    const val BACKDROP_HEIGHT = 120
}

class SearchWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = withContext(Dispatchers.IO) { SystemStore.shared(context).loadSnapshot() }
        val dark = ArdiaWidgets.isDark(context)
        val look = snapshot.look
        val backdrop = ArdiaWidgets.backdrop(look, dark, themed = true, softened = false)
        val inkIsLight = look.inkIsLight(dark, themed = true)
        provideContent { SearchWidgetContent(backdrop, inkIsLight) }
    }

    companion object {
        val SMALL = DpSize(110.dp, 110.dp)
        val MEDIUM = DpSize(250.dp, 110.dp)
    }
}

@Composable
private fun SearchWidgetContent(backdrop: Bitmap, inkIsLight: Boolean) {
    val context = LocalContext.current
    val isSmall = LocalSize.current.width < SearchWidget.MEDIUM.width
    val ink = if (inkIsLight) Color.White else ArdiaWidgets.inkOnLightBackdrop
    val inkProvider = ColorProvider(ink)
    val capsule = ColorProvider(ink.copy(alpha = 0.08f))
    Box(GlanceModifier.fillMaxSize().background(ImageProvider(backdrop)).cornerRadius(26.dp)) {
        Column(GlanceModifier.fillMaxSize().padding(16.dp)) {
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Image(ImageProvider(R.drawable.ardia_logo), contentDescription = null, modifier = GlanceModifier.size(46.dp, 37.dp))
                Spacer(GlanceModifier.defaultWeight())
                if (!isSmall) {
                    Text(
                        context.getString(R.string.app_name),
                        style = TextStyle(color = ColorProvider(ink.copy(alpha = 0.85f)), fontSize = 15.sp, fontWeight = FontWeight.Bold),
                    )
                }
            }
            Spacer(GlanceModifier.defaultWeight())
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    GlanceModifier
                        .defaultWeight()
                        .height(44.dp)
                        .background(ImageProvider(R.drawable.widget_capsule), colorFilter = ColorFilter.tint(capsule))
                        .padding(horizontal = 14.dp)
                        .clickable(ArdiaWidgets.open(context, SystemLink.Search(null)))
                        .semantics { contentDescription = context.getString(R.string.widget_search) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Image(
                        ImageProvider(R.drawable.ic_shortcut_search),
                        contentDescription = null,
                        modifier = GlanceModifier.size(16.dp),
                        colorFilter = ColorFilter.tint(inkProvider),
                    )
                    Spacer(GlanceModifier.width(6.dp))
                    Text(
                        context.getString(if (isSmall) R.string.widget_search else R.string.widget_search_or_enter_address),
                        maxLines = 1,
                        style = TextStyle(color = inkProvider, fontSize = 15.sp, fontWeight = FontWeight.Medium),
                    )
                }
                if (!isSmall) {
                    Spacer(GlanceModifier.width(8.dp))
                    Box(
                        GlanceModifier
                            .size(44.dp)
                            .background(ImageProvider(R.drawable.widget_circle), colorFilter = ColorFilter.tint(capsule))
                            .clickable(ArdiaWidgets.open(context, SystemLink.VoiceSearch))
                            .semantics { contentDescription = context.getString(R.string.widget_voice_search) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(
                            ImageProvider(R.drawable.ic_shortcut_voice),
                            contentDescription = null,
                            modifier = GlanceModifier.size(18.dp),
                            colorFilter = ColorFilter.tint(inkProvider),
                        )
                    }
                }
            }
        }
    }
}

class MacTabsWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(MEDIUM, LARGE))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = SystemStore.shared(context)
        val snapshot = withContext(Dispatchers.IO) { store.loadSnapshot() }
        val icons = withContext(Dispatchers.IO) {
            snapshot.macTabs.flatMap { it.tabs }.mapNotNull { tab ->
                val name = tab.favicon ?: return@mapNotNull null
                val file = store.favicon(name)
                if (!file.isFile) return@mapNotNull null
                BitmapFactory.decodeFile(file.path)?.let { name to it }
            }.toMap()
        }
        val look = snapshot.look
        val backdrop = ArdiaWidgets.backdrop(look, ArdiaWidgets.isDark(context), themed = false, softened = true)
        provideContent { MacTabsWidgetContent(snapshot, icons, backdrop) }
    }

    companion object {
        val MEDIUM = DpSize(250.dp, 110.dp)
        val LARGE = DpSize(250.dp, 260.dp)
        const val MEDIUM_ROWS = 3
        const val LARGE_ROWS = 7

        fun sections(snapshot: SystemSnapshot, rowLimit: Int, large: Boolean): List<SystemDeviceTabs> {
            var remaining = rowLimit
            val result = ArrayList<SystemDeviceTabs>()
            for (group in snapshot.macTabs) {
                if (group.tabs.isEmpty()) continue
                if (remaining <= (if (result.isEmpty()) 0 else 1)) break
                if (result.isNotEmpty()) remaining -= 1
                val tabs = group.tabs.take(remaining)
                remaining -= tabs.size
                result.add(SystemDeviceTabs(group.device, tabs))
                if (!large) break
            }
            return result
        }
    }
}

@Composable
private fun MacTabsWidgetContent(snapshot: SystemSnapshot, icons: Map<String, Bitmap>, backdrop: Bitmap) {
    val context = LocalContext.current
    val large = LocalSize.current.height >= MacTabsWidget.LARGE.height
    Box(GlanceModifier.fillMaxSize().background(ImageProvider(backdrop)).cornerRadius(26.dp).padding(16.dp)) {
        when {
            !snapshot.isSyncEnabled -> MacTabsEmpty(R.string.widget_mac_tabs_sync_title, R.string.widget_mac_tabs_sync_message, R.drawable.ic_shortcut_mac_tabs, large)
            !snapshot.hasMacTabs -> MacTabsEmpty(R.string.widget_mac_tabs_empty_title, R.string.widget_mac_tabs_empty_message, R.drawable.ic_shortcut_mac_tabs, large)
            else -> Column(GlanceModifier.fillMaxSize()) {
                val sections = MacTabsWidget.sections(snapshot, if (large) MacTabsWidget.LARGE_ROWS else MacTabsWidget.MEDIUM_ROWS, large)
                sections.forEachIndexed { index, section ->
                    if (index > 0) Spacer(GlanceModifier.height(10.dp))
                    Row(
                        GlanceModifier.fillMaxWidth().clickable(ArdiaWidgets.open(context, SystemLink.MacTabs)),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Image(
                            ImageProvider(R.drawable.ic_shortcut_mac_tabs),
                            contentDescription = null,
                            modifier = GlanceModifier.size(14.dp),
                            colorFilter = ColorFilter.tint(ArdiaWidgets.accent),
                        )
                        Spacer(GlanceModifier.width(5.dp))
                        Text(
                            section.device.name,
                            maxLines = 1,
                            modifier = GlanceModifier.defaultWeight(),
                            style = TextStyle(color = ArdiaWidgets.accent, fontSize = 12.sp, fontWeight = FontWeight.Medium),
                        )
                        Image(ImageProvider(R.drawable.ardia_logo_plain), contentDescription = null, modifier = GlanceModifier.size(18.dp, 14.dp))
                    }
                    section.tabs.forEach { tab ->
                        Spacer(GlanceModifier.height(10.dp))
                        MacTabRow(tab, tab.favicon?.let(icons::get))
                    }
                }
            }
        }
    }
}

@Composable
private fun MacTabRow(tab: SystemTab, icon: Bitmap?) {
    val context = LocalContext.current
    Row(
        GlanceModifier.fillMaxWidth().clickable(ArdiaWidgets.open(context, SystemLink.Open(tab.url))),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Image(ImageProvider(icon), contentDescription = null, modifier = GlanceModifier.size(22.dp).cornerRadius(5.dp))
        } else {
            Box(GlanceModifier.size(22.dp).background(ArdiaWidgets.monogramFill).cornerRadius(5.dp), contentAlignment = Alignment.Center) {
                Text(
                    Monogram.host(tab.url)?.take(1)?.uppercase().orEmpty(),
                    style = TextStyle(color = ArdiaWidgets.secondaryLabel, fontSize = 12.sp, fontWeight = FontWeight.Medium),
                )
            }
        }
        Spacer(GlanceModifier.width(10.dp))
        Column(GlanceModifier.defaultWeight()) {
            Text(tab.displayTitle, maxLines = 1, style = TextStyle(color = ArdiaWidgets.label, fontSize = 15.sp, fontWeight = FontWeight.Medium))
            tab.host?.let { Text(it, maxLines = 1, style = TextStyle(color = ArdiaWidgets.secondaryLabel, fontSize = 11.sp)) }
        }
    }
}

@Composable
private fun MacTabsEmpty(title: Int, message: Int, icon: Int, large: Boolean) {
    val context = LocalContext.current
    Column(GlanceModifier.fillMaxSize().clickable(ArdiaWidgets.open(context, SystemLink.MacTabs))) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Image(ImageProvider(icon), contentDescription = null, modifier = GlanceModifier.size(26.dp), colorFilter = ColorFilter.tint(ArdiaWidgets.accent))
            Spacer(GlanceModifier.defaultWeight())
            Image(ImageProvider(R.drawable.ardia_logo), contentDescription = null, modifier = GlanceModifier.size(32.dp, 26.dp))
        }
        Spacer(GlanceModifier.defaultWeight())
        Text(context.getString(title), style = TextStyle(color = ArdiaWidgets.label, fontSize = 17.sp, fontWeight = FontWeight.Bold))
        Text(context.getString(message), maxLines = if (large) 4 else 2, style = TextStyle(color = ArdiaWidgets.secondaryLabel, fontSize = 15.sp))
    }
}

class SearchWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SearchWidget()
}

class MacTabsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = MacTabsWidget()
}
