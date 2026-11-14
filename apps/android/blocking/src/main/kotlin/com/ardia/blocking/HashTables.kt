package com.ardia.blocking

internal object HostHash {
    private const val OFFSET = -0x340d631b7bdddcdbL
    private const val PRIME = 0x100000001b3L

    fun of(chars: CharArray, from: Int, to: Int): Long {
        var hash = OFFSET
        for (index in from until to) {
            hash = (hash xor chars[index].code.toLong()) * PRIME
        }
        return finish(hash)
    }

    fun of(text: String): Long {
        var hash = OFFSET
        for (index in text.indices) {
            hash = (hash xor text[index].code.toLong()) * PRIME
        }
        return finish(hash)
    }

    fun start(): Long = OFFSET

    fun step(hash: Long, char: Char): Long = (hash xor char.code.toLong()) * PRIME

    fun finish(hash: Long): Long = if (hash == 0L) 1L else hash
}

internal class LongHashSet(expected: Int = 16) {
    private var keys = LongArray(capacityFor(expected))
    var size = 0
        private set

    fun add(key: Long): Boolean {
        if ((size + 1) * 2 > keys.size) grow()
        return insert(keys, key)
    }

    fun contains(key: Long): Boolean {
        val table = keys
        val mask = table.size - 1
        var slot = mix(key) and mask
        while (true) {
            val current = table[slot]
            if (current == key) return true
            if (current == 0L) return false
            slot = (slot + 1) and mask
        }
    }

    fun containsAny(hashes: LongArray, count: Int): Boolean {
        if (size == 0) return false
        for (index in 0 until count) if (contains(hashes[index])) return true
        return false
    }

    private fun insert(table: LongArray, key: Long): Boolean {
        val mask = table.size - 1
        var slot = mix(key) and mask
        while (true) {
            val current = table[slot]
            if (current == key) return false
            if (current == 0L) {
                table[slot] = key
                size++
                return true
            }
            slot = (slot + 1) and mask
        }
    }

    private fun grow() {
        val old = keys
        keys = LongArray(old.size * 2)
        size = 0
        for (key in old) if (key != 0L) insert(keys, key)
    }
}

internal class LongBuckets private constructor(
    private val keys: LongArray,
    private val starts: IntArray,
    private val ends: IntArray,
    val ids: IntArray,
) {
    val isEmpty: Boolean get() = ids.isEmpty()

    fun slot(key: Long): Int {
        if (ids.isEmpty()) return -1
        val mask = keys.size - 1
        var slot = mix(key) and mask
        while (true) {
            val current = keys[slot]
            if (current == key) return slot
            if (current == 0L) return -1
            slot = (slot + 1) and mask
        }
    }

    fun start(slot: Int): Int = starts[slot]

    fun end(slot: Int): Int = ends[slot]

    class Builder {
        private val grouped = LinkedHashMap<Long, MutableList<Int>>()

        fun add(key: Long, id: Int) {
            grouped.getOrPut(key) { ArrayList(2) }.add(id)
        }

        fun build(): LongBuckets {
            val capacity = capacityFor(grouped.size)
            val keys = LongArray(capacity)
            val starts = IntArray(capacity)
            val ends = IntArray(capacity)
            val ids = IntArray(grouped.values.sumOf { it.size })
            var cursor = 0
            val mask = capacity - 1
            for ((key, list) in grouped) {
                var slot = mix(key) and mask
                while (keys[slot] != 0L) slot = (slot + 1) and mask
                keys[slot] = key
                starts[slot] = cursor
                for (id in list) ids[cursor++] = id
                ends[slot] = cursor
            }
            return LongBuckets(keys, starts, ends, ids)
        }
    }
}

private fun capacityFor(expected: Int): Int {
    var capacity = 16
    while (capacity < expected * 2 + 2) capacity = capacity shl 1
    return capacity
}

private fun mix(key: Long): Int {
    var value = key xor (key ushr 33)
    value *= -0xae502812aa7333L
    value = value xor (value ushr 29)
    return value.toInt()
}
