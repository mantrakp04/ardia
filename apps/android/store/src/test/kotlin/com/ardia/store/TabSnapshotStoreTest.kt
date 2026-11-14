package com.ardia.store

import android.graphics.Bitmap
import android.graphics.Color
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

class HeldDispatcher : CoroutineDispatcher() {
    private val held = ArrayDeque<Runnable>()

    override fun dispatch(context: CoroutineContext, block: Runnable) {
        held.addLast(block)
    }

    fun release() {
        while (held.isNotEmpty()) held.removeFirst().run()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class TabSnapshotStoreTest {
    private val directory: File = Files.createTempDirectory("snapshots").toFile()

    @After
    fun cleanUp() {
        directory.deleteRecursively()
    }

    private fun solid(color: Int, width: Int = 40, height: Int = 80): Bitmap =
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }

    @Test
    fun firstAndLaterSavesBothReachDiskAndARelaunchReadsThem() = runTest {
        val id = BrowserTab.newId()
        val first = TabSnapshotStore(directory)
        val name = first.save(solid(Color.DKGRAY), id)!!
        assertTrue(File(directory, name).exists())
        assertEquals(name, first.save(solid(Color.LTGRAY), id))
        val image = TabSnapshotStore(directory).image(name)
        assertNotNull(image)
        assertEquals(40, image!!.width)
        assertTrue(directory.list()!!.none { it.startsWith(".") })
    }

    @Test
    fun wideImagesShrinkToSixHundredPixelsKeepingTheirShape() = runTest {
        val store = TabSnapshotStore(directory)
        val name = store.save(solid(Color.BLUE, 1200, 2400), BrowserTab.newId())!!
        val decoded = TabSnapshotStore(directory).image(name)!!
        assertEquals(TabSnapshotStore.PIXEL_WIDTH, decoded.width)
        assertEquals(1200, decoded.height)
    }

    @Test
    fun aTabDeletedDuringItsFirstSaveLeavesNoImage() = runTest {
        val disk = HeldDispatcher()
        val store = TabSnapshotStore(directory, disk)
        val id = BrowserTab.newId()
        val saving = async { store.save(solid(Color.GRAY), id) }
        testScheduler.runCurrent()
        store.removeTabs(listOf(id))
        disk.release()
        assertTrue(directory.list().orEmpty().isEmpty())
        testScheduler.runCurrent()
        disk.release()
        assertNull(saving.await())
        assertNull(store.save(solid(Color.GRAY), id))
        assertTrue(directory.list().orEmpty().isEmpty())
    }

    @Test
    fun cancellingASaveWhoseTabWasDeletedStillLeavesNoImage() = runTest {
        val disk = HeldDispatcher()
        val store = TabSnapshotStore(directory, disk)
        val id = BrowserTab.newId()
        val saving = async { store.save(solid(Color.GRAY), id) }
        testScheduler.runCurrent()
        store.removeTabs(listOf(id))
        disk.release()
        saving.cancel()
        testScheduler.runCurrent()
        assertTrue(saving.isCancelled)
        assertTrue(directory.list().orEmpty().isEmpty())
    }

    @Test
    fun privateTabImagesStayInMemory() = runTest {
        val store = TabSnapshotStore(directory)
        val id = BrowserTab.newId()
        val name = store.keepInMemory(solid(Color.RED, 900, 900), id)
        assertEquals(TabSnapshotStore.PIXEL_WIDTH, store.image(name)!!.width)
        assertTrue(directory.list().orEmpty().isEmpty())
        store.removeTabs(listOf(id))
        assertNull(store.image(name))
    }
}
