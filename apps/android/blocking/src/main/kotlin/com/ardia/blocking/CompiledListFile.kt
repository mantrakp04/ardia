package com.ardia.blocking

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.zip.CRC32
import java.util.zip.CheckedInputStream
import java.util.zip.CheckedOutputStream

internal object CompiledListFile {
    const val FORMAT = 4
    private const val MAGIC = 0x41524442
    private const val MAX_FILE_BYTES = 96L * 1024 * 1024
    private const val MAX_TEXT_BYTES = 1 shl 20

    fun write(file: File, list: ParsedFilterList, sourceSize: Long, sourceModified: Long) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(temporary).use { raw ->
            val checked = CheckedOutputStream(raw, CRC32())
            val out = DataOutputStream(BufferedOutputStream(checked, 64 * 1024))
            writeBody(out, list, sourceSize, sourceModified)
            out.flush()
            val crc = checked.checksum.value
            val trailer = DataOutputStream(raw)
            trailer.writeLong(crc)
            trailer.flush()
            raw.fd.sync()
        }
        if (!temporary.renameTo(file)) {
            file.delete()
            if (!temporary.renameTo(file)) throw IOException("could not save ${file.name}")
        }
    }

    fun read(file: File, sourceSize: Long, sourceModified: Long, budget: ListBudget = ListBudget()): ParsedFilterList? {
        if (!file.isFile) return null
        val length = file.length()
        if (length < 40 || length > MAX_FILE_BYTES) return null
        return try {
            if (!checksumMatches(file, length)) return null
            DataInputStream(BufferedInputStream(FileInputStream(file), 64 * 1024)).use { input ->
                Reader(input, length - 8, budget).list(sourceSize, sourceModified)
            }
        } catch (error: IOException) {
            null
        } catch (error: IllegalArgumentException) {
            null
        } catch (error: IndexOutOfBoundsException) {
            null
        } catch (error: OutOfMemoryError) {
            null
        }
    }

    private fun checksumMatches(file: File, length: Long): Boolean {
        val crc = CRC32()
        DataInputStream(BufferedInputStream(FileInputStream(file), 64 * 1024)).use { input ->
            val checked = CheckedInputStream(input, crc)
            val buffer = ByteArray(64 * 1024)
            var remaining = length - 8
            while (remaining > 0) {
                val read = checked.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
                if (read < 0) return false
                remaining -= read
            }
            return input.readLong() == crc.value
        }
    }

    private fun writeBody(out: DataOutputStream, list: ParsedFilterList, sourceSize: Long, sourceModified: Long) {
        out.writeInt(MAGIC)
        out.writeInt(FORMAT)
        out.writeLong(sourceSize)
        out.writeLong(sourceModified)
        out.writeText(list.id)
        out.writeInt(list.convertedLines)
        out.writeInt(list.skippedLines)
        out.writeInt(list.skipped.size)
        for ((reason, count) in list.skipped) {
            out.writeInt(reason.ordinal)
            out.writeInt(count)
        }
        out.writeInt(list.network.size)
        for (filter in list.network) {
            var flags = 0
            if (filter.isException) flags = flags or 1
            if (filter.isImportant) flags = flags or 2
            if (filter.matchCase) flags = flags or 4
            if (filter.anchorEnd) flags = flags or 8
            if (filter.isRegex) flags = flags or 16
            if (filter.host != null) flags = flags or 32
            out.writeByte(flags)
            out.writeByte(filter.party)
            out.writeByte(filter.anchor)
            out.writeInt(filter.typeMask)
            out.writeText(filter.key)
            filter.host?.let { out.writeText(it) }
            out.writeText(filter.pattern)
            out.writeTexts(filter.includeDomains)
            out.writeTexts(filter.excludeDomains)
        }
        out.writeInt(list.cosmetic.size)
        for (filter in list.cosmetic) {
            out.writeBoolean(filter.isException)
            out.writeText(filter.selector)
            out.writeTexts(filter.includeDomains)
            out.writeTexts(filter.excludeDomains)
        }
        out.writeTexts(list.badfilters.toList())
        out.writeTexts(list.documentAllows)
        out.writeTexts(list.elemhideAllows)
        out.writeTexts(list.genericHideAllows)
    }

    private fun DataOutputStream.writeText(text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        writeInt(bytes.size)
        write(bytes)
    }

    private fun DataOutputStream.writeTexts(texts: List<String>) {
        writeInt(texts.size)
        texts.forEach { writeText(it) }
    }

    private class Reader(private val input: DataInputStream, private val payloadBytes: Long, private val budget: ListBudget) {
        private var consumed = 0L
        private var buffer = ByteArray(256)
        private var units = 0
        private var chars = 0L

        fun list(sourceSize: Long, sourceModified: Long): ParsedFilterList? {
            if (int() != MAGIC || int() != FORMAT) return null
            if (long() != sourceSize || long() != sourceModified) return null
            val id = text()
            val converted = count(Int.MAX_VALUE)
            val skippedLines = count(Int.MAX_VALUE)
            val skipped = HashMap<SkipReason, Int>()
            repeat(count(SkipReason.entries.size)) {
                val reason = SkipReason.entries.getOrNull(int()) ?: throw EOFException("bad reason")
                skipped[reason] = count(Int.MAX_VALUE)
            }
            val networkCount = count(budget.maxRulesPerList)
            val network = ArrayList<NetworkFilter>(minOf(networkCount, 4096))
            repeat(networkCount) {
                val flags = byte()
                val party = byte()
                val anchor = byte()
                if (party !in 0..2 || anchor !in 0..2 || flags and 0x3F.inv() != 0) throw EOFException("bad flags")
                val typeMask = int()
                val key = text()
                val host = if (flags and 32 != 0) text().also { if (it.isEmpty()) throw EOFException("empty host") } else null
                val pattern = text()
                val filter = NetworkFilter(
                    key = key,
                    isException = flags and 1 != 0,
                    isImportant = flags and 2 != 0,
                    matchCase = flags and 4 != 0,
                    party = party,
                    typeMask = typeMask and RequestType.EVERYTHING,
                    anchor = anchor,
                    anchorEnd = flags and 8 != 0,
                    host = host,
                    pattern = pattern,
                    isRegex = flags and 16 != 0,
                    includeDomains = texts(),
                    excludeDomains = texts(),
                )
                if (filter.isRegex && filter.pattern.length > ListRegex.MAX_SOURCE_LENGTH) return null
                spend()
                network += filter
            }
            val cosmeticCount = count(budget.maxRulesPerList)
            val cosmetic = ArrayList<CosmeticFilter>(minOf(cosmeticCount, 4096))
            repeat(cosmeticCount) {
                val isException = when (byte()) {
                    0 -> false
                    1 -> true
                    else -> throw EOFException("bad flag")
                }
                val selector = text()
                if (!FilterParser.isValidSelector(selector)) return null
                cosmetic += CosmeticFilter(selector, isException, texts(), texts())
                spend()
            }
            val badfilters = texts().toSet()
            val documentAllows = texts()
            val elemhideAllows = texts()
            val genericHideAllows = texts()
            repeat(badfilters.size + documentAllows.size + elemhideAllows.size + genericHideAllows.size) { spend() }
            if (consumed != payloadBytes) return null
            return ParsedFilterList(
                id, converted, skippedLines, network, cosmetic, badfilters, documentAllows, elemhideAllows, genericHideAllows, skipped, units, chars,
            )
        }

        private fun spend() {
            units++
            if (units > budget.maxRulesPerList || chars > budget.maxCharsPerList) throw EOFException("over budget")
        }

        private fun take(bytes: Int) {
            consumed += bytes
            if (consumed > payloadBytes) throw EOFException("past the payload")
        }

        private fun byte(): Int {
            take(1)
            return input.readUnsignedByte()
        }

        private fun int(): Int {
            take(4)
            return input.readInt()
        }

        private fun long(): Long {
            take(8)
            return input.readLong()
        }

        private fun count(max: Int): Int {
            val value = int()
            if (value < 0 || value > max) throw EOFException("bad count")
            return value
        }

        fun text(): String {
            val size = int()
            if (size < 0 || size > MAX_TEXT_BYTES || consumed + size > payloadBytes) throw EOFException("bad length")
            take(size)
            if (buffer.size < size) buffer = ByteArray(maxOf(size, buffer.size * 2))
            input.readFully(buffer, 0, size)
            chars += size
            return String(buffer, 0, size, Charsets.UTF_8)
        }

        fun texts(): List<String> {
            val count = count(budget.maxRulesPerList)
            if (count == 0) return emptyList()
            if (consumed + count * 4L > payloadBytes) throw EOFException("bad count")
            return List(count) { text() }
        }
    }
}
