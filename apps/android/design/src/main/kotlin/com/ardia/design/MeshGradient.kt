package com.ardia.design

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sqrt

@Immutable
internal data class MeshGrid(val columns: Int, val rows: Int, val points: List<Float>, val colors: List<Color>) {
    init {
        require(columns >= 2 && rows >= 2) { "a mesh needs at least 2 by 2 points" }
        require(points.size == columns * rows * 2) { "a mesh needs one point per vertex" }
        require(colors.size == columns * rows) { "a mesh needs one colour per vertex" }
    }

    companion object {
        fun uniform(columns: Int, rows: Int, colors: List<Color>): MeshGrid {
            val points = ArrayList<Float>(columns * rows * 2)
            for (row in 0 until rows) {
                for (column in 0 until columns) {
                    points += column.toFloat() / (columns - 1)
                    points += row.toFloat() / (rows - 1)
                }
            }
            return MeshGrid(columns, rows, points, colors)
        }
    }
}

internal object MeshRaster {
    fun render(mesh: MeshGrid, width: Int, height: Int): IntArray {
        val channels = Array(mesh.colors.size) { index ->
            val color = mesh.colors[index].convert(ColorSpaces.Srgb)
            floatArrayOf(color.red, color.green, color.blue, color.alpha)
        }
        val pixels = IntArray(width * height)
        val grid = FloatArray(2)
        for (y in 0 until height) {
            val v = if (height == 1) 0f else y.toFloat() / (height - 1)
            for (x in 0 until width) {
                val u = if (width == 1) 0f else x.toFloat() / (width - 1)
                locate(mesh, u, v, grid)
                pixels[y * width + x] = sample(mesh, channels, grid[0], grid[1])
            }
        }
        return pixels
    }

    internal fun locate(mesh: MeshGrid, u: Float, v: Float, out: FloatArray) {
        var bestColumn = 0f
        var bestRow = 0f
        var bestError = Float.MAX_VALUE
        for (row in 0 until mesh.rows - 1) {
            for (column in 0 until mesh.columns - 1) {
                val local = inverseBilinear(mesh, column, row, u, v) ?: continue
                val s = local[0]
                val t = local[1]
                val error = outside(s) + outside(t)
                if (error < bestError) {
                    bestError = error
                    bestColumn = column + s.coerceIn(0f, 1f)
                    bestRow = row + t.coerceIn(0f, 1f)
                }
                if (error == 0f) {
                    out[0] = bestColumn
                    out[1] = bestRow
                    return
                }
            }
        }
        out[0] = bestColumn
        out[1] = bestRow
    }

    private fun outside(value: Float): Float = if (value < 0f) -value else if (value > 1f) value - 1f else 0f

    private fun inverseBilinear(mesh: MeshGrid, column: Int, row: Int, u: Float, v: Float): FloatArray? {
        val ax = px(mesh, column, row)
        val ay = py(mesh, column, row)
        val bx = px(mesh, column + 1, row)
        val by = py(mesh, column + 1, row)
        val cx = px(mesh, column + 1, row + 1)
        val cy = py(mesh, column + 1, row + 1)
        val dx = px(mesh, column, row + 1)
        val dy = py(mesh, column, row + 1)
        val ex = bx - ax
        val ey = by - ay
        val fx = dx - ax
        val fy = dy - ay
        val gx = ax - bx + cx - dx
        val gy = ay - by + cy - dy
        val hx = u - ax
        val hy = v - ay
        val k2 = gx * fy - gy * fx
        val k1 = ex * fy - ey * fx + hx * gy - hy * gx
        val k0 = hx * ey - hy * ex
        val t: Float
        if (abs(k2) < 1e-6f) {
            if (abs(k1) < 1e-9f) return null
            t = -k0 / k1
        } else {
            val discriminant = k1 * k1 - 4 * k0 * k2
            if (discriminant < 0) return null
            val root = sqrt(discriminant)
            val first = (-k1 - root) / (2 * k2)
            val second = (-k1 + root) / (2 * k2)
            t = if (first in -0.001f..1.001f) first else second
        }
        val denominatorX = ex + gx * t
        val denominatorY = ey + gy * t
        val s = if (abs(denominatorX) > abs(denominatorY)) (hx - fx * t) / denominatorX else (hy - fy * t) / denominatorY
        return floatArrayOf(s, t)
    }

    private fun px(mesh: MeshGrid, column: Int, row: Int): Float = mesh.points[(row * mesh.columns + column) * 2]

    private fun py(mesh: MeshGrid, column: Int, row: Int): Float = mesh.points[(row * mesh.columns + column) * 2 + 1]

    private fun sample(mesh: MeshGrid, channels: Array<FloatArray>, gridX: Float, gridY: Float): Int {
        val baseX = floor(gridX).toInt().coerceIn(0, mesh.columns - 2)
        val baseY = floor(gridY).toInt().coerceIn(0, mesh.rows - 2)
        val tx = gridX - baseX
        val ty = gridY - baseY
        var argb = 0
        for (channel in 0 until 4) {
            var value = 0f
            for (j in -1..2) {
                val wy = catmullRom(j, ty)
                if (wy == 0f) continue
                val row = (baseY + j).coerceIn(0, mesh.rows - 1)
                for (i in -1..2) {
                    val wx = catmullRom(i, tx)
                    if (wx == 0f) continue
                    val column = (baseX + i).coerceIn(0, mesh.columns - 1)
                    value += wx * wy * channels[row * mesh.columns + column][channel]
                }
            }
            val byte = (value.coerceIn(0f, 1f) * 255f + 0.5f).toInt()
            argb = when (channel) {
                0 -> argb or (byte shl 16)
                1 -> argb or (byte shl 8)
                2 -> argb or byte
                else -> argb or (byte shl 24)
            }
        }
        return argb
    }

    private fun catmullRom(index: Int, t: Float): Float {
        val t2 = t * t
        val t3 = t2 * t
        return when (index) {
            -1 -> 0.5f * (-t3 + 2 * t2 - t)
            0 -> 0.5f * (3 * t3 - 5 * t2 + 2)
            1 -> 0.5f * (-3 * t3 + 4 * t2 + t)
            else -> 0.5f * (t3 - t2)
        }
    }
}

internal object MeshImageCache {
    private const val WIDTH = 96
    private const val HEIGHT = 160
    private const val LIMIT = 12
    private val images = object : LinkedHashMap<MeshGrid, ImageBitmap>(LIMIT, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<MeshGrid, ImageBitmap>?): Boolean = size > LIMIT
    }

    fun image(mesh: MeshGrid): ImageBitmap = synchronized(images) {
        images.getOrPut(mesh) {
            val pixels = MeshRaster.render(mesh, WIDTH, HEIGHT)
            android.graphics.Bitmap.createBitmap(pixels, WIDTH, HEIGHT, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
        }
    }
}
