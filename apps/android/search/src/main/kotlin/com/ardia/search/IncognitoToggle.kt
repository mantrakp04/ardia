package com.ardia.search

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.BrowsePalette
import com.ardia.design.Motion
import com.ardia.design.medium

@Composable
internal fun IncognitoToggle(isOn: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val label = stringResource(if (isOn) R.string.search_deactivate_incognito else R.string.search_activate_incognito)
    val interaction = remember { MutableInteractionSource() }
    Row(
        modifier
            .clickable(interactionSource = interaction, indication = null, onClick = onToggle)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick {
                    onToggle()
                    true
                }
            }
            .padding(horizontal = 6.dp)
            .defaultMinSize(minWidth = 36.dp, minHeight = 40.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedVisibility(
            visible = isOn,
            enter = fadeIn(Motion.modeToggle.spec()) + scaleIn(Motion.modeToggle.spec(), initialScale = 0.9f, transformOrigin = TransformOrigin(1f, 0.5f)),
            exit = fadeOut(Motion.modeToggle.spec()) + scaleOut(Motion.modeToggle.spec(), targetScale = 0.9f, transformOrigin = TransformOrigin(1f, 0.5f)),
        ) {
            Text(stringResource(R.string.search_incognito), style = ArdiaType.footnote.medium, color = Color.White.copy(alpha = 0.75f), maxLines = 1)
        }
        Icon(
            ArdiaSymbols.eyeglasses,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = if (isOn) Color.White.copy(alpha = 0.85f) else BrowsePalette.foregroundTertiary.current,
        )
    }
}
