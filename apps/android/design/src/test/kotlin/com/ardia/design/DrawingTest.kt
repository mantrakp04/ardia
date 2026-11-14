package com.ardia.design

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

class MeshRasterTest {
    private val red = Color(1f, 0f, 0f)
    private val green = Color(0f, 1f, 0f)
    private val blue = Color(0f, 0f, 1f)
    private val white = Color(1f, 1f, 1f)

    @Test
    fun `each corner of the raster is its vertex colour`() {
        val mesh = MeshGrid.uniform(2, 2, listOf(red, green, blue, white))
        val pixels = MeshRaster.render(mesh, 9, 9)
        assertEquals(0xFFFF0000.toInt(), pixels[0])
        assertEquals(0xFF00FF00.toInt(), pixels[8])
        assertEquals(0xFF0000FF.toInt(), pixels[72])
        assertEquals(0xFFFFFFFF.toInt(), pixels[80])
    }

    @Test
    fun `a moved interior point pulls its colour with it`() {
        val points = listOf(0f, 0f, 0.55f, 0f, 1f, 0f, 0f, 0.5f, 0.62f, 0.42f, 1f, 0.55f, 0f, 1f, 0.5f, 1f, 1f, 1f)
        val mesh = MeshGrid(3, 3, points, listOf(red, green, blue, green, blue, white, blue, white, white))
        val grid = FloatArray(2)
        MeshRaster.locate(mesh, 0.62f, 0.42f, grid)
        assertEquals(1f, grid[0], 1e-3f)
        assertEquals(1f, grid[1], 1e-3f)
        MeshRaster.locate(mesh, 0.31f, 0.21f, grid)
        assertTrue(grid[0] in 0.4f..0.6f && grid[1] in 0.4f..0.6f)
    }

    @Test
    fun `film grain repeats the iPhone's xorshift texture`() {
        val values = GrainTexture.values()
        assertArrayEquals(intArrayOf(89, 126, 122, 117, 95, 119, 144, 127), values.copyOfRange(0, 8))
        assertTrue(values.all { it in 64..191 })
    }
}

class SymbolTest {
    private val iphoneSymbols = listOf(
        "link", "exclamationmark.triangle.fill", "xmark", "square.and.arrow.up", "plus", "macbook.and.iphone", "trash", "macbook", "globe",
        "checkmark", "archivebox.fill", "archivebox", "square.stack", "square.and.arrow.up.fill", "paperplane.fill",
        "list.bullet.rectangle.portrait.fill", "laptopcomputer", "hand.raised.fill", "folder.fill", "eyes", "eyeglasses", "eraser.fill",
        "doc.plaintext", "arrow.up.forward.square", "xmark.circle.fill", "textformat.size.smaller", "textformat.size.larger", "textformat.size",
        "text.magnifyingglass", "stop.fill", "star.fill", "star", "square.on.square.dashed", "square.on.square", "sparkles", "shield.lefthalf.filled",
        "safari.fill", "qrcode.viewfinder", "platter.filled.bottom.and.arrow.down.iphone", "pin.fill", "moon.fill", "minus", "mic.fill", "mic",
        "magnifyingglass", "list.bullet.rectangle", "line.3.horizontal.decrease", "laptopcomputer.and.arrow.down", "keyboard.fill", "info",
        "hand.wave.fill", "hand.point.up.left.fill", "hand.draw.fill", "hand.draw", "gearshape", "gear", "equal.circle.fill", "ellipsis",
        "doc.text", "doc.on.doc", "clock.arrow.circlepath", "chevron.up.chevron.down", "chevron.up", "chevron.left.forwardslash.chevron.right",
        "checkmark.shield.fill", "checkmark.shield", "checkmark.icloud.fill", "checkmark.circle.fill", "character.cursor.ibeam",
        "arrow.uturn.backward", "arrow.up.forward.app.fill", "arrow.up.forward", "arrow.right.circle", "arrow.right", "arrow.down.circle.fill",
        "iphone", "paintpalette.fill",
    )

    @Test
    fun `every SF Symbol the iPhone app names has a vector that builds`() {
        for (name in iphoneSymbols) {
            val vector = ArdiaSymbols.named(name)
            assertNotNull(name, vector)
            assertEquals(name, 24f, vector!!.viewportWidth, 0f)
        }
        assertEquals(null, ArdiaSymbols.named("not.a.symbol"))
    }

    @Test
    fun `a thick straight line is a rectangle around it`() {
        val outline = SymbolGeometry.thickPolyline(floatArrayOf(0f, 0f, 10f, 0f), 1f)
        assertArrayEquals(floatArrayOf(0f, 1f, 10f, 1f, 10f, -1f, 0f, -1f), outline, 1e-5f)
    }

    @Test
    fun `a thick bend keeps its width at the joint`() {
        val outline = SymbolGeometry.thickPolyline(floatArrayOf(0f, 0f, 5f, 5f, 10f, 0f), 1f)
        assertEquals(12, outline.size)
        val innerJoint = hypot(outline[2] - 5f, outline[3] - 5f)
        assertEquals(hypot(1f, 1f), innerJoint, 1e-4f)
    }

    @Test
    fun `stars, gears and crosses have the expected corners`() {
        val star = SymbolGeometry.star(12f, 12f, 10f, 4f)
        assertEquals(20, star.size)
        assertEquals(12f, star[0], 1e-4f)
        assertEquals(2f, star[1], 1e-4f)
        assertEquals(64, SymbolGeometry.gear(12f, 12f, 9f, 7f, 8).size)
        val cross = SymbolGeometry.cross(12f, 12f, 4f, 1f)
        assertEquals(24, cross.size)
        for (index in cross.indices step 2) assertTrue(hypot(cross[index] - 12f, cross[index + 1] - 12f) <= hypot(4f, 1f) + 1e-4f)
    }
}
