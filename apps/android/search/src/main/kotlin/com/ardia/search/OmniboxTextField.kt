package com.ardia.search

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaType
import com.ardia.design.BrowsePalette

@Immutable
internal class CompletionTransformation(private val suffix: String, private val highlight: Color) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val typedLength = text.length
        val shown = buildAnnotatedString {
            append(text)
            withStyle(SpanStyle(background = highlight)) { append(suffix) }
        }
        val mapping = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int = offset.coerceIn(0, typedLength)

            override fun transformedToOriginal(offset: Int): Int = offset.coerceIn(0, typedLength)
        }
        return TransformedText(shown, mapping)
    }

    override fun equals(other: Any?): Boolean = other is CompletionTransformation && other.suffix == suffix && other.highlight == highlight

    override fun hashCode(): Int = suffix.hashCode() * 31 + highlight.hashCode()
}

@Composable
internal fun OmniboxTextField(
    state: CompletingFieldState,
    isIncognito: Boolean,
    focusRequester: FocusRequester,
    onTyped: (String) -> Unit,
    onSubmit: (String) -> Unit,
    onFocusChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = BrowsePalette.searchAccent.current
    val suffix = state.suffix
    val transformation = remember(suffix, accent) {
        if (suffix.isEmpty()) VisualTransformation.None else CompletionTransformation(suffix, accent.copy(alpha = 0.3f))
    }
    val textColor = if (isIncognito) Color.White else BrowsePalette.foregroundPrimary.current
    val placeholderColor = if (isIncognito) Color.White.copy(alpha = 0.45f) else BrowsePalette.foregroundTertiary.current
    val style = remember(textColor) { ArdiaType.title3.copy(color = textColor) }
    val label = stringResource(R.string.search_field_label)
    val placeholder = stringResource(R.string.search_placeholder)
    BasicTextField(
        value = state.value,
        onValueChange = { next -> if (state.edit(next)) onTyped(state.typed) },
        modifier = modifier
            .focusRequester(focusRequester)
            .onFocusChanged { focus ->
                if (focus.isFocused != state.isFocused) {
                    state.focusChanged(focus.isFocused)
                    onFocusChange(focus.isFocused)
                }
            }
            .semantics { contentDescription = label },
        textStyle = style,
        singleLine = true,
        cursorBrush = SolidColor(accent),
        visualTransformation = transformation,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Uri,
            imeAction = ImeAction.Go,
        ),
        keyboardActions = KeyboardActions(
            onGo = {
                val submitted = state.display
                if (submitted.isNotBlank()) onSubmit(submitted)
            },
        ),
        decorationBox = { inner ->
            Box(Modifier.padding(horizontal = FIELD_TEXT_INSET), contentAlignment = Alignment.CenterStart) {
                if (state.value.text.isEmpty()) Text(placeholder, style = ArdiaType.title3, color = placeholderColor, maxLines = 1)
                inner()
            }
        },
    )
}

private val FIELD_TEXT_INSET = 3.dp
