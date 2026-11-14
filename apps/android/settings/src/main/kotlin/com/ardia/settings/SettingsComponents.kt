package com.ardia.settings

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.Palette
import com.ardia.design.ProfileBackdrop
import com.ardia.design.SettingsChrome
import com.ardia.design.SettingsLayout
import com.ardia.design.SettingsRow
import com.ardia.design.SettingsRowLabel
import com.ardia.design.SettingsSwitch
import com.ardia.design.SettingsTile
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.bold
import com.ardia.design.legibleInk
import com.ardia.design.semibold

object SettingsTags {
    const val ROOT = "settings.root"
    const val BACK = "settings.back"
    const val DONE = "settings.done"
    const val CONFIRM = "settings.confirm"

    fun row(name: String) = "settings.row.$name"

    fun toggle(name: String) = "settings.toggle.$name"
}

val SettingsIconDivider: Dp = SettingsLayout.rowInset + SettingsTile.side + SettingsLayout.labelGap

@Composable
fun SettingsTopBar(
    title: String,
    modifier: Modifier = Modifier,
    showsTitle: Boolean = true,
    onBack: (() -> Unit)? = null,
    leading: (@Composable RowScope.() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val titleAlpha by animateFloatAsState(if (showsTitle) 1f else 0f, label = "settingsTitle")
    Box(
        modifier
            .fillMaxWidth()
            .background(SettingsChrome.topBarColor)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.tight),
    ) {
        Row(Modifier.align(Alignment.CenterStart), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) {
                Box(
                    Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(22.dp))
                        .clickable(role = Role.Button, onClick = onBack)
                        .testTag(SettingsTags.BACK),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(ArdiaSymbols.chevronLeft, stringResource(R.string.settings_back), Modifier.size(22.dp), tint = Palette.formAccent.current)
                }
            }
            leading?.invoke(this)
        }
        Text(
            title,
            style = ArdiaType.body.semibold,
            color = SystemPalette.label.current,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(Alignment.Center)
                .widthIn(max = 240.dp)
                .graphicsLayer { alpha = titleAlpha }
                .semantics { heading() },
        )
        if (trailing != null) {
            Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically, content = trailing)
        }
    }
}

@Composable
fun BarTextButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, emphasized: Boolean = false) {
    TextButton(onClick = onClick, enabled = enabled, modifier = modifier) {
        Text(
            text,
            style = if (emphasized) ArdiaType.body.semibold else ArdiaType.body,
            color = if (enabled) Palette.formAccent.current else SystemPalette.tertiaryLabel.current,
        )
    }
}

@Composable
fun SettingsPage(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    state: LazyListState = rememberLazyListState(),
    showsTitle: Boolean = true,
    itemSpacing: Dp = Spacing.large,
    leading: (@Composable RowScope.() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    Box(modifier.fillMaxSize()) {
        ProfileBackdrop(Modifier.fillMaxSize())
        Column(Modifier.fillMaxSize()) {
            SettingsTopBar(title, showsTitle = showsTitle, onBack = onBack, leading = leading, trailing = trailing)
            LazyColumn(
                Modifier.fillMaxSize(),
                state = state,
                contentPadding = settingsContentPadding(),
                verticalArrangement = Arrangement.spacedBy(itemSpacing),
                content = content,
            )
        }
    }
}

@Composable
fun settingsContentPadding(): PaddingValues {
    val insets = WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal).union(WindowInsets.ime).asPaddingValues()
    return PaddingValues(top = Spacing.small, bottom = insets.calculateBottomPadding() + Spacing.section)
}

@Composable
fun SettingsValueText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = ArdiaType.body, color = SystemPalette.secondaryLabel.current, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)
}

@Composable
fun Chevron() {
    Icon(ArdiaSymbols.chevronRight, null, Modifier.size(14.dp), tint = SystemPalette.tertiaryLabel.current)
}

@Composable
fun NavigationRow(
    title: String,
    icon: ImageVector?,
    tint: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    value: String? = null,
    showsDivider: Boolean = false,
    tag: String? = null,
) {
    SettingsRow(
        modifier = modifier.let { if (tag != null) it.testTag(SettingsTags.row(tag)) else it },
        onClick = onClick,
        showsDivider = showsDivider,
        dividerInset = if (icon != null) SettingsIconDivider else SettingsLayout.rowInset,
        trailing = {
            if (value != null) SettingsValueText(value)
            Spacer(Modifier.size(Spacing.hairline))
            Chevron()
        },
    ) {
        if (icon != null) SettingsRowLabel(title, icon, tint) else Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
    }
}

