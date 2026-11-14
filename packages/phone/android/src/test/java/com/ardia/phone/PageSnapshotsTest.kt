package com.ardia.phone

import android.graphics.Bitmap
import android.graphics.Color
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PageSnapshotsTest {
    private val snapshots = PageSnapshots(RuntimeEnvironment.getApplication())

    private fun page(): Bitmap = Bitmap.createBitmap(64, 128, Bitmap.Config.ARGB_8888).apply {
        eraseColor(Color.WHITE)
        for (y in 0 until 128) for (x in 0 until 64) if ((x / 8 + y / 8) % 2 == 0) setPixel(x, y, Color.rgb(20 + x, 40 + y, 200))
    }

    private fun white(): Bitmap = Bitmap.createBitmap(64, 128, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }

    private fun files(): List<File> = File(RuntimeEnvironment.getApplication().filesDir, "PageSnapshots").listFiles()?.toList().orEmpty()

    @Test
    fun aBlankCaptureKeepsTheGoodThumbnailItWouldHaveReplaced() = runBlocking {
        val good = snapshots.write("tab-1", page(), isPrivate = false, quality = 80)
        assertNotNull(good)
        val blank = snapshots.write("tab-1", white(), isPrivate = false, quality = 80)
        assertEquals(good!!["path"], blank!!["path"])
        assertEquals(true, blank["kept"])
        assertEquals(listOf(File(good["path"] as String).name), files().map { it.name })
        Thread.sleep(2)
        val better = snapshots.write("tab-1", page(), isPrivate = false, quality = 80)
        assertTrue(better!!["path"] != good["path"])
        assertEquals(listOf(File(better["path"] as String).name), files().map { it.name })
    }

    @Test
    fun aBlankCaptureIsStillWrittenWhenThereIsNothingToKeep() = runBlocking {
        val first = snapshots.write("tab-2", white(), isPrivate = false, quality = 80)
        assertNotNull(first)
        assertTrue(File(first!!["path"] as String).isFile)
    }
}
