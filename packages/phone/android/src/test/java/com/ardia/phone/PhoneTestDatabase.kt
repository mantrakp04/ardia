package com.ardia.phone

import java.io.File
import java.nio.file.Files
import java.sql.Connection
import java.sql.DriverManager

internal object PhoneTestDatabase {
    private val schemaFile = File(System.getProperty("ardia.phoneSchema") ?: error("ardia.phoneSchema isn't set"))

    fun schema(): List<String> {
        val source = schemaFile.readText()
        val block = source.substringAfter("0: [").substringBefore("],\n};")
        val statements = ArrayList<String>()
        val current = StringBuilder()
        val piece = Regex("\"((?:[^\"\\\\]|\\\\.)*)\"\\s*(\\+)?")
        for (match in piece.findAll(block)) {
            current.append(match.groupValues[1])
            if (match.groupValues[2].isEmpty()) {
                statements += current.toString()
                current.clear()
            }
        }
        return statements
    }

    fun create(file: File, version: Int = 1, seed: (Connection) -> Unit = {}): File {
        file.parentFile?.mkdirs()
        DriverManager.getConnection("jdbc:sqlite:${file.path}").use { connection ->
            connection.createStatement().use { statement ->
                schema().forEach(statement::execute)
                statement.execute("PRAGMA user_version = $version")
                statement.execute("PRAGMA journal_mode = WAL")
            }
            seed(connection)
        }
        return file
    }

    fun database(seed: (Connection) -> Unit): File =
        create(File(Files.createTempDirectory("phone-browser").toFile().apply { deleteOnExit() }, "browser.db"), seed = seed)
}

internal fun Connection.tab(id: String, url: String, lastActive: Long, profile: String? = null, archived: Long? = null) {
    prepareStatement("INSERT INTO tabs (id, url, title, created, lastActive, archivedAt, position, profileSyncId, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'typed')").use {
        it.setString(1, id)
        it.setString(2, url)
        it.setString(3, "Title $id")
        it.setLong(4, lastActive)
        it.setLong(5, lastActive)
        if (archived == null) it.setNull(6, java.sql.Types.INTEGER) else it.setLong(6, archived)
        it.setDouble(7, lastActive.toDouble())
        it.setString(8, profile)
        it.execute()
    }
}

internal fun Connection.visit(url: String, at: Long, profile: String? = null, title: String = "Visit") {
    prepareStatement("INSERT INTO visits (url, title, visitedAt, profileSyncId, transition) VALUES (?, ?, ?, ?, 'link')").use {
        it.setString(1, url)
        it.setString(2, title)
        it.setLong(3, at)
        it.setString(4, profile)
        it.execute()
    }
}

internal class JdbcRows(private val file: File) : BrowserRows {
    override fun query(sql: String, args: List<String>): List<List<Any?>>? {
        if (!file.isFile) return null
        DriverManager.getConnection("jdbc:sqlite:${file.path}").use { connection ->
            connection.prepareStatement(sql).use { statement ->
                args.forEachIndexed { index, value -> statement.setString(index + 1, value) }
                statement.executeQuery().use { result ->
                    val columns = result.metaData.columnCount
                    return buildList { while (result.next()) add(List(columns) { result.getObject(it + 1) }) }
                }
            }
        }
    }
}
