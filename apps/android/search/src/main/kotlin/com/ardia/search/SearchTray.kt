package com.ardia.search

import android.content.Context
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.BrowseSession
import com.ardia.appmodel.SearchSuggestionsModel
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.BrowseLayout
import com.ardia.design.BrowsePalette
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalProfileLook
import com.ardia.design.Motion
import com.ardia.design.Spacing
import com.ardia.design.semibold
import com.ardia.store.SearchInput
import com.ardia.store.SearchSuggestion
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun SearchTray(
    model: AppModel,
    request: BrowseSession.SearchRequest,
    presentation: TrayPresentation,
    maxHeight: Dp,
    dismissDrag: Modifier,
    modifier: Modifier = Modifier,
) {
    val isIncognito = model.isIncognito
    val dark = LocalArdiaDarkTheme.current || isIncognito
    CompositionLocalProvider(LocalArdiaDarkTheme provides dark) {
        TrayPanel(model, request, presentation, isIncognito, maxHeight, dismissDrag, modifier)
    }
}

@Stable
private class TrayController(
    private val model: AppModel,
    private val context: Context,
    private val scope: CoroutineScope,
    val field: CompletingFieldState,
    val presentation: TrayPresentation,
    val scrub: ScrubState,
) : RowActions {
    var suggestions: SearchSuggestionsModel? = null
    var isSubmitting = false

    fun typed(text: String) {
        if (isSubmitting) return
        suggestions?.update(text)
        scrub.cancel()
    }

    fun submit(value: String) {
        val current = suggestions
        scope.launch {
            val resolution = current?.resolve(value)
            if (resolution == null && SearchInput.resolve(value) == null) return@launch
            isSubmitting = true
            leave()
            model.submitSearch(value, resolution)
        }
    }

    fun leave() {
        presentation.wantsFocus = false
        model.browse.dismissSearch()
    }

    fun clear() {
        field.reset("")
        typed("")
    }

    override fun activate(row: TrayRow) {
        when (row) {
            is TrayRow.Paste -> ClipboardOffers.read(context)?.let(::submit)
            is TrayRow.Suggested -> {
                if (TrayRows.leavesSearch(row.suggestion)) leave()
                model.activate(row.suggestion)
            }
        }
    }

    override fun refine(suggestion: SearchSuggestion) {
        val text = TrayRows.refinedText(suggestion)
        field.reset(text)
        typed(text)
        if (model.mayFocusSearch) presentation.wantsFocus = true
    }

    override fun menu(suggestion: SearchSuggestion): List<RowMenuItem> {
        val incognito = model.isIncognito
        val url = suggestion.url
        return when (suggestion.kind) {
            SearchSuggestion.Kind.Query -> listOf(
                RowMenuItem(
                    context.getString(if (incognito) R.string.search_in_new_tab else R.string.search_in_incognito_tab),
                    if (incognito) ArdiaSymbols.squareOnSquare else ArdiaSymbols.eyes,
                ) {
                    presentation.wantsFocus = false
                    model.searchSwitchingMode(suggestion.query)
                },
            )
            SearchSuggestion.Kind.Calculation -> listOfNotNull(
                suggestion.copyValue?.let { value ->
                    RowMenuItem(context.getString(R.string.search_copy), ArdiaSymbols.docOnDoc) { model.copyText(value) }
                },
            )
            else -> if (url == null) {
                emptyList()
            } else {
                listOf(
                    RowMenuItem(
                        context.getString(if (incognito) R.string.search_open_in_new_tab else R.string.search_open_in_incognito_tab),
                        if (incognito) ArdiaSymbols.squareOnSquare else ArdiaSymbols.eyes,
                    ) {
                        presentation.wantsFocus = false
                        model.openSwitchingMode(url)
                    },
                    RowMenuItem(context.getString(R.string.search_copy_link), ArdiaSymbols.link) {
                        model.copyLink(url)
                    },
                    RowMenuItem(context.getString(R.string.search_share), ArdiaSymbols.squareAndArrowUp) {
                        model.share(url, suggestion.title)
                    },
                )
            }
        }
    }
}

