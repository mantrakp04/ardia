package com.ardia.tabs

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.ardia.appmodel.AppModel
import com.ardia.appmodel.TabDeckModel
import com.ardia.design.DeckSize
import com.ardia.design.SwiftEasing
import com.ardia.design.TabsDeckGeometry
import com.ardia.design.TabsMotion
import com.ardia.store.BrowserTab
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.max
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Stable
class CardMotion {
    val lift = Animatable(0f)
    val vanish = Animatable(0f)
    val slot = Animatable(0f)
}

data class PoofSpec(val x: Float, val y: Float, val size: Float, val id: Long = nextPoofId.incrementAndGet())

private val nextPoofId = AtomicLong()

@Stable
class DeckState internal constructor(
    private val model: AppModel,
    private val scope: CoroutineScope,
    private val haptics: Haptics,
) {
    var reduceMotion: Boolean = false
    var geometry: TabsDeckGeometry by mutableStateOf(TabsDeckGeometry(DeckSize(1.0, 1.0), 0.0, 0.0))

    var order: List<String> by mutableStateOf(emptyList())
        private set
    var phase: DeckPhase by mutableStateOf(DeckPhase.Settled)
        private set

    val scroll = Animatable(0f)
    private var dragScroll by mutableFloatStateOf(Float.NaN)
    private var settleOrigin by mutableFloatStateOf(Float.NaN)
    val scaleProgress = Animatable(1f)
    val positionProgress = Animatable(1f)
    val cardsOpacity = Animatable(1f)
    var cover: ImageBitmap? by mutableStateOf(null)
        private set
    val coverOpacity = Animatable(0f)

    private val motions = HashMap<String, CardMotion>()
    private var draggedLiftId: String? by mutableStateOf(null)
    private var draggedLift by mutableFloatStateOf(0f)
    var lifting: Set<String> by mutableStateOf(emptySet())
        private set
    val poofs = mutableStateListOf<PoofSpec>()

    var showsArchiveCard: Boolean by mutableStateOf(false)
        private set
    var isConfirmingCloseAll: Boolean by mutableStateOf(false)
    var isConfirmingCloseIncognito: Boolean by mutableStateOf(false)
    var menuFor: String? by mutableStateOf(null)

    private var didAppear = false
    private var dragAxisVertical: String? = null
    private var dragHorizontal = false
    private var dragStart = 0f
    private var tickedCard = -1

    val currentScroll: Float get() = dragScroll.let { if (it.isNaN()) scroll.value else it }

    val isOpeningTab: Boolean get() = phase is DeckPhase.Closing

    val tabsById: Map<String, BrowserTab> by derivedStateOf { model.deckTabs.associateBy { it.id } }

    val renderedRange: IntRange by derivedStateOf {
        val count = order.size
        val current = TabsDeckGeometry.renderedRange(currentScroll.toDouble(), count)
        val origin = settleOrigin
        if (origin.isNaN()) return@derivedStateOf current
        val previous = TabsDeckGeometry.renderedRange(origin.toDouble(), count)
        if (previous.isEmpty() || current.isEmpty()) current else minOf(previous.first, current.first)..maxOf(previous.last, current.last)
    }

    fun motion(id: String): CardMotion = motions.getOrPut(id) { CardMotion() }

    private fun slot(id: String): Float = motions[id]?.slot?.value ?: 0f

    fun relative(id: String, index: Int): Double = (index + slot(id) - currentScroll).toDouble()

    fun liftOf(id: String): Float = if (draggedLiftId == id) draggedLift else motions[id]?.lift?.value ?: 0f

    fun role(id: String, index: Int): DeckRole = DeckPose.role(phase, id, index, order)

    fun cardPose(id: String, index: Int, isLast: Boolean, into: DeckPose): DeckPose = into.resolve(
        geometry = geometry,
        role = role(id, index),
        relative = relative(id, index),
        scaleProgress = scaleProgress.value.toDouble(),
        positionProgress = positionProgress.value.toDouble(),
        lift = liftOf(id).toDouble(),
        vanish = (motions[id]?.vanish?.value ?: 0f).toDouble(),
        isLast = isLast,
    )

    fun cardFrame(id: String, index: Int, into: DeckPose): DeckPose = into.resolve(
        geometry = geometry,
        role = role(id, index),
        relative = 0.0,
        scaleProgress = scaleProgress.value.toDouble(),
        positionProgress = positionProgress.value.toDouble(),
        lift = 0.0,
        vanish = (motions[id]?.vanish?.value ?: 0f).toDouble(),
        isLast = true,
    )

    val backdropOpacity: Float get() = DeckPose.backdropOpacity(phase, positionProgress.value.toDouble()).toFloat()

    val chromeOpacity: Float get() = DeckPose.chromeOpacity(phase, positionProgress.value.toDouble()).toFloat()

    fun cardAt(x: Double, y: Double): String? {
        val current = order
        val index = DeckHit.cardAt(geometry, current.size, renderedRange, x, y) { relative(current[it], it) } ?: return null
        return current[index]
    }

    fun focusedId(): String? = DeckOrder.focusedId(order, currentScroll.toDouble())

    suspend fun appear() {
        if (didAppear) return
        didAppear = true
        order = model.deckOrder.map { it.id }
        val entrance = model.deck.entrance
        model.deck.entrance = TabDeckModel.Entrance.Plain
        val fromPage = entrance as? TabDeckModel.Entrance.FromPage
        val index = fromPage?.let { order.indexOf(it.tabId) } ?: -1
        if (fromPage != null && index >= 0 && !reduceMotion) {
            scroll.snapTo(DeckOrder.openingScroll(index, order.size).toFloat())
            phase = DeckPhase.Opening(fromPage.tabId)
            scaleProgress.snapTo(0f)
            positionProgress.snapTo(0f)
            coroutineScope {
                launch { scaleProgress.animateTo(1f, TabsMotion.openScale.spec()) }
                positionProgress.animateTo(1f, TabsMotion.openPosition.spec())
            }
            phase = DeckPhase.Settled
            offerArchiveCard()
            return
        }
        scroll.snapTo(DeckOrder.initialScroll(order.size).toFloat())
        val handoff = model.deck.handoff
        if (fromPage != null && handoff != null) {
            val handoffIndex = order.indexOf(handoff.tabId)
            if (handoffIndex >= 0) scroll.snapTo(DeckOrder.handoffScroll(handoffIndex).toFloat())
            cover = handoff.image.asImageBitmap()
            coverOpacity.snapTo(1f)
            phase = DeckPhase.Settled
            offerArchiveCard()
            coverOpacity.animateTo(0f, TabsMotion.fade.spec())
            cover = null
        } else {
            cardsOpacity.snapTo(0f)
            phase = DeckPhase.Settled
            offerArchiveCard()
            cardsOpacity.animateTo(1f, TabsMotion.fade.spec())
        }
    }

    fun reconcile() {
        if (!didAppear) return
        val current = model.deckOrder.map { it.id }
        val reconciled = DeckOrder.reconcile(order, current, currentScroll.toDouble()) ?: return
        reorder(reconciled.order, reconciled.scroll.toFloat())
    }

    private fun reorder(next: List<String>, nextScroll: Float) {
        val previous = order
        val previousScroll = currentScroll
        val oldIndex = HashMap<String, Int>(previous.size)
        previous.forEachIndexed { index, id -> oldIndex[id] = index }
        val live = next.toHashSet()
        motions.keys.retainAll { it in live || it in lifting }
        order = next
        dragScroll = Float.NaN
        settleOrigin = Float.NaN
        scope.launch(start = CoroutineStart.UNDISPATCHED) { scroll.snapTo(nextScroll) }
        if (reduceMotion) return
        next.forEachIndexed { index, id ->
            val was = oldIndex[id] ?: return@forEachIndexed
            val motion = motions[id] ?: return@forEachIndexed
            val shift = DeckOrder.slotShift(was, motion.slot.value.toDouble(), previousScroll.toDouble(), index, nextScroll.toDouble()).toFloat()
            if (abs(shift) < 0.001f) return@forEachIndexed
            scope.launch(start = CoroutineStart.UNDISPATCHED) {
                motion.slot.snapTo(shift)
                motion.slot.animateTo(0f, TabsMotion.gapClose.spec())
            }
        }
    }

    fun offerArchiveCard(force: Boolean = false) {
        if (!force && !model.deck.shouldOfferArchiveCard(order.size)) return
        model.deck.hasShownArchiveCard = true
        scope.launch {
            delay(ARCHIVE_CARD_DELAY_MILLIS)
            showsArchiveCard = true
        }
    }

    fun hideArchiveCard() {
        showsArchiveCard = false
    }

    fun open(id: String) {
        if (phase != DeckPhase.Settled || id in lifting) return
        hideArchiveCard()
        menuFor = null
        if (reduceMotion) {
            crossfadeOpen(id)
            return
        }
        phase = DeckPhase.Closing(id)
        model.prepareToOpen(id)
        scope.launch {
            model.primeCover(id)
            if (phase == DeckPhase.Closing(id)) model.beginOpening(id)
        }
        scope.launch {
            coroutineScope {
                launch { scaleProgress.animateTo(0f, TabsMotion.expand.spec()) }
                positionProgress.animateTo(0f, TabsMotion.expand.spec())
            }
            model.openTab(id)
        }
    }

    private fun crossfadeOpen(id: String) {
        model.prepareToOpen(id)
        phase = DeckPhase.Closing(id)
        scope.launch {
            model.primeCover(id)
            model.beginOpening(id)
            val image = model.deck.memoryImage(id) ?: model.tab(id)?.let { model.snapshotImage(it) }
            if (image == null) {
                model.openTab(id)
                return@launch
            }
            cover = image.asImageBitmap()
            coverOpacity.snapTo(0f)
            coverOpacity.animateTo(1f, TabsMotion.fade.spec())
            model.openTab(id)
        }
    }

    fun close(id: String, animated: Boolean) {
        val index = order.indexOf(id)
        if (index < 0) return
        hideArchiveCard()
        menuFor = null
        if (!animated || reduceMotion) {
            remove(id)
            return
        }
        val motion = motion(id)
        val startLift = liftOf(id)
        val relative = relative(id, index)
        val center = geometry.center(relative)
        val lift = startLift - (geometry.cardSize.height * 0.18).toFloat()
        val spec = PoofSpec(center.x.toFloat(), (center.y + lift).toFloat(), (geometry.cardSize.width * 0.9).toFloat())
        poofs.add(spec)
        lifting = lifting + id
        if (draggedLiftId == id) draggedLiftId = null
        val flyAway = tween<Float>(TabsMotion.flyAwayMillis, easing = SwiftEasing.easeOut)
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            motion.lift.snapTo(startLift)
            motion.lift.animateTo(lift, flyAway)
        }
        scope.launch(start = CoroutineStart.UNDISPATCHED) { motion.vanish.animateTo(1f, flyAway) }
        scope.launch {
            delay((TabsMotion.flyAwayMillis * 0.6).toLong())
            remove(id)
        }
        scope.launch {
            delay(TabsMotion.poofDurationMillis + 50L)
            poofs.remove(spec)
        }
    }

    private fun remove(id: String) {
        val index = order.indexOf(id)
        if (index < 0) {
            forget(id)
            return
        }
        val remaining = order.size - 1
        val focus = TabsDeckGeometry.scrollAfterRemoving(index, DeckOrder.rounded(currentScroll.toDouble()), remaining)
        lifting = lifting + id
        reorder(order.filterNot { it == id }, focus.toFloat())
        model.closeTab(id)
        scope.launch {
            delay(FORGET_DELAY_MILLIS)
            forget(id)
        }
    }

    private fun forget(id: String) {
        lifting = lifting - id
        if (id !in order) motions.remove(id)
    }

    fun perform(command: TabDeckModel.Command.Kind) {
        val focused = focusedId()
        when (command) {
            is TabDeckModel.Command.Kind.Scroll -> settle(command.index)
            TabDeckModel.Command.Kind.CloseFocused -> focused?.let { close(it, animated = true) }
            TabDeckModel.Command.Kind.OpenFocused -> focused?.let(::open)
            TabDeckModel.Command.Kind.ShowArchiveCard -> offerArchiveCard(force = true)
            is TabDeckModel.Command.Kind.Lift -> focused?.let { id ->
                val motion = motion(id)
                scope.launch(start = CoroutineStart.UNDISPATCHED) { motion.lift.snapTo(command.offset.toFloat()) }
            }
        }
    }

    fun closeAll() {
        hideArchiveCard()
        model.closeAllTabs()
    }

    fun leaveIncognito() {
        model.leaveIncognito()
    }

    fun back(): Boolean {
        if (phase != DeckPhase.Settled) return true
        if (menuFor != null) {
            menuFor = null
            return true
        }
        if (showsArchiveCard) {
            hideArchiveCard()
            return true
        }
        val target = model.tabs.selectedTabId?.takeIf { it in order } ?: focusedId()
        if (target != null) {
            open(target)
            return true
        }
        model.surface = AppModel.Surface.Search
        return true
    }

    fun settle(target: Int, velocity: Double = 0.0) {
        val clamped = target.coerceIn(0, max(order.size - 1, 0)).toFloat()
        val from = currentScroll
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            scroll.snapTo(from)
            dragScroll = Float.NaN
            settleOrigin = from
            val spec = if (reduceMotion) TabsMotion.fade.spec<Float>() else TabsMotion.settle.spec()
            val initial = if (reduceMotion) 0.0 else TabsMotion.settleVelocity(clamped - from.toDouble(), velocity)
            scroll.animateTo(clamped, spec, initialVelocity = initial.toFloat())
            if (scroll.value == clamped) settleOrigin = Float.NaN
        }
    }

    fun acceptsTouch(x: Double, y: Double): Boolean {
        if (phase != DeckPhase.Settled) return false
        val geometry = geometry
        if (y > geometry.barCenterY - BAR_TOUCH_CLEARANCE) return false
        return true
    }

    fun beginDrag(card: String?, dx: Double, dy: Double) {
        hideArchiveCard()
        menuFor = null
        if (card != null && card !in lifting && abs(dy) > abs(dx) && dy < 0) {
            dragAxisVertical = card
            dragHorizontal = false
            draggedLift = 0f
            draggedLiftId = card
            lifting = lifting + card
            return
        }
        dragAxisVertical = null
        dragHorizontal = true
        dragStart = currentScroll
        dragScroll = dragStart
        tickedCard = DeckOrder.focusedIndex(dragStart.toDouble(), order.size)
        scope.launch(start = CoroutineStart.UNDISPATCHED) { scroll.stop() }
    }

    fun drag(dx: Double, dy: Double) {
        val card = dragAxisVertical
        if (card != null) {
            draggedLift = (if (dy < 0) dy else dy * 0.12).toFloat()
            return
        }
        if (!dragHorizontal) return
        val raw = dragStart + geometry.scrollDelta(dx)
        val banded = TabsDeckGeometry.rubberBand(raw, order.size)
        dragScroll = banded.toFloat()
        tickIfFocusChanged(DeckOrder.focusedIndex(banded, order.size))
    }

    fun endDrag(dy: Double, velocityX: Double, velocityY: Double) {
        val card = dragAxisVertical
        dragAxisVertical = null
        if (card != null) {
            if (TabsDeckGeometry.shouldClose(dy, velocityY, geometry.cardSize.height)) {
                haptics.lightImpact()
                close(card, animated = true)
            } else {
                val start = draggedLift
                val motion = motion(card)
                draggedLiftId = null
                scope.launch(start = CoroutineStart.UNDISPATCHED) {
                    motion.lift.snapTo(start)
                    motion.lift.animateTo(0f, TabsMotion.release.spec())
                    lifting = lifting - card
                }
            }
            return
        }
        if (!dragHorizontal) return
        dragHorizontal = false
        val target = geometry.settleTarget(currentScroll.toDouble(), velocityX, order.size)
        tickIfFocusChanged(target)
        tickedCard = -1
        settle(target, geometry.scrollDelta(velocityX))
    }

    private fun tickIfFocusChanged(card: Int) {
        if (tickedCard < 0 || tickedCard == card) return
        tickedCard = card
        haptics.selection()
    }

    fun showMenu(id: String) {
        hideArchiveCard()
        menuFor = id
    }

    companion object {
        const val ARCHIVE_CARD_DELAY_MILLIS = 150L
        const val FORGET_DELAY_MILLIS = 600L
        const val BAR_TOUCH_CLEARANCE = 28.0
    }
}
