package com.ardia.design

object TabsBackdropMotion {
    const val SLOW_LOOP_MILLIS = 10_000
    const val FAST_LOOP_MILLIS = 7_000

    val loopsMillis = intArrayOf(
        SLOW_LOOP_MILLIS,
        FAST_LOOP_MILLIS,
        (SLOW_LOOP_MILLIS * 1.3).toInt(),
    )
    val anchors = floatArrayOf(0.42f, 0.38f, 0.6f, 0.58f, 0.5f, 0.45f)
    val placements = floatArrayOf(0.18f, 0.22f, 0.86f, 0.5f, 0.3f, 0.86f)
}

object DeckBackdropStyle {
    fun blobOpacity(dark: Boolean): Float = if (dark) 0.7f else 0.85f

    fun grainOpacity(dark: Boolean): Float = if (dark) 0.06f else 0.08f

    const val BLOB_SIDE_SHARE = 0.95f
}
