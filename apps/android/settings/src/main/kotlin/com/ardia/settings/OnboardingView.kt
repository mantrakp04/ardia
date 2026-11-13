package com.ardia.settings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ardia.appmodel.AppModel
import com.ardia.design.ArdiaSpring
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ArdiaType
import com.ardia.design.LocalReduceMotion
import com.ardia.design.Motion
import com.ardia.design.Palette
import com.ardia.design.ProfileBackdrop
import com.ardia.design.Radius
import com.ardia.design.SettingsTint
import com.ardia.design.Spacing
import com.ardia.design.SystemPalette
import com.ardia.design.ardiaGradient
import com.ardia.design.bold
import com.ardia.design.medium
import com.ardia.design.profileBackdrop
import com.ardia.design.LocalArdiaDarkTheme
import com.ardia.design.LocalProfileLook
import kotlinx.coroutines.delay

object OnboardingTags {
    const val ROOT = "onboarding.root"

    fun step(step: OnboardingStep) = "onboarding.step.${step.name}"

    fun primary(step: OnboardingStep) = "onboarding.primary.${step.name}"

    const val SECONDARY = "onboarding.secondary"
}

@Composable
fun OnboardingView(model: AppModel, modifier: Modifier = Modifier) {
    var step by rememberSaveable { mutableStateOf(OnboardingStep.Welcome) }
    var forward by remember { mutableStateOf(true) }
    var settingUpSync by rememberSaveable { mutableStateOf(false) }
    val reduceMotion = LocalReduceMotion.current
    val haptics = LocalHapticFeedback.current
    val keyboard = LocalSoftwareKeyboardController.current
    val finish = { model.finishOnboarding() }
    val advance: () -> Unit = {
        val next = step.next
        if (next == null) {
            finish()
        } else {
            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
            forward = true
            step = next
        }
    }
    val stepShift = with(LocalDensity.current) { STEP_SHIFT.roundToPx() }
    LaunchedEffect(step) { keyboard?.hide() }
    BackHandler(enabled = step != OnboardingStep.Welcome && !settingUpSync) {
        forward = false
        step = OnboardingStep.entries[step.ordinal - 1]
    }

    Box(modifier.fillMaxSize().testTag(OnboardingTags.ROOT)) {
        Crossfade(step == OnboardingStep.Welcome, animationSpec = Motion.surfaceSwap.spec(), label = "onboardingBackdrop") { welcome ->
            if (welcome) ProfileBackdrop(Modifier.fillMaxSize()) else OnboardingBackdrop(Modifier.fillMaxSize())
        }
        AnimatedContent(
            targetState = step,
            transitionSpec = {
                if (reduceMotion) {
                    fadeIn(Motion.reducedFade.spec()) togetherWith fadeOut(Motion.reducedFade.spec())
                } else {
                    val spec = Motion.smooth.spec<IntOffset>(IntOffset.VisibilityThreshold)
                    val shift = if (forward) stepShift else -stepShift
                    (slideInHorizontally(spec) { shift } + fadeIn(Motion.smooth.spec())) togetherWith
                        (slideOutHorizontally(spec) { -shift } + fadeOut(Motion.smooth.spec()))
                }
            },
            label = "onboardingStep",
        ) { shown ->
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).testTag(OnboardingTags.step(shown))) {
                when (shown) {
                    OnboardingStep.Welcome -> OnboardingWelcomeStep(onContinue = advance)
                    OnboardingStep.Blocking -> OnboardingBlockingStep(model, onContinue = advance)
                    OnboardingStep.DefaultBrowser -> OnboardingDefaultBrowserStep(model, onContinue = advance)
                    OnboardingStep.Sync -> OnboardingSyncStep(model, onConnect = { settingUpSync = true }, onContinue = advance)
                    OnboardingStep.AllSet -> OnboardingAllSetStep(onFinish = {
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        finish()
                    })
                }
            }
        }
        AnimatedVisibility(
            settingUpSync,
            enter = slideInVertically(Motion.smooth.spec()) { it } + fadeIn(),
            exit = slideOutVertically(Motion.smooth.spec()) { it } + fadeOut(),
        ) {
            SyncSetupContent(model, Modifier.fillMaxSize(), onClose = { settingUpSync = false })
        }
    }
}

