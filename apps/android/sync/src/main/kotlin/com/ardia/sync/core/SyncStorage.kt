package com.ardia.sync.core

interface SyncStorage {
    val name: String

    fun names(path: List<String>): List<String>?

    fun isDirectory(path: List<String>): Boolean

    fun makeDirectory(path: List<String>)

    fun removeTree(path: List<String>)

    fun read(path: List<String>): ByteArray

    fun write(path: List<String>, bytes: ByteArray)

    fun remove(path: List<String>): Boolean

    fun ageMillis(path: List<String>): Long?
}
