package com.ardia.design

import android.graphics.Bitmap

object GrainTexture {
    const val SIDE = 128

    fun values(): IntArray {
        var state = 0x9E3779B9.toInt()
        val values = IntArray(SIDE * SIDE)
        for (index in values.indices) {
            state = state xor (state shl 13)
            state = state xor (state ushr 17)
            state = state xor (state shl 5)
            values[index] = 64 + (state.toUInt() % 128u).toInt()
        }
        return values
    }

    internal val bitmap: Bitmap by lazy {
        val pixels = values().map { value -> (0xFF shl 24) or (value shl 16) or (value shl 8) or value }.toIntArray()
        Bitmap.createBitmap(pixels, SIDE, SIDE, Bitmap.Config.ARGB_8888)
    }
}
