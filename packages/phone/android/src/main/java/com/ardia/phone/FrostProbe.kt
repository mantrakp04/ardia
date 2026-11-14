package com.ardia.phone

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.PixelCopy

object FrostProbe {
    data class Reading(val meanLuma: Int, val nearBlackShare: Int)

    fun read(pixels: IntArray): Reading {
        if (pixels.isEmpty()) return Reading(0, 100)
        var total = 0L
        var black = 0
        for (pixel in pixels) {
            val luma = (((pixel shr 16) and 0xFF) * 2126 + ((pixel shr 8) and 0xFF) * 7152 + (pixel and 0xFF) * 722) / 10000
            total += luma
            if (luma < 16) black += 1
        }
        return Reading((total / pixels.size).toInt(), black * 100 / pixels.size)
    }

    fun probe(activity: Activity) {
        val frosts = FrostSources.frosts().filter { it.isShown && it.width > 0 && it.height > 0 }
        Log.i("PAGELAB", "PAGELAB look frost probe: ${frosts.size} frost(s) on screen, page mode ${FrostSources.pageMode.raw}")
        for (frost in frosts) {
            val location = IntArray(2).also(frost::getLocationInWindow)
            val region = Rect(location[0], location[1], location[0] + frost.width, location[1] + frost.height)
            val bitmap = Bitmap.createBitmap(frost.width, frost.height, Bitmap.Config.ARGB_8888)
            val choice = frost.lastChoice
            val page = FrostSources.find(frost.source)?.holdsPage == true
            runCatching {
                PixelCopy.request(activity.window, region, bitmap, { result ->
                    if (result == PixelCopy.SUCCESS) {
                        val pixels = IntArray(bitmap.width * bitmap.height).also { bitmap.getPixels(it, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height) }
                        val reading = read(pixels)
                        Log.i("PAGELAB", "PAGELAB look frost probe ${frost.source ?: "-"}: path ${choice?.path?.name?.lowercase() ?: "none"}, page $page, mean luma ${reading.meanLuma}, near-black ${reading.nearBlackShare}%")
                    } else {
                        Log.i("PAGELAB", "PAGELAB look frost probe ${frost.source ?: "-"}: copy failed ($result)")
                    }
                    bitmap.recycle()
                }, Handler(Looper.getMainLooper()))
            }.onFailure { Log.i("PAGELAB", "PAGELAB look frost probe: copy refused (${it.javaClass.simpleName})") }
        }
    }
}
