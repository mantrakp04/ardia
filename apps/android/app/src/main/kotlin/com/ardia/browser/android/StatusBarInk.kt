package com.ardia.browser.android

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.ardia.appmodel.AppModel
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.ProfileLook

object StatusBarInk {
    enum class Layer { Page, Search, Deck, Sheet, Cover }

    const val CONTRAST_MIDPOINT = 0.179f

    fun layer(model: AppModel): Layer = when {
        model.browse.isVoicePresented || model.settings.isShowingOnboarding -> Layer.Cover
        model.sheet != null && model.sheet != AppModel.Sheet.Onboarding -> Layer.Sheet
        model.surface == AppModel.Surface.Search || model.browse.search != null -> Layer.Search
        model.surface == AppModel.Surface.TabSwitcher -> Layer.Deck
        else -> Layer.Page
    }

    fun darkIcons(layer: Layer, look: ProfileLook, dark: Boolean, incognito: Boolean): Boolean? = when (layer) {
        Layer.Page -> null
        Layer.Cover -> isLight(look.backdropColors(dark, themed = false).first())
        Layer.Sheet -> isLight(Color.Black.copy(alpha = SheetLayout.SCRIM_ALPHA).compositeOver(look.surface.resolve(dark)))
        Layer.Search -> !incognito && isLight(look.surface.resolve(dark))
        Layer.Deck -> isLight(look.deckBase(dark).first())
    }

    fun isLight(color: Color): Boolean = color.luminance() > CONTRAST_MIDPOINT
}

@Composable
fun StatusBarInkOwner(model: AppModel) {
    val dark = LocalArdiaDarkTheme.current
    val wanted = StatusBarInk.darkIcons(StatusBarInk.layer(model), model.look, dark, model.isIncognito)
    val context = LocalContext.current
    val view = LocalView.current
    DisposableEffect(wanted) {
        val window = context.findActivity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val previous = controller?.isAppearanceLightStatusBars
        if (wanted != null) controller?.isAppearanceLightStatusBars = wanted
        onDispose { if (wanted != null && previous != null) controller.isAppearanceLightStatusBars = previous }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