private val STEP_SHIFT = 60.dp

@Composable
fun OnboardingBackdrop(modifier: Modifier = Modifier) {
    val look = LocalProfileLook.current
    val dark = LocalArdiaDarkTheme.current
    val fade = remember { Brush.verticalGradient(0f to Color.Black, 0.45f to Color.Black.copy(alpha = 0.6f), 0.8f to Color.Transparent) }
    Box(modifier.background(SystemPalette.background.current).clearAndSetSemantics {}) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                .profileBackdrop(look, dark, softened = true)
                .drawWithContent {
                    drawContent()
                    drawRect(fade, blendMode = BlendMode.DstIn)
                },
        )
    }
}

fun emphasized(template: String, word: String, accent: Color): AnnotatedString {
    val marker = "%1\$s"
    val index = template.indexOf(marker)
    return buildAnnotatedString {
        if (index < 0) {
            append(template)
            return@buildAnnotatedString
        }
        append(template.substring(0, index))
        withStyle(SpanStyle(color = accent)) { append(word) }
        append(template.substring(index + marker.length))
    }
}

@Composable
fun OnboardingPage(
    title: AnnotatedString,
    subtitle: String,
    modifier: Modifier = Modifier,
    illustration: @Composable () -> Unit,
    actions: @Composable ColumnScope.() -> Unit,
) {
    val scrolls = LocalDensity.current.fontScale >= ACCESSIBILITY_FONT_SCALE
    Column(modifier.fillMaxSize().let { if (scrolls) it.verticalScroll(rememberScrollState()) else it }) {
        Box(
            Modifier
                .fillMaxWidth()
                .let { if (scrolls) it.heightIn(min = 260.dp).padding(top = Spacing.large) else it.weight(1f) }
                .padding(horizontal = Spacing.page),
            contentAlignment = Alignment.Center,
        ) { illustration() }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.section).padding(top = Spacing.medium),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.small),
        ) {
            Text(
                title,
                style = ArdiaType.largeTitle.bold,
                color = SystemPalette.label.current,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Crossfade(subtitle, label = "onboardingSubtitle") { text ->
                Text(text, style = ArdiaType.body, color = SystemPalette.secondaryLabel.current, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(start = Spacing.medium + 4.dp, end = Spacing.medium + 4.dp, top = Spacing.large, bottom = Spacing.small),
            verticalArrangement = Arrangement.spacedBy(Spacing.tight),
            content = actions,
        )
    }
}

@Composable
fun OnboardingWelcomeStep(onContinue: () -> Unit) {
    val reduceMotion = LocalReduceMotion.current
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        if (reduceMotion) {
            appear.animateTo(1f, Motion.reducedSettle.spec())
        } else {
            delay(WELCOME_DELAY_MILLIS)
            appear.animateTo(1f, WelcomeSpring.spec())
        }
    }
    val scrolls = LocalDensity.current.fontScale >= ACCESSIBILITY_FONT_SCALE
    Column(
        Modifier.fillMaxSize().let { if (scrolls) it.verticalScroll(rememberScrollState()).padding(top = Spacing.section) else it },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.large),
    ) {
        if (!scrolls) Spacer(Modifier.weight(1f))
        Box(
            Modifier.graphicsLayer {
                val progress = appear.value
                rotationZ = if (reduceMotion) -6f else -18f + 12f * progress
                val scale = if (reduceMotion) 1f else 0.7f + 0.3f * progress
                scaleX = scale
                scaleY = scale
                alpha = progress.coerceIn(0f, 1f)
            },
        ) {
            Box(
                Modifier
                    .shadow(24.dp, RoundedCornerShape(104.dp * 0.225f + 5.dp), ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.18f))
                    .background(Color.White, RoundedCornerShape(104.dp * 0.225f + 5.dp))
                    .padding(5.dp),
            ) { AppIcon(side = 104.dp, scalesWithText = false) }
        }
        Column(
            Modifier
                .padding(horizontal = Spacing.section)
                .graphicsLayer {
                    val progress = appear.value
                    alpha = progress.coerceIn(0f, 1f)
                    translationY = if (reduceMotion) 0f else (1f - progress) * 16.dp.toPx()
                },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.small),
        ) {
            Text(
                stringResource(R.string.onboarding_welcome_title),
                style = ArdiaType.largeTitle.bold.copy(fontSize = 40.sp, lineHeight = 46.sp),
                color = SystemPalette.label.current,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(stringResource(R.string.onboarding_welcome_subtitle), style = ArdiaType.title3.medium, color = SystemPalette.secondaryLabel.current, textAlign = TextAlign.Center)
        }
        if (!scrolls) Spacer(Modifier.weight(1f))
        PrimaryActionButton(
            stringResource(R.string.onboarding_get_started),
            onClick = onContinue,
            modifier = Modifier
                .padding(start = Spacing.medium + 4.dp, end = Spacing.medium + 4.dp, bottom = Spacing.small)
                .graphicsLayer { alpha = appear.value.coerceIn(0f, 1f) }
                .testTag(OnboardingTags.primary(OnboardingStep.Welcome)),
        )
    }
}

