package com.ardia.settings

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.ProfileBackdrop
import com.ardia.design.Radius
import com.ardia.design.SettingsTint
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.bold
import com.ardia.design.ardiaGradient

@Composable
fun DefaultBrowserPage(nav: SettingsNav) {
    Box(Modifier.fillMaxSize()) {
        ProfileBackdrop(Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize()) {
            SettingsTopBar(stringResource(R.string.settings_default_browser), onBack = nav::pop)
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(settingsContentPadding())
                    .padding(start = Spacing.page + 4.dp, end = Spacing.page + 4.dp, top = Spacing.large),
            ) {
                DefaultBrowserInstructions(nav.model)
            }
        }
    }
}

@Composable
fun DefaultBrowserInstructions(model: AppModel, modifier: Modifier = Modifier, onLater: (() -> Unit)? = null, onDone: (() -> Unit)? = null) {
    val status = model.defaultBrowser
    val isHeld = status.isDefault
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        model.browserRoleAnswered()
        if (status.isDefault) onDone?.invoke()
    }
    val asksForRole = status.isOffered || model.isDemo
    val actionTitle = stringResource(if (asksForRole) R.string.default_set else R.string.default_open_apps)
    val ask: () -> Unit = {
        try {
            model.requestBrowserRole(launcher::launch)
        } catch (missing: ActivityNotFoundException) {
            onLater?.invoke()
        }
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.large), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.small), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                stringResource(if (isHeld) R.string.default_done_title else R.string.default_title),
                style = ArdiaType.title.bold,
                color = SystemPalette.label.current,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                stringResource(if (isHeld) R.string.default_done_subtitle else R.string.default_subtitle),
                style = ArdiaType.body,
                color = SystemPalette.secondaryLabel.current,
                textAlign = TextAlign.Center,
            )
        }

        if (!isHeld) {
            val steps = listOf(
                stringResource(R.string.default_step_tap, actionTitle),
                stringResource(if (asksForRole) R.string.default_step_select else R.string.default_step_choose),
            )
            if (LocalDensity.current.fontScale >= ACCESSIBILITY_FONT_SCALE) {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    steps.forEachIndexed { index, step ->
                        Text(stringResource(R.string.default_step_numbered, index + 1, step), style = ArdiaType.body, color = SystemPalette.label.current)
                    }
                }
            } else {
                StepsCard(steps)
            }
        }

        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            if (isHeld) {
                if (onLater != null) PrimaryActionButton(stringResource(R.string.onboarding_continue), onClick = onLater)
            } else {
                PrimaryActionButton(actionTitle, onClick = ask, modifier = Modifier.testTag(SettingsTags.row("setDefault")))
                if (onLater != null) SecondaryActionButton(stringResource(R.string.default_maybe_later), onClick = onLater)
            }
        }
    }
}

@Composable
private fun StepsCard(steps: List<String>) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.field))
            .background(SystemPalette.secondaryGroupedBackground.current),
    ) {
        steps.forEachIndexed { index, step ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                    .semantics(mergeDescendants = true) {}
                    .padding(horizontal = Spacing.page, vertical = Spacing.hairline),
                horizontalArrangement = Arrangement.spacedBy(Spacing.small + 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.widthIn(min = 29.dp), contentAlignment = Alignment.Center) {
                    if (index == steps.lastIndex) {
                        AppIcon()
                    } else {
                        Box(
                            Modifier.size(29.dp).clip(RoundedCornerShape(7.dp)).background(SettingsTint.defaultBrowser.ardiaGradient()),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(ArdiaSymbols.handPointUpLeftFill, null, Modifier.size(18.dp), tint = Color.White)
                        }
                    }
                }
                Text(stringResource(R.string.default_step_numbered, index + 1, step), style = ArdiaType.body, color = SystemPalette.label.current)
            }
            if (index < steps.lastIndex) RowDivider(56.dp)
        }
    }
}