@Composable
private fun TrayPanel(
    model: AppModel,
    request: BrowseSession.SearchRequest,
    presentation: TrayPresentation,
    isIncognito: Boolean,
    maxHeight: Dp,
    dismissDrag: Modifier,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val scope = rememberMainScope()
    val field = remember { CompletingFieldState(request.initialText, request.selectsAll) }
    val scrub = remember { ScrubState() }
    val controller = remember { TrayController(model, context, scope, field, presentation, scrub) }
    val suggestions = remember(isIncognito) { model.makeSuggestionsModel() }
    var paste by remember { mutableStateOf<ClipboardOffer?>(null) }

    DisposableEffect(suggestions) {
        controller.suggestions = suggestions
        suggestions.update(field.typed)
        suggestions.prepare()
        onDispose {
            if (controller.suggestions === suggestions) controller.suggestions = null
            suggestions.close()
        }
    }
    LaunchedEffect(suggestions) {
        suggestions.omnibox.result.collect { result -> field.offer(result.completion) }
    }
    LaunchedEffect(Unit) {
        val offer = withContext(Dispatchers.Default) { runCatching { ClipboardOffers.peek(context) }.getOrNull() }
        withContext(Dispatchers.Main.immediate) { paste = offer }
    }
    val mayFocus = model.mayFocusSearch
    LaunchedEffect(mayFocus) {
        if (!presentation.isClosing) presentation.wantsFocus = mayFocus
    }

    val look = LocalProfileLook.current
    val surface = if (isIncognito) BrowsePalette.incognitoSheet else look.surface.current
    val radius = BrowseLayout.sheetTopRadius
    val shape = remember { RoundedCornerShape(topStart = radius, topEnd = radius) }
    Column(
        modifier
            .fillMaxWidth()
            .height(maxHeight)
            .graphicsLayer {
                shadowElevation = PANEL_SHADOW.toPx()
                this.shape = shape
                clip = false
            }
            .drawWithCache {
                val corner = radius.toPx()
                val extended = size.height + corner * PANEL_EXTENSION
                val path = Path().apply {
                    addRoundRect(RoundRect(0f, 0f, size.width, extended, CornerRadius(corner, corner), CornerRadius(corner, corner), CornerRadius.Zero, CornerRadius.Zero))
                }
                onDrawBehind { drawPath(path, surface) }
            },
    ) {
        TrayHeader(model, controller, isIncognito, dismissDrag)
        Box(Modifier.fillMaxWidth().weight(1f).clipToBounds()) {
            TrayBody(suggestions, controller, isIncognito, paste, dismissDrag)
        }
    }
}

@Composable
private fun TrayHeader(model: AppModel, controller: TrayController, isIncognito: Boolean, dismissDrag: Modifier) {
    val field = controller.field
    val presentation = controller.presentation
    val focusRequester = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val wantsFocus = presentation.wantsFocus
    LaunchedEffect(wantsFocus) {
        if (wantsFocus) {
            runCatching { focusRequester.requestFocus() }
            keyboardController?.show()
        } else if (field.isFocused) {
            focusManager.clearFocus(force = true)
            keyboardController?.hide()
        }
    }
    val fontScale = LocalDensity.current.fontScale
    val fieldHeight = BrowseLayout.searchFieldHeight * fontScale
    val fill = if (isIncognito) BrowsePalette.incognitoField else BrowsePalette.fieldFill.current
    val stroke = if (isIncognito) Color.White.copy(alpha = 0.1f) else BrowsePalette.fieldStroke.current
    Box(
        Modifier
            .fillMaxWidth()
            .then(dismissDrag)
            .padding(horizontal = BrowseLayout.searchFieldInset)
            .padding(top = BrowseLayout.trayFieldTop, bottom = Spacing.tight),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = fieldHeight)
                .drawBehind { drawRoundRect(fill, cornerRadius = CornerRadius(size.height / 2, size.height / 2)) }
                .border(1.dp, stroke, CircleShape)
                .padding(start = 18.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OmniboxTextField(
                state = field,
                isIncognito = isIncognito,
                focusRequester = focusRequester,
                onTyped = controller::typed,
                onSubmit = controller::submit,
                onFocusChange = { focused -> if (presentation.wantsFocus != focused) presentation.wantsFocus = focused },
                modifier = Modifier.weight(1f).heightIn(min = fieldHeight),
            )
            FieldAccessories(model, controller, isIncognito, fontScale)
        }
    }
}

