package com.ardia.blocking

import java.util.concurrent.atomic.AtomicReferenceArray

class EngineSource(val list: ParsedFilterList, val category: BlockingCategory?, val isOwner: Boolean = false) {
    internal val categoryBit: Int get() = category?.bit ?: BlockingSettings.OWNER_BIT
}

internal class RuleSet(val block: RuleIndex, val important: RuleIndex, val exception: RuleIndex) {
    val isEmpty: Boolean get() = block.size == 0 && important.size == 0 && exception.size == 0

    class Builder {
        val block = RuleIndex.Builder()
        val important = RuleIndex.Builder()
        val exception = RuleIndex.Builder()

        fun add(filter: NetworkFilter, categoryBit: Int) = when {
            filter.isException -> exception.add(filter, categoryBit)
            filter.isImportant -> important.add(filter, categoryBit)
            else -> block.add(filter, categoryBit)
        }

        fun build() = RuleSet(block.build(), important.build(), exception.build())
    }
}

data class EngineStats(
    val blockRules: Int,
    val importantRules: Int,
    val exceptionRules: Int,
    val unindexedRules: Int,
    val genericSelectors: Int,
    val scopedSelectors: Int,
    val regexRulesOverCap: Int = 0,
)

class FilterEngine internal constructor(
    private val lists: RuleSet,
    private val owner: RuleSet,
    private val documentAllows: LongHashSet,
    private val elemhideAllows: LongHashSet,
    private val genericHideAllows: LongHashSet,
    private val cosmetic: CosmeticIndex,
    private val regexRulesOverCap: Int = 0,
) {
    val stats: EngineStats
        get() = EngineStats(
            blockRules = lists.block.size + owner.block.size,
            importantRules = lists.important.size + owner.important.size,
            exceptionRules = lists.exception.size + owner.exception.size,
            unindexedRules = listOf(lists, owner).sumOf { it.block.unindexedCount + it.important.unindexedCount + it.exception.unindexedCount },
            genericSelectors = cosmetic.genericCount,
            scopedSelectors = cosmetic.scopedCount,
            regexRulesOverCap = regexRulesOverCap,
        )

    internal fun blocks(context: RequestContext): Boolean {
        if (context.pageKnown && documentAllows.containsAny(context.pageSuffixHashes, context.pageSuffixCount)) return false
        if (lists.important.matches(context)) return true
        if (lists.block.matches(context) && !lists.exception.matches(context) && !owner.exception.matches(context)) return true
        if (owner.isEmpty) return false
        if (owner.important.matches(context)) return true
        return owner.block.matches(context) && !owner.exception.matches(context)
    }

    internal fun hidingCss(context: RequestContext): HidingCss? {
        val suffixes = context.pageSuffixHashes
        val count = context.pageSuffixCount
        if (documentAllows.containsAny(suffixes, count) || elemhideAllows.containsAny(suffixes, count)) return null
        val generic = !genericHideAllows.containsAny(suffixes, count)
        val mask = context.categoryMask
        return HidingCss(
            generic = if (generic) cosmetic.genericCss(mask) else "",
            specific = cosmetic.specificCss(suffixes, count, mask, includeGeneric = generic),
        )
    }

    internal class HidingCss(val generic: String, val specific: String)

    companion object {
        fun build(sources: List<EngineSource>): FilterEngine {
            val badfilters = HashSet<String>()
            sources.forEach { badfilters += it.list.badfilters }
            val lists = RuleSet.Builder()
            val owner = RuleSet.Builder()
            val documentAllows = LongHashSet()
            val elemhideAllows = LongHashSet()
            val genericHideAllows = LongHashSet()
            val cosmetic = CosmeticIndex.Builder()
            var unindexedRegex = 0
            var overCap = 0
            for (source in sources) {
                val target = if (source.isOwner) owner else lists
                val bit = source.categoryBit
                for (filter in source.list.network) {
                    if (filter.key in badfilters) continue
                    if (ListRegex.isUnindexed(filter) && ++unindexedRegex > ListRegex.MAX_UNINDEXED_TOTAL) {
                        overCap++
                        continue
                    }
                    target.add(filter, bit)
                }
                source.list.documentAllows.forEach { documentAllows.add(HostHash.of(it)) }
                source.list.elemhideAllows.forEach { elemhideAllows.add(HostHash.of(it)) }
                source.list.genericHideAllows.forEach { genericHideAllows.add(HostHash.of(it)) }
                for (filter in source.list.cosmetic) cosmetic.add(filter, bit, source.isOwner)
            }
            return FilterEngine(lists.build(), owner.build(), documentAllows, elemhideAllows, genericHideAllows, cosmetic.build(), overCap)
        }
    }
}