@Composable
fun ToggleRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    tint: Color = Color.Unspecified,
    showsDivider: Boolean = false,
    tag: String? = null,
) {
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = SettingsLayout.rowMinHeight)
                .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)
                .let { if (tag != null) it.testTag(SettingsTags.toggle(tag)) else it }
                .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (icon != null) SettingsRowLabel(title, icon, tint) else Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
            }
            Spacer(Modifier.size(Spacing.tight))
            SettingsSwitch(checked = checked, onCheckedChange = null, modifier = Modifier.clearAndSetSemantics {})
        }
        if (showsDivider) RowDivider(if (icon != null) SettingsIconDivider else SettingsLayout.rowInset)
    }
}

@Composable
fun RowDivider(inset: Dp = SettingsLayout.rowInset) {
    HorizontalDivider(Modifier.padding(start = inset), thickness = 0.5.dp, color = SystemPalette.separator.current)
}

@Composable
fun <T> PickerRow(
    title: String,
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    tint: Color = Color.Unspecified,
    showsDivider: Boolean = false,
    tag: String? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    val current = label(selected)
    Box(modifier) {
        SettingsRow(
            modifier = Modifier
                .semantics { stateDescription = current }
                .let { if (tag != null) it.testTag(SettingsTags.row(tag)) else it },
            onClick = { expanded = true },
            showsDivider = showsDivider,
            dividerInset = if (icon != null) SettingsIconDivider else SettingsLayout.rowInset,
            trailing = {
                SettingsValueText(current)
                Spacer(Modifier.size(Spacing.hairline))
                Icon(ArdiaSymbols.chevronUpChevronDown, null, Modifier.size(14.dp), tint = SystemPalette.secondaryLabel.current)
            },
        ) {
            if (icon != null) SettingsRowLabel(title, icon, tint) else Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
        }
        Box(Modifier.align(Alignment.BottomEnd).padding(end = SettingsLayout.rowInset)) {
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                modifier = Modifier.background(Palette.panel.current),
            ) {
                for (option in options) {
                    val isSelected = option == selected
                    DropdownMenuItem(
                        text = { Text(label(option), style = ArdiaType.body, color = SystemPalette.label.current) },
                        onClick = {
                            expanded = false
                            onSelect(option)
                        },
                        leadingIcon = {
                            Box(Modifier.size(18.dp)) {
                                if (isSelected) Icon(ArdiaSymbols.checkmark, null, Modifier.size(18.dp), tint = SystemPalette.label.current)
                            }
                        },
                        modifier = Modifier.semantics { this.selected = isSelected },
                    )
                }
            }
        }
    }
}

@Composable
fun ButtonRow(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    destructive: Boolean = false,
    busy: Boolean = false,
    showsDivider: Boolean = false,
    tag: String? = null,
) {
    val color = when {
        !enabled -> SystemPalette.tertiaryLabel.current
        destructive -> SystemPalette.red.current
        else -> Palette.formAccent.current
    }
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = SettingsLayout.rowMinHeight)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .let { if (tag != null) it.testTag(SettingsTags.row(tag)) else it }
                .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.tight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, style = ArdiaType.body, color = color, modifier = Modifier.weight(1f))
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = SystemPalette.secondaryLabel.current)
        }
        if (showsDivider) RowDivider()
    }
}

@Composable
fun ValueRow(title: String, value: String, modifier: Modifier = Modifier, showsDivider: Boolean = false) {
    SettingsRow(modifier = modifier, showsDivider = showsDivider, dividerInset = SettingsLayout.rowInset, trailing = { SettingsValueText(value) }) {
        Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
    }
}

@Composable
fun IconLabelRow(title: String, icon: ImageVector, modifier: Modifier = Modifier, iconTint: Color = SystemPalette.secondaryLabel.current, value: String? = null) {
    SettingsRow(modifier = modifier, trailing = value?.let { { SettingsValueText(it) } }) {
        Row(horizontalArrangement = Arrangement.spacedBy(SettingsLayout.labelGap), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(22.dp), tint = iconTint)
            Text(title, style = ArdiaType.body, color = SystemPalette.label.current)
        }
    }
}

@Composable
fun FootnoteText(text: String, modifier: Modifier = Modifier, color: Color = SystemPalette.secondaryLabel.current) {
    Text(text, style = ArdiaType.footnote, color = color, modifier = modifier.padding(horizontal = Spacing.page + SettingsLayout.rowInset))
}

@Composable
fun warningInk(): Color = legibleInk(ardiaOrange)

@Composable
fun problemInk(): Color = legibleInk(SystemPalette.red.current)

@Composable
fun goodInk(): Color = legibleInk(SystemPalette.green.current)

