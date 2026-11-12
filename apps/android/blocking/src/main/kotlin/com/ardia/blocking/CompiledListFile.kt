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

internal object CompiledListFile {
    const val FORMAT = 1
    private const val MAGIC = 0x41524442

    fun write(file: File, list: ParsedFilterList, sourceSize: Long, sourceModified: Long) {
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, file.name + ".tmp")
        DataOutputStream(BufferedOutputStream(FileOutputStream(temporary), 64 * 1024)).use { out ->
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
        if (!temporary.renameTo(file)) {
            file.delete()
            if (!temporary.renameTo(file)) throw IOException("could not save ${file.name}")
        }
    }

    fun read(file: File, sourceSize: Long, sourceModified: Long): ParsedFilterList? {
        if (!file.isFile) return null
        return try {
            DataInputStream(BufferedInputStream(FileInputStream(file), 64 * 1024)).use { input -> readList(input, sourceSize, sourceModified) }
        } catch (error: IOException) {
            null
        } catch (error: IllegalArgumentException) {
            null
        } catch (error: IndexOutOfBoundsException) {
            null
        }
    }

    private fun readList(input: DataInputStream, sourceSize: Long, sourceModified: Long): ParsedFilterList? {
        if (input.readInt() != MAGIC || input.readInt() != FORMAT) return null
        if (input.readLong() != sourceSize || input.readLong() != sourceModified) return null
        val reader = TextReader(input)
        val id = reader.text()
        val converted = input.readInt()
        val skippedLines = input.readInt()
        val skipped = HashMap<SkipReason, Int>()
        repeat(input.readInt()) { skipped[SkipReason.entries[input.readInt()]] = input.readInt() }
        val networkCount = input.readInt()
        val network = ArrayList<NetworkFilter>(networkCount)
        repeat(networkCount) {
            val flags = input.readByte().toInt()
            val party = input.readByte().toInt()
            val anchor = input.readByte().toInt()
            val typeMask = input.readInt()
            val key = reader.text()
            val host = if (flags and 32 != 0) reader.text() else null
            val pattern = reader.text()
            network += NetworkFilter(
                key = key,
                isException = flags and 1 != 0,
                isImportant = flags and 2 != 0,
                matchCase = flags and 4 != 0,
                party = party,
                typeMask = typeMask,
                anchor = anchor,
                anchorEnd = flags and 8 != 0,
                host = host,
                pattern = pattern,
                isRegex = flags and 16 != 0,
                includeDomains = reader.texts(),
                excludeDomains = reader.texts(),
            )
        }
        val cosmeticCount = input.readInt()
        val cosmetic = ArrayList<CosmeticFilter>(cosmeticCount)
        repeat(cosmeticCount) {
            val isException = input.readBoolean()
            cosmetic += CosmeticFilter(reader.text(), isException, reader.texts(), reader.texts())
        }
        val badfilters = reader.texts().toSet()
        val documentAllows = reader.texts()
        val elemhideAllows = reader.texts()
        val genericHideAllows = reader.texts()
        if (input.read() != -1) return null
        return ParsedFilterList(id, converted, skippedLines, network, cosmetic, badfilters, documentAllows, elemhideAllows, genericHideAllows, skipped)
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

    private class TextReader(private val input: DataInputStream) {
        private var buffer = ByteArray(256)

        fun text(): String {
            val size = input.readInt()
            if (size < 0 || size > 16 * 1024 * 1024) throw EOFException("bad length")
            if (buffer.size < size) buffer = ByteArray(size * 2)
            input.readFully(buffer, 0, size)
            return String(buffer, 0, size, Charsets.UTF_8)
        }

        fun texts(): List<String> {
            val count = input.readInt()
            if (count == 0) return emptyList()
            if (count < 0) throw EOFException("bad count")
            return List(count) { text() }
        }
    }
}