internal class CosmeticIndex private constructor(
    private val genericByCategory: Map<Int, List<String>>,
    private val conditional: List<Entry>,
    private val specific: Array<Entry>,
    private val byDomain: LongBuckets,
) {
    private val cssByMask = AtomicReferenceArray<String>(32)

    val genericCount: Int get() = genericByCategory.values.sumOf { it.size }
    val scopedCount: Int get() = conditional.size + specific.size

    class HideException(val include: LongArray?, val exclude: LongArray?)

    class Entry(val selector: String, val categoryBit: Int, val include: LongArray?, val exclude: LongArray?, val exceptions: List<HideException>)

    fun genericCss(mask: Int): String {
        val slot = mask and 31
        cssByMask.get(slot)?.let { return it }
        val selectors = ArrayList<String>()
        for ((bit, list) in genericByCategory) if (bit and mask != 0) selectors += list
        val css = Css.hide(selectors)
        cssByMask.compareAndSet(slot, null, css)
        return cssByMask.get(slot)
    }

    fun specificCss(suffixes: LongArray, count: Int, mask: Int, includeGeneric: Boolean): String {
        val selectors = LinkedHashSet<String>()
        if (includeGeneric) {
            for (entry in conditional) if (applies(entry, suffixes, count, mask)) selectors += entry.selector
        }
        if (!byDomain.isEmpty) {
            for (index in 0 until count) {
                val slot = byDomain.slot(suffixes[index])
                if (slot < 0) continue
                for (cursor in byDomain.start(slot) until byDomain.end(slot)) {
                    val entry = specific[byDomain.ids[cursor]]
                    if (applies(entry, suffixes, count, mask)) selectors += entry.selector
                }
            }
        }
        return Css.hide(selectors.toList())
    }

    private fun applies(entry: Entry, suffixes: LongArray, count: Int, mask: Int): Boolean {
        if (entry.categoryBit and mask == 0) return false
        if (!DomainMatch.applies(suffixes, count, entry.include, entry.exclude)) return false
        for (exception in entry.exceptions) if (DomainMatch.applies(suffixes, count, exception.include, exception.exclude)) return false
        return true
    }

    class Builder {
        private class Hide(val filter: CosmeticFilter, val categoryBit: Int, val isOwner: Boolean)

        private class ScopedException(val exception: HideException, val isOwner: Boolean)

        private val hides = ArrayList<Hide>()
        private val listGenericExceptions = HashSet<String>()
        private val ownerGenericExceptions = HashSet<String>()
        private val scopedExceptions = HashMap<String, MutableList<ScopedException>>()

        fun add(filter: CosmeticFilter, categoryBit: Int, isOwner: Boolean) {
            if (!filter.isException) {
                hides += Hide(filter, categoryBit, isOwner)
                return
            }
            if (filter.includeDomains.isEmpty() && filter.excludeDomains.isEmpty()) {
                if (isOwner) ownerGenericExceptions += filter.selector else listGenericExceptions += filter.selector
                return
            }
            val exception = HideException(DomainMatch.hashes(filter.includeDomains), DomainMatch.hashes(filter.excludeDomains))
            scopedExceptions.getOrPut(filter.selector) { ArrayList(1) } += ScopedException(exception, isOwner)
        }

        fun build(): CosmeticIndex {
            val generic = LinkedHashMap<Int, MutableList<String>>()
            val seenGeneric = HashMap<Int, HashSet<String>>()
            val conditional = ArrayList<Entry>()
            val specific = ArrayList<Entry>()
            val byDomain = LongBuckets.Builder()
            for (hide in hides) {
                val filter = hide.filter
                val selector = filter.selector
                if (selector in ownerGenericExceptions) continue
                if (!hide.isOwner && selector in listGenericExceptions) continue
                val exceptions = scopedExceptions[selector].orEmpty().filter { it.isOwner || !hide.isOwner }.map { it.exception }
                val include = DomainMatch.hashes(filter.includeDomains)
                val exclude = DomainMatch.hashes(filter.excludeDomains)
                when {
                    include == null && exclude == null && exceptions.isEmpty() -> {
                        if (seenGeneric.getOrPut(hide.categoryBit) { HashSet() }.add(selector)) {
                            generic.getOrPut(hide.categoryBit) { ArrayList() } += selector
                        }
                    }
                    include == null -> conditional += Entry(selector, hide.categoryBit, null, exclude, exceptions)
                    else -> {
                        val id = specific.size
                        specific += Entry(selector, hide.categoryBit, include, exclude, exceptions)
                        filter.includeDomains.forEach { byDomain.add(HostHash.of(it), id) }
                    }
                }
            }
            return CosmeticIndex(generic, conditional, specific.toTypedArray(), byDomain.build())
        }
    }
}

internal object Css {
    private const val SELECTORS_PER_RULE = 100

    fun hide(selectors: List<String>): String {
        if (selectors.isEmpty()) return ""
        val out = StringBuilder(selectors.size * 32)
        for (start in selectors.indices step SELECTORS_PER_RULE) {
            val end = minOf(start + SELECTORS_PER_RULE, selectors.size)
            for (index in start until end) {
                if (index > start) out.append(',')
                out.append(selectors[index])
            }
            out.append("{display:none!important}\n")
        }
        return out.toString()
    }
}
