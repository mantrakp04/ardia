package com.ardia.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

object ColorChoice {
    const val PREFERENCE_KEY = "settings.color"

    val side = 26.dp
    val ringGap = 3.dp
    val ringWidth = 2.dp
    val hitHeight = 44.dp

    fun matchesMac(colorChoice: String?): Boolean = colorChoice == null

    fun choiceAfterMatchToggle(matches: Boolean, look: ProfileLook): String? =
        if (matches) null else (look.preset ?: ProfileLook.Preset.Plum).key

    fun choiceFor(preset: ProfileLook.Preset): String = preset.key
}

@Composable
fun ColorSwatch(color: Color, isSelected: Boolean, modifier: Modifier = Modifier) {
    val ring by animateFloatAsState(if (isSelected) 1f else 0f, Motion.snappy.spec(), label = "swatchRing")
    Box(
        modifier
            .size(ColorChoice.side + (ColorChoice.ringGap + ColorChoice.ringWidth) * 2)
            .border(ColorChoice.ringWidth, color.copy(alpha = color.alpha * ring), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(ColorChoice.side).background(color, CircleShape))
    }
}

@Composable
fun ColorChoiceRow(look: ProfileLook, onChoose: (ProfileLook.Preset) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.padding(vertical = Spacing.hairline), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
        SettingsRowLabel(stringResource(R.string.ardia_color), ArdiaSymbols.paintpaletteFill, look.swatchColor)
        Row(Modifier.fillMaxWidth()) {
            val selected = look.preset
            for (preset in ProfileLook.Preset.entries) {
                val title = stringResource(preset.title)
                val swatch = remember(preset) { ProfileLook.of(preset).swatchColor }
                Box(
                    Modifier
                        .weight(1f)
                        .heightIn(min = ColorChoice.hitHeight)
                        .selectable(
                            selected = selected == preset,
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            role = Role.RadioButton,
                            onClick = { onChoose(preset) },
                        )
                        .semantics { contentDescription = title },
                    contentAlignment = Alignment.Center,
                ) {
                    ColorSwatch(swatch, isSelected = selected == preset)
                }
            }
        }
    }
}

@Composable
fun MatchMyMacRow(colorChoice: String?, look: ProfileLook, onColorChoice: (String?) -> Unit, modifier: Modifier = Modifier) {
    val matches = ColorChoice.matchesMac(colorChoice)
    SettingsRow(
        modifier = modifier,
        onClick = { onColorChoice(ColorChoice.choiceAfterMatchToggle(!matches, look)) },
        trailing = {
            SettingsSwitch(checked = matches, onCheckedChange = { onColorChoice(ColorChoice.choiceAfterMatchToggle(it, look)) })
        },
    ) {
        SettingsRowLabel(stringResource(R.string.ardia_match_my_mac), ArdiaSymbols.macbook, SettingsTint.neutral)
    }
}

@Composable
fun ColorChoiceRows(
    look: ProfileLook,
    colorChoice: String?,
    syncEnabled: Boolean,
    onColorChoice: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        SettingsRow(showsDivider = syncEnabled) {
            ColorChoiceRow(look, onChoose = { onColorChoice(ColorChoice.choiceFor(it)) }, modifier = Modifier.fillMaxWidth())
        }
        if (syncEnabled) MatchMyMacRow(colorChoice, look, onColorChoice)
    }
}