@Composable
private fun FieldAccessories(model: AppModel, controller: TrayController, isIncognito: Boolean, fontScale: Float) {
    val field = controller.field
    val isEmpty by remember(field) { derivedStateOf { field.value.text.isEmpty() } }
    val tertiary = BrowsePalette.foregroundTertiary.current
    if (!isEmpty) {
        AccessoryButton(
            label = stringResource(R.string.search_clear_text),
            onClick = controller::clear,
        ) {
            Icon(ArdiaSymbols.xmarkCircleFill, null, Modifier.size(18.dp), tint = if (isIncognito) BrowsePalette.incognitoCaption else tertiary)
        }
    } else if (fontScale <= LARGE_FONT_SCALE && !isIncognito) {
        AccessoryButton(
            label = stringResource(R.string.search_voice),
            onClick = { model.browse.isVoicePresented = true },
        ) {
            Icon(ArdiaSymbols.mic, null, Modifier.size(19.dp), tint = tertiary)
        }
    }
    IncognitoToggle(isOn = isIncognito, onToggle = { model.isIncognito = !model.isIncognito })
}

@Composable
private fun AccessoryButton(label: String, onClick: () -> Unit, content: @Composable () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        Modifier
            .size(32.dp, 40.dp)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = label
                role = Role.Button
                onClick {
                    onClick()
                    true
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

private enum class BodyMode { Caption, Rows, Empty }

@Composable
private fun TrayBody(
    suggestions: SearchSuggestionsModel,
    controller: TrayController,
    isIncognito: Boolean,
    paste: ClipboardOffer?,
    dismissDrag: Modifier,
) {
    val field = controller.field
    val fieldEmpty by remember(field) { derivedStateOf { field.value.text.isEmpty() } }
    val rows by remember(suggestions) { derivedStateOf { TrayRows.build(suggestions.rows, suggestions.text, paste) } }
    val hasRows by remember(suggestions) { derivedStateOf { rows.isNotEmpty() } }
    val mode = when {
        isIncognito && fieldEmpty -> BodyMode.Caption
        hasRows -> BodyMode.Rows
        else -> BodyMode.Empty
    }
    Crossfade(targetState = mode, animationSpec = Motion.resultsIn.spec(), label = "trayBody") { shownMode ->
        when (shownMode) {
            BodyMode.Caption -> Box(Modifier.fillMaxSize().then(dismissDrag), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.search_browsing_incognito),
                    style = ArdiaType.title3.semibold,
                    color = BrowsePalette.incognitoCaption,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = Spacing.large),
                )
            }
            BodyMode.Rows -> RowsArea(rows, suggestions.text, isIncognito, controller)
            BodyMode.Empty -> Box(Modifier.fillMaxSize().then(dismissDrag))
        }
    }
}

@Composable
private fun RowsArea(rows: List<TrayRow>, typed: String, isIncognito: Boolean, controller: TrayController) {
    val scrollable = LocalDensity.current.fontScale > LARGE_FONT_SCALE
    val overflow = remember { OverflowFlag() }
    Box(
        Modifier
            .fillMaxSize()
            .clipToBounds()
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                if (!scrollable && overflow.value) drawRect(FADE_MASK, blendMode = BlendMode.DstIn)
            },
    ) {
        SuggestionList(
            rows = rows,
            typed = typed,
            isIncognito = isIncognito,
            scrollable = scrollable,
            scrub = controller.scrub,
            actions = controller,
            visibleHeight = { overflow.budget },
            modifier = if (scrollable) {
                Modifier.fillMaxSize()
            } else {
                Modifier.layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints.copy(minHeight = 0, maxHeight = Constraints.Infinity))
                    overflow.value = placeable.height > constraints.maxHeight + 1
                    overflow.budget = constraints.maxHeight.toFloat()
                    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(0, 0) }
                }
            },
        )
    }
}

@Stable
private class OverflowFlag {
    var value by mutableStateOf(false)
    var budget: Float = Float.MAX_VALUE
}

private val FADE_MASK = Brush.verticalGradient(
    0f to Color.Black,
    0.7f to Color.Black,
    1f to Color.Black.copy(alpha = 0.15f),
)
private val PANEL_SHADOW = 12.dp
private const val PANEL_EXTENSION = 12f