private const val WELCOME_DELAY_MILLIS = 100L
private val WelcomeSpring = ArdiaSpring.withBounce(duration = 0.7f, bounce = 0.3f)

@Composable
fun OnboardingBlockingStep(model: AppModel, onContinue: () -> Unit) {
    val blocking = model.blockingState
    OnboardingPage(
        title = emphasized(stringResource(R.string.onboarding_blocking_title), stringResource(R.string.onboarding_blocking_emphasis), Palette.formAccent.current),
        subtitle = stringResource(R.string.onboarding_blocking_subtitle),
        illustration = {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .shadow(16.dp, RoundedCornerShape(Radius.card), ambientColor = Color.Black.copy(alpha = 0.06f), spotColor = Color.Black.copy(alpha = 0.06f))
                        .clip(RoundedCornerShape(Radius.card))
                        .background(SystemPalette.background.current.copy(alpha = 0.9f))
                        .padding(vertical = Spacing.hairline),
                ) {
                    ToggleRow(
                        stringResource(R.string.site_block_ads), blocking.blocksAds, model::setBlocksAds,
                        icon = ArdiaSymbols.handRaisedFill, tint = SettingsTint.ads, showsDivider = true, tag = "onboardingAds",
                    )
                    ToggleRow(
                        stringResource(R.string.site_block_trackers), blocking.blocksTrackers, model::setBlocksTrackers,
                        icon = ArdiaSymbols.eyeglasses, tint = SettingsTint.trackers, showsDivider = true, tag = "onboardingTrackers",
                    )
                    ToggleRow(
                        stringResource(R.string.site_block_cookie_banners), blocking.hidesCookieBanners, model::setHidesCookieBanners,
                        icon = ArdiaSymbols.listBulletRectanglePortraitFill, tint = SettingsTint.cookies, tag = "onboardingCookies",
                    )
                }
            }
        },
    ) {
        PrimaryActionButton(stringResource(R.string.onboarding_continue), onClick = onContinue, modifier = Modifier.testTag(OnboardingTags.primary(OnboardingStep.Blocking)))
    }
}

@Composable
fun OnboardingDefaultBrowserStep(model: AppModel, onContinue: () -> Unit) {
    val scrolls = LocalDensity.current.fontScale >= ACCESSIBILITY_FONT_SCALE
    if (scrolls) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = Spacing.large)) {
            DefaultBrowserInstructions(
                model,
                Modifier
                    .padding(horizontal = Spacing.tight)
                    .clip(RoundedCornerShape(38.dp))
                    .background(SystemPalette.background.current)
                    .padding(Spacing.medium)
                    .testTag(OnboardingTags.primary(OnboardingStep.DefaultBrowser)),
                onLater = onContinue,
                onDone = onContinue,
            )
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = Spacing.section), contentAlignment = Alignment.Center) { LinkBubbleIllustration() }
        DefaultBrowserInstructions(
            model,
            Modifier
                .shadow(20.dp, RoundedCornerShape(topStart = 38.dp, topEnd = 38.dp), ambientColor = Color.Black.copy(alpha = 0.08f), spotColor = Color.Black.copy(alpha = 0.08f))
                .background(SystemPalette.background.current, RoundedCornerShape(topStart = 38.dp, topEnd = 38.dp))
                .padding(start = Spacing.medium + 4.dp, end = Spacing.medium + 4.dp, top = Spacing.section, bottom = Spacing.small)
                .testTag(OnboardingTags.primary(OnboardingStep.DefaultBrowser)),
            onLater = onContinue,
            onDone = onContinue,
        )
    }
}

