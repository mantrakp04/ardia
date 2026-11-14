package com.ardia.sync

import kotlinx.serialization.json.Json

internal val syncJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}