private val ardiaOrange = Color(0xFFFF9500)

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = true,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.panel.current,
        title = { Text(title, style = ArdiaType.headline, color = SystemPalette.label.current) },
        text = { Text(message, style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current) },
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    onConfirm()
                },
                modifier = Modifier.testTag(SettingsTags.CONFIRM),
            ) {
                Text(confirm, style = ArdiaType.body.semibold, color = if (destructive) SystemPalette.red.current else Palette.formAccent.current)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.settings_cancel), style = ArdiaType.body, color = Palette.formAccent.current)
            }
        },
    )
}

object ButtonShape {
    val primary: Shape = RoundedCornerShape(14.dp)
    val capsule: Shape = RoundedCornerShape(50)
}

@Composable
fun PrimaryActionButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 50.dp)
            .clip(ButtonShape.primary)
            .background(if (enabled) Palette.primaryAction.current else SystemPalette.tertiaryFill.current)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.page, vertical = Spacing.small),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = ArdiaType.body.semibold, color = Palette.onPrimaryAction.current, textAlign = TextAlign.Center)
    }
}

@Composable
fun SecondaryActionButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clip(ButtonShape.primary)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = ArdiaType.body.semibold, color = SystemPalette.label.current, textAlign = TextAlign.Center)
    }
}

@Composable
fun CapsuleButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    prominent: Boolean = false,
    large: Boolean = false,
    enabled: Boolean = true,
) {
    val background = if (prominent) Palette.primaryAction.current else SystemPalette.tertiaryFill.current
    val content = if (prominent) Palette.onPrimaryAction.current else Palette.formAccent.current
    Row(
        modifier
            .heightIn(min = if (large) 50.dp else 36.dp)
            .clip(ButtonShape.capsule)
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (large) Spacing.medium else Spacing.small + 2.dp, vertical = Spacing.tight - 2.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(17.dp), tint = content)
        Text(text, style = if (large) ArdiaType.body.semibold else ArdiaType.subheadline.copy(fontWeight = FontWeight.Medium), color = content, maxLines = 1)
    }
}

@Composable
fun EmptyState(title: String, message: String, icon: ImageVector, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = Spacing.section, vertical = 80.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        Icon(icon, null, Modifier.size(44.dp), tint = SystemPalette.secondaryLabel.current)
        Text(title, style = ArdiaType.title2.bold, color = SystemPalette.label.current, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
        Text(message, style = ArdiaType.subheadline, color = SystemPalette.secondaryLabel.current, textAlign = TextAlign.Center)
    }
}

@Composable
fun FieldSurface(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.page)
            .clip(RoundedCornerShape(SettingsLayout.groupRadius))
            .background(SystemPalette.secondaryGroupedBackground.current)
            .padding(horizontal = SettingsLayout.rowInset, vertical = Spacing.small),
    ) {
        content()
    }
}

fun Modifier.groupedItem(isFirst: Boolean, isLast: Boolean): Modifier {
    val radius = SettingsLayout.groupRadius
    val shape = RoundedCornerShape(
        topStart = if (isFirst) radius else 0.dp,
        topEnd = if (isFirst) radius else 0.dp,
        bottomStart = if (isLast) radius else 0.dp,
        bottomEnd = if (isLast) radius else 0.dp,
    )
    return padding(horizontal = Spacing.page).clip(shape)
}

@Composable
fun GroupHeader(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = ArdiaType.footnote,
        color = SystemPalette.secondaryLabel.current,
        modifier = modifier.padding(start = Spacing.page + SettingsLayout.rowInset, end = Spacing.page, bottom = Spacing.tight).semantics { heading() },
    )
}

@Composable
fun SettingsTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    monospaced: Boolean = false,
    keyboardOptions: androidx.compose.foundation.text.KeyboardOptions = androidx.compose.foundation.text.KeyboardOptions.Default,
    keyboardActions: androidx.compose.foundation.text.KeyboardActions = androidx.compose.foundation.text.KeyboardActions.Default,
) {
    val style = ArdiaType.body.copy(
        color = SystemPalette.label.current,
        fontFamily = if (monospaced) androidx.compose.ui.text.font.FontFamily.Monospace else null,
    )
    androidx.compose.foundation.text.BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        textStyle = style,
        singleLine = singleLine,
        minLines = minLines,
        maxLines = maxLines,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        cursorBrush = androidx.compose.ui.graphics.SolidColor(Palette.formAccent.current),
        decorationBox = { field ->
            Box {
                if (value.isEmpty()) Text(placeholder, style = style.copy(color = SystemPalette.tertiaryLabel.current))
                field()
            }
        },
    )
}