@Composable
private fun LinkBubbleIllustration() {
    val plum = remember { com.ardia.design.ProfileLook.plum.swatchColor }
    Row(Modifier.clearAndSetSemantics {}, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        Column(
            Modifier
                .width(210.dp)
                .shadow(12.dp, RoundedCornerShape(18.dp), ambientColor = Color.Black.copy(alpha = 0.08f), spotColor = Color.Black.copy(alpha = 0.08f))
                .clip(RoundedCornerShape(18.dp))
                .background(SystemPalette.secondaryBackground.current),
        ) {
            Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).background(plum.ardiaGradient()))
            Column(Modifier.padding(horizontal = Spacing.small, vertical = Spacing.tight + 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(stringResource(R.string.onboarding_link_title), style = ArdiaType.subheadline.bold, color = SystemPalette.label.current, maxLines = 1)
                Text(stringResource(R.string.onboarding_link_host), style = ArdiaType.caption, color = SystemPalette.secondaryLabel.current)
            }
        }
        Icon(ArdiaSymbols.arrowRight, null, Modifier.padding(bottom = 26.dp).size(22.dp), tint = Palette.formAccent.current)
        AppIcon(side = 60.dp, shadow = true, scalesWithText = false, modifier = Modifier.padding(bottom = 8.dp))
    }
}

@Composable
fun OnboardingSyncStep(model: AppModel, onConnect: () -> Unit, onContinue: () -> Unit) {
    val connected = model.syncState.words.isConnected
    OnboardingPage(
        title = emphasized(stringResource(R.string.onboarding_sync_title), stringResource(R.string.onboarding_sync_emphasis), Palette.formAccent.current),
        subtitle = stringResource(if (connected) R.string.onboarding_sync_connected else R.string.onboarding_sync_subtitle),
        illustration = { SyncScanIllustration(connected) },
    ) {
        if (connected) {
            PrimaryActionButton(stringResource(R.string.onboarding_continue), onClick = onContinue, modifier = Modifier.testTag(OnboardingTags.primary(OnboardingStep.Sync)))
        } else {
            PrimaryActionButton(stringResource(R.string.sync_connect), onClick = onConnect, modifier = Modifier.testTag(OnboardingTags.primary(OnboardingStep.Sync)))
            SecondaryActionButton(stringResource(R.string.onboarding_not_now), onClick = onContinue, modifier = Modifier.testTag(OnboardingTags.SECONDARY))
        }
    }
}

@Composable
fun OnboardingAllSetStep(onFinish: () -> Unit) {
    OnboardingPage(
        title = AnnotatedString(stringResource(R.string.onboarding_all_set_title)),
        subtitle = stringResource(R.string.onboarding_all_set_subtitle),
        illustration = {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .shadow(16.dp, RoundedCornerShape(Radius.card), ambientColor = Color.Black.copy(alpha = 0.06f), spotColor = Color.Black.copy(alpha = 0.06f))
                        .clip(RoundedCornerShape(Radius.card))
                        .background(SystemPalette.background.current.copy(alpha = 0.9f))
                        .padding(Spacing.medium),
                    verticalArrangement = Arrangement.spacedBy(Spacing.medium),
                ) {
                    AllSetTip(ArdiaSymbols.plus, stringResource(R.string.onboarding_tip_search))
                    AllSetTip(ArdiaSymbols.squareOnSquare, stringResource(R.string.onboarding_tip_close))
                    AllSetTip(ArdiaSymbols.handDraw, stringResource(R.string.onboarding_tip_back))
                    AllSetTip(ArdiaSymbols.archivebox, stringResource(R.string.onboarding_tip_archive))
                }
            }
        },
    ) {
        PrimaryActionButton(stringResource(R.string.onboarding_start_browsing), onClick = onFinish, modifier = Modifier.testTag(OnboardingTags.primary(OnboardingStep.AllSet)))
    }
}

@Composable
private fun AllSetTip(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(20.dp), tint = Palette.formAccent.current) }
        Text(text, style = ArdiaType.subheadline, color = SystemPalette.label.current)
    }
}
