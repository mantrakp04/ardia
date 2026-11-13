package com.ardia.design

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

object SymbolGeometry {
    fun thickPolyline(points: FloatArray, halfWidth: Float, capExtension: Float = 0f): FloatArray {
        val count = points.size / 2
        require(count >= 2) { "a polyline needs two points" }
        val directionX = FloatArray(count - 1)
        val directionY = FloatArray(count - 1)
        for (index in 0 until count - 1) {
            val dx = points[index * 2 + 2] - points[index * 2]
            val dy = points[index * 2 + 3] - points[index * 2 + 1]
            val length = hypot(dx, dy)
            directionX[index] = dx / length
            directionY[index] = dy / length
        }
        val left = FloatArray(count * 2)
        val right = FloatArray(count * 2)
        for (index in 0 until count) {
            var x = points[index * 2]
            var y = points[index * 2 + 1]
            val offsetX: Float
            val offsetY: Float
            when (index) {
                0 -> {
                    offsetX = -directionY[0] * halfWidth
                    offsetY = directionX[0] * halfWidth
                    x -= directionX[0] * capExtension
                    y -= directionY[0] * capExtension
                }
                count - 1 -> {
                    offsetX = -directionY[index - 1] * halfWidth
                    offsetY = directionX[index - 1] * halfWidth
                    x += directionX[index - 1] * capExtension
                    y += directionY[index - 1] * capExtension
                }
                else -> {
                    val normalX = -directionY[index - 1] - directionY[index]
                    val normalY = directionX[index - 1] + directionX[index]
                    val length = hypot(normalX, normalY)
                    val unitX = normalX / length
                    val unitY = normalY / length
                    val scale = halfWidth / (unitX * -directionY[index] + unitY * directionX[index])
                    offsetX = unitX * scale
                    offsetY = unitY * scale
                }
            }
            left[index * 2] = x + offsetX
            left[index * 2 + 1] = y + offsetY
            right[index * 2] = x - offsetX
            right[index * 2 + 1] = y - offsetY
        }
        val outline = FloatArray(count * 4)
        left.copyInto(outline)
        for (index in 0 until count) {
            val source = count - 1 - index
            outline[count * 2 + index * 2] = right[source * 2]
            outline[count * 2 + index * 2 + 1] = right[source * 2 + 1]
        }
        return outline
    }

    fun star(centerX: Float, centerY: Float, outer: Float, inner: Float, points: Int = 5): FloatArray {
        val result = FloatArray(points * 4)
        for (index in 0 until points * 2) {
            val radius = if (index % 2 == 0) outer else inner
            val angle = -PI / 2 + index * PI / points
            result[index * 2] = centerX + (radius * cos(angle)).toFloat()
            result[index * 2 + 1] = centerY + (radius * sin(angle)).toFloat()
        }
        return result
    }

    fun gear(centerX: Float, centerY: Float, outer: Float, inner: Float, teeth: Int): FloatArray {
        val result = FloatArray(teeth * 8)
        val step = 2 * PI / teeth
        for (tooth in 0 until teeth) {
            val start = -PI / 2 + tooth * step - step / 4
            val angles = doubleArrayOf(start, start + step * 0.1, start + step * 0.4, start + step * 0.5)
            val radii = floatArrayOf(inner, outer, outer, inner)
            for (corner in 0 until 4) {
                result[tooth * 8 + corner * 2] = centerX + (radii[corner] * cos(angles[corner])).toFloat()
                result[tooth * 8 + corner * 2 + 1] = centerY + (radii[corner] * sin(angles[corner])).toFloat()
            }
        }
        return result
    }

    fun cross(centerX: Float, centerY: Float, arm: Float, halfWidth: Float, rotationDegrees: Float = 45f): FloatArray {
        val w = halfWidth
        val a = arm
        val plus = floatArrayOf(w, -a, w, -w, a, -w, a, w, w, w, w, a, -w, a, -w, w, -a, w, -a, -w, -w, -w, -w, -a)
        for (index in plus.indices step 2) {
            plus[index] += centerX
            plus[index + 1] += centerY
        }
        return transform(plus, rotationDegrees, 1f, centerX, centerY)
    }

    fun transform(points: FloatArray, rotationDegrees: Float, scale: Float, pivotX: Float, pivotY: Float): FloatArray {
        val radians = rotationDegrees * PI / 180
        val cosine = cos(radians).toFloat()
        val sine = sin(radians).toFloat()
        val result = FloatArray(points.size)
        for (index in points.indices step 2) {
            val x = (points[index] - pivotX) * scale
            val y = (points[index + 1] - pivotY) * scale
            result[index] = pivotX + x * cosine - y * sine
            result[index + 1] = pivotY + x * sine + y * cosine
        }
        return result
    }
}
