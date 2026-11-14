package com.ardia.shared

enum class SharedScript(val fileName: String, val global: String) {
    SYNC("ardia-sync", "ArdiaSync"),
    CORE("ardia-core", "ArdiaCore"),
    SYNC_CHECKS("ardia-sync-checks", "ArdiaSyncChecks");

    val assetName: String get() = "$fileName.hbc"
}
