package com.ardia.shared

enum class SharedScript(val fileName: String, val global: String) {
    SYNC("ardia-sync", "ArdiaSync"),
    CORE("ardia-core", "ArdiaCore");

    val assetName: String get() = "$fileName.hbc"
}
