package com.ardia.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathNode
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

private const val STROKE = 1.9f
private const val BOLD = 2.1f
private const val SHIELD = "M12 2.8l7.5 2.9v5.6c0 4.8-3.1 8.6-7.5 10-4.4-1.4-7.5-5.2-7.5-10V5.7z"
private const val CLOUD = "M7 19C4.2 19 2.5 17.1 2.5 14.8C2.5 12.6 4.1 10.9 6.3 10.7C7 7.6 9.4 5.5 12.4 5.5C15.4 5.5 17.6 7.5 18.2 10.3" +
    "C20.2 10.7 21.5 12.4 21.5 14.6C21.5 17 19.7 19 17.2 19Z"
private const val DOCUMENT = "M13.5 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8.5z"
private const val DOCUMENT_FOLD = "M13.5 3v3.5a2 2 0 0 0 2 2H19"

internal class SymbolPath {
    val nodes = ArrayList<PathNode>()

    fun svg(data: String) {
        nodes += addPathNodes(data)
    }

    fun moveTo(x: Float, y: Float) {
        nodes += PathNode.MoveTo(x, y)
    }

    fun lineTo(x: Float, y: Float) {
        nodes += PathNode.LineTo(x, y)
    }

    fun close() {
        nodes += PathNode.Close
    }

    fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
        moveTo(x1, y1)
        lineTo(x2, y2)
    }

    fun polyline(vararg points: Float) {
        moveTo(points[0], points[1])
        for (index in 2 until points.size step 2) lineTo(points[index], points[index + 1])
    }

    fun polygon(vararg points: Float) {
        polyline(*points)
        close()
    }

    fun ellipse(centerX: Float, centerY: Float, radiusX: Float, radiusY: Float) {
        moveTo(centerX - radiusX, centerY)
        nodes += PathNode.ArcTo(radiusX, radiusY, 0f, true, true, centerX + radiusX, centerY)
        nodes += PathNode.ArcTo(radiusX, radiusY, 0f, true, true, centerX - radiusX, centerY)
        close()
    }

    fun circle(centerX: Float, centerY: Float, radius: Float) = ellipse(centerX, centerY, radius, radius)

    fun roundRect(x: Float, y: Float, width: Float, height: Float, radius: Float) {
        val r = minOf(radius, width / 2, height / 2)
        moveTo(x + r, y)
        lineTo(x + width - r, y)
        nodes += PathNode.ArcTo(r, r, 0f, false, true, x + width, y + r)
        lineTo(x + width, y + height - r)
        nodes += PathNode.ArcTo(r, r, 0f, false, true, x + width - r, y + height)
        lineTo(x + r, y + height)
        nodes += PathNode.ArcTo(r, r, 0f, false, true, x, y + height - r)
        lineTo(x, y + r)
        nodes += PathNode.ArcTo(r, r, 0f, false, true, x + r, y)
        close()
    }

    fun sparkle(centerX: Float, centerY: Float, radius: Float) {
        val pinch = radius * 0.14f
        moveTo(centerX, centerY - radius)
        nodes += PathNode.QuadTo(centerX + pinch, centerY - pinch, centerX + radius, centerY)
        nodes += PathNode.QuadTo(centerX + pinch, centerY + pinch, centerX, centerY + radius)
        nodes += PathNode.QuadTo(centerX - pinch, centerY + pinch, centerX - radius, centerY)
        nodes += PathNode.QuadTo(centerX - pinch, centerY - pinch, centerX, centerY - radius)
        close()
    }
}

internal class SymbolScope(private val builder: ImageVector.Builder) {
    fun stroke(width: Float = STROKE, block: SymbolPath.() -> Unit) {
        builder.addPath(
            pathData = SymbolPath().apply(block).nodes,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = width,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }

    fun fill(evenOdd: Boolean = false, block: SymbolPath.() -> Unit) {
        builder.addPath(
            pathData = SymbolPath().apply(block).nodes,
            pathFillType = if (evenOdd) PathFillType.EvenOdd else PathFillType.NonZero,
            fill = SolidColor(Color.Black),
        )
    }

    fun roundedFill(width: Float, block: SymbolPath.() -> Unit) {
        builder.addPath(
            pathData = SymbolPath().apply(block).nodes,
            fill = SolidColor(Color.Black),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = width,
            strokeLineJoin = StrokeJoin.Round,
        )
    }

    fun group(
        rotate: Float = 0f,
        pivotX: Float = 12f,
        pivotY: Float = 12f,
        scale: Float = 1f,
        translationX: Float = 0f,
        translationY: Float = 0f,
        block: SymbolScope.() -> Unit,
    ) {
        builder.addGroup(
            rotate = rotate,
            pivotX = pivotX,
            pivotY = pivotY,
            scaleX = scale,
            scaleY = scale,
            translationX = translationX,
            translationY = translationY,
        )
        block()
        builder.clearGroup()
    }
}

private fun symbol(name: String, block: SymbolScope.() -> Unit): ImageVector {
    val builder = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    SymbolScope(builder).block()
    return builder.build()
}

private fun SymbolScope.raisedHand() {
    fill {
        roundRect(6.9f, 4.6f, 2.6f, 10f, 1.3f)
        roundRect(9.9f, 2.8f, 2.6f, 11f, 1.3f)
        roundRect(12.9f, 3.6f, 2.6f, 10f, 1.3f)
        roundRect(15.9f, 6f, 2.4f, 8.5f, 1.2f)
        roundRect(6.9f, 9.8f, 11.4f, 11.7f, 4.6f)
    }
    group(rotate = -38f, pivotX = 7f, pivotY = 15f) { fill { roundRect(2.4f, 13.8f, 6.6f, 2.5f, 1.25f) } }
}

private fun SymbolScope.laptop(screenX: Float, screenWidth: Float, baseFrom: Float, baseTo: Float) {
    stroke { roundRect(screenX, 5f, screenWidth, 10.5f, 1.6f) }
    stroke(BOLD) { line(baseFrom, 18.5f, baseTo, 18.5f) }
}

object ArdiaSymbols {
    val plus by lazy { symbol("plus") { stroke(BOLD) { line(12f, 5f, 12f, 19f); line(5f, 12f, 19f, 12f) } } }
    val minus by lazy { symbol("minus") { stroke(BOLD) { line(5f, 12f, 19f, 12f) } } }
    val xmark by lazy { symbol("xmark") { stroke(BOLD) { line(6.5f, 6.5f, 17.5f, 17.5f); line(17.5f, 6.5f, 6.5f, 17.5f) } } }
    val checkmark by lazy { symbol("checkmark") { stroke(BOLD) { polyline(5f, 12.5f, 9.8f, 17.3f, 19f, 6.6f) } } }
    val chevronUp by lazy { symbol("chevron.up") { stroke(BOLD) { polyline(5.5f, 15.5f, 12f, 9f, 18.5f, 15.5f) } } }
    val chevronDown by lazy { symbol("chevron.down") { stroke(BOLD) { polyline(5.5f, 8.5f, 12f, 15f, 18.5f, 8.5f) } } }
    val chevronLeft by lazy { symbol("chevron.left") { stroke(BOLD) { polyline(15.5f, 5f, 8.5f, 12f, 15.5f, 19f) } } }
    val chevronRight by lazy { symbol("chevron.right") { stroke(BOLD) { polyline(8.5f, 5f, 15.5f, 12f, 8.5f, 19f) } } }
    val chevronUpChevronDown by lazy {
        symbol("chevron.up.chevron.down") { stroke { polyline(8f, 9.5f, 12f, 5.5f, 16f, 9.5f); polyline(8f, 14.5f, 12f, 18.5f, 16f, 14.5f) } }
    }
    val chevronLeftForwardslashChevronRight by lazy {
        symbol("chevron.left.forwardslash.chevron.right") {
            stroke { polyline(7.5f, 7f, 2.5f, 12f, 7.5f, 17f); polyline(16.5f, 7f, 21.5f, 12f, 16.5f, 17f); line(14f, 4.5f, 10f, 19.5f) }
        }
    }
    val arrowRight by lazy { symbol("arrow.right") { stroke { line(4f, 12f, 19.5f, 12f); polyline(13.5f, 6f, 19.5f, 12f, 13.5f, 18f) } } }
    val arrowUpForward by lazy { symbol("arrow.up.forward") { stroke { line(6.5f, 17.5f, 17f, 7f); polyline(8.5f, 7f, 17f, 7f, 17f, 15.5f) } } }
    val arrowUturnBackward by lazy {
        symbol("arrow.uturn.backward") { stroke { polyline(8.5f, 13.5f, 3.5f, 8.5f, 8.5f, 3.5f); svg("M3.5 8.5H14a6 6 0 0 1 0 12H10.5") } }
    }
    val arrowClockwise by lazy {
        symbol("arrow.clockwise") { stroke { svg("M19.5 12.5A7.5 7.5 0 1 1 15.6 5.9"); polyline(13.96f, 2.25f, 15.6f, 5.9f, 11.64f, 6.45f) } }
    }
    val arrowRightCircle by lazy {
        symbol("arrow.right.circle") { stroke { circle(12f, 12f, 9f); line(7.5f, 12f, 16f, 12f); polyline(12.5f, 8.5f, 16f, 12f, 12.5f, 15.5f) } }
    }
    val arrowDownCircleFill by lazy {
        symbol("arrow.down.circle.fill") {
            fill(evenOdd = true) {
                circle(12f, 12f, 10f)
                polygon(10.9f, 6.3f, 13.1f, 6.3f, 13.1f, 12.9f, 15.4f, 10.6f, 16.95f, 12.15f, 12f, 17.1f, 7.05f, 12.15f, 8.6f, 10.6f, 10.9f, 12.9f)
            }
        }
    }
    val arrowUpForwardAppFill by lazy {
        symbol("arrow.up.forward.app.fill") {
            val arrow = floatArrayOf(
                10.9f, 17.7f, 13.1f, 17.7f, 13.1f, 11.1f, 15.4f, 13.4f, 16.95f, 11.85f, 12f, 6.9f, 7.05f, 11.85f, 8.6f, 13.4f, 10.9f, 11.1f,
            )
            fill(evenOdd = true) {
                roundRect(3f, 3f, 18f, 18f, 5.5f)
                polygon(*SymbolGeometry.transform(arrow, 45f, 0.85f, 12f, 12.3f))
            }
        }
    }
    val arrowUpForwardSquare by lazy {
        symbol("arrow.up.forward.square") {
            stroke { roundRect(3.5f, 3.5f, 17f, 17f, 4.5f); line(9f, 15f, 15.2f, 8.8f); polyline(10f, 8.8f, 15.2f, 8.8f, 15.2f, 14f) }
        }
    }
    val squareAndArrowUp by lazy {
        symbol("square.and.arrow.up") {
            stroke {
                svg("M8.5 9.5H7.5A2.5 2.5 0 0 0 5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12a2.5 2.5 0 0 0-2.5-2.5h-1")
                line(12f, 2.8f, 12f, 14.5f)
                polyline(8.6f, 6.2f, 12f, 2.8f, 15.4f, 6.2f)
            }
        }
    }
    val squareAndArrowUpFill by lazy {
        symbol("square.and.arrow.up.fill") {
            fill(evenOdd = true) {
                roundRect(4.5f, 9f, 15f, 12.5f, 2.8f)
                polygon(9.6f, 9f, 14.4f, 9f, 14.4f, 15.8f, 9.6f, 15.8f)
            }
            stroke(2f) { line(12f, 2.8f, 12f, 14.3f); polyline(8.6f, 6.2f, 12f, 2.8f, 15.4f, 6.2f) }
        }
    }
    val trash by lazy {
        symbol("trash") {
            stroke {
                line(4f, 6.5f, 20f, 6.5f)
                svg("M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7")
                svg("M6 6.5l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-13")
                line(10f, 10.5f, 10f, 17.5f)
                line(14f, 10.5f, 14f, 17.5f)
            }
        }
    }
    val archivebox by lazy {
        symbol("archivebox") {
            stroke {
                roundRect(3f, 3.5f, 18f, 5f, 1.4f)
                svg("M4.5 8.5V18a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5V8.5")
                line(10f, 12.5f, 14f, 12.5f)
            }
        }
    }
    val archiveboxFill by lazy {
        symbol("archivebox.fill") {
            fill { roundRect(2.5f, 3f, 19f, 5.2f, 1.6f) }
            fill(evenOdd = true) { roundRect(4f, 9.4f, 16f, 11.6f, 2.4f); roundRect(9f, 11.8f, 6f, 2.2f, 1.1f) }
        }
    }
    val squareStack by lazy {
        symbol("square.stack") { stroke { roundRect(4f, 8.5f, 16f, 12.5f, 3f); line(6.5f, 5.5f, 17.5f, 5.5f); line(9f, 2.8f, 15f, 2.8f) } }
    }
    val squareOnSquare by lazy {
        symbol("square.on.square") {
            stroke {
                roundRect(3.5f, 8f, 12.5f, 12.5f, 2.6f)
                svg("M8 8V6.5A2.5 2.5 0 0 1 10.5 4h7A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H16")
            }
        }
    }
    val squareOnSquareDashed by lazy {
        symbol("square.on.square.dashed") {
            stroke { roundRect(3.5f, 8f, 12.5f, 12.5f, 2.6f) }
            stroke(1.7f) {
                line(8f, 6f, 8f, 6.6f)
                line(10.4f, 4f, 11.8f, 4f)
                line(14.4f, 4f, 15.8f, 4f)
                line(18.6f, 4.3f, 19.7f, 5.4f)
                line(20f, 8.2f, 20f, 9.6f)
                line(20f, 12.2f, 20f, 13.6f)
                line(17.4f, 16f, 18.6f, 15.7f)
            }
        }
    }
    val docOnDoc by lazy {
        symbol("doc.on.doc") {
            stroke {
                roundRect(4f, 7f, 11.5f, 14.5f, 2.4f)
                svg("M8.5 7V5.4A2.4 2.4 0 0 1 10.9 3h6.7A2.4 2.4 0 0 1 20 5.4v9.7a2.4 2.4 0 0 1-2.4 2.4h-2.1")
            }
        }
    }
    val docText by lazy {
        symbol("doc.text") { stroke { svg(DOCUMENT); svg(DOCUMENT_FOLD); line(8.5f, 13f, 15.5f, 13f); line(8.5f, 16.5f, 13.5f, 16.5f) } }
    }
    val docPlaintext by lazy {
        symbol("doc.plaintext") {
            stroke { svg(DOCUMENT); svg(DOCUMENT_FOLD); line(8.5f, 10f, 11.5f, 10f); line(8.5f, 13f, 15.5f, 13f); line(8.5f, 16.5f, 15.5f, 16.5f) }
        }
    }
    val listBulletRectangle by lazy {
        symbol("list.bullet.rectangle") {
            stroke { roundRect(2.5f, 4.5f, 19f, 15f, 3.2f); line(10f, 10f, 17f, 10f); line(10f, 14f, 17f, 14f) }
            fill { circle(7f, 10f, 1.2f); circle(7f, 14f, 1.2f) }
        }
    }
    val listBulletRectanglePortraitFill by lazy {
        symbol("list.bullet.rectangle.portrait.fill") {
            fill(evenOdd = true) {
                roundRect(4.5f, 2.5f, 15f, 19f, 3.2f)
                for (row in floatArrayOf(8f, 12f, 16f)) {
                    circle(8.4f, row, 1.15f)
                    roundRect(10.6f, row - 0.9f, 5.4f, 1.8f, 0.9f)
                }
            }
        }
    }
    val line3HorizontalDecrease by lazy {
        symbol("line.3.horizontal.decrease") { stroke { line(4f, 7f, 20f, 7f); line(7f, 12f, 17f, 12f); line(10f, 17f, 14f, 17f) } }
    }
    val ellipsis by lazy { symbol("ellipsis") { fill { circle(5.5f, 12f, 1.75f); circle(12f, 12f, 1.75f); circle(18.5f, 12f, 1.75f) } } }
    val magnifyingglass by lazy { symbol("magnifyingglass") { stroke { circle(10.5f, 10.5f, 6.5f) }; stroke(2.2f) { line(15.3f, 15.3f, 20f, 20f) } } }
    val textMagnifyingglass by lazy {
        symbol("text.magnifyingglass") {
            stroke { line(3f, 6f, 13f, 6f); line(3f, 10.5f, 8f, 10.5f); line(3f, 15f, 7f, 15f); circle(15f, 14f, 4.2f); line(18.1f, 17.1f, 21f, 20f) }
        }
    }
    val globe by lazy {
        symbol("globe") {
            stroke(1.6f) {
                circle(12f, 12f, 9f)
                svg("M12 3c-2.6 2.5-3.8 5.5-3.8 9s1.2 6.5 3.8 9")
                svg("M12 3c2.6 2.5 3.8 5.5 3.8 9s-1.2 6.5-3.8 9")
                line(3f, 12f, 21f, 12f)
                svg("M4.8 7.6c4.6 1.3 9.8 1.3 14.4 0")
                svg("M4.8 16.4c4.6-1.3 9.8-1.3 14.4 0")
            }
        }
    }
    val safariFill by lazy {
        symbol("safari.fill") {
            fill(evenOdd = true) { circle(12f, 12f, 10f); polygon(16.6f, 7.4f, 13.4f, 13.4f, 7.4f, 16.6f, 10.6f, 10.6f) }
            fill { polygon(16.6f, 7.4f, 13.4f, 13.4f, 10.6f, 10.6f) }
        }
    }
    val star by lazy { symbol("star") { stroke(1.8f) { polygon(*SymbolGeometry.star(12f, 12.6f, 9.6f, 4.1f)) } } }
    val starFill by lazy { symbol("star.fill") { roundedFill(1.4f) { polygon(*SymbolGeometry.star(12f, 12.6f, 9.6f, 4.1f)) } } }
    val pinFill by lazy {
        symbol("pin.fill") {
            fill { svg("M8.6 2.8h6.8a.8.8 0 0 1 .6 1.3L14.8 6v3.3l2.7 3a1 1 0 0 1-.7 1.7H7.2a1 1 0 0 1-.7-1.7l2.7-3V6L8 4.1a.8.8 0 0 1 .6-1.3z") }
            stroke(1.8f) { line(12f, 14f, 12f, 21.2f) }
        }
    }
    val moonFill by lazy { symbol("moon.fill") { fill { svg("M20 14.5A8.5 8.5 0 1 1 9.5 4A8 8 0 0 0 20 14.5Z") } } }
    val mic by lazy {
        symbol("mic") { stroke { roundRect(9f, 2.8f, 6f, 11.4f, 3f); svg("M5.8 11a6.2 6.2 0 0 0 12.4 0"); line(12f, 17.2f, 12f, 21f) } }
    }
    val micFill by lazy {
        symbol("mic.fill") {
            fill { roundRect(8.6f, 2.5f, 6.8f, 12f, 3.4f) }
            stroke { svg("M5.8 11a6.2 6.2 0 0 0 12.4 0"); line(12f, 17.2f, 12f, 21f) }
        }
    }
    val stopFill by lazy { symbol("stop.fill") { fill { roundRect(5.5f, 5.5f, 13f, 13f, 2.8f) } } }
    val keyboardFill by lazy {
        symbol("keyboard.fill") {
            fill(evenOdd = true) {
                roundRect(1.8f, 5.5f, 20.4f, 13f, 2.6f)
                for (row in floatArrayOf(8.2f, 11.2f)) {
                    for (key in 0 until 6) roundRect(3.4f + key * 3f, row, 2.2f, 1.9f, 0.5f)
                }
                roundRect(7f, 14.4f, 10f, 1.9f, 0.6f)
            }
        }
    }
    val info by lazy {
        symbol("info") {
            fill { circle(12f, 6.3f, 1.5f) }
            stroke(2f) { polyline(10f, 10.5f, 12.2f, 10.5f, 12.2f, 18.7f); line(9.6f, 18.7f, 14.6f, 18.7f) }
        }
    }
    val equalCircleFill by lazy {
        symbol("equal.circle.fill") {
            fill(evenOdd = true) { circle(12f, 12f, 10f); roundRect(7.3f, 8.8f, 9.4f, 2f, 1f); roundRect(7.3f, 13.2f, 9.4f, 2f, 1f) }
        }
    }
    val xmarkCircleFill by lazy {
        symbol("xmark.circle.fill") { fill(evenOdd = true) { circle(12f, 12f, 10f); polygon(*SymbolGeometry.cross(12f, 12f, 4.4f, 1.05f)) } }
    }
    val checkmarkCircleFill by lazy {
        symbol("checkmark.circle.fill") {
            fill(evenOdd = true) {
                circle(12f, 12f, 10f)
                polygon(*SymbolGeometry.thickPolyline(floatArrayOf(7.2f, 12.4f, 10.6f, 15.8f, 16.8f, 8.6f), 1.1f, 0.4f))
            }
        }
    }
    val checkmarkShield by lazy { symbol("checkmark.shield") { stroke { svg(SHIELD); polyline(8.8f, 12.2f, 11.1f, 14.5f, 15.4f, 9.6f) } } }
    val checkmarkShieldFill by lazy {
        symbol("checkmark.shield.fill") {
            fill(evenOdd = true) { svg(SHIELD); polygon(*SymbolGeometry.thickPolyline(floatArrayOf(8.6f, 12.3f, 11.1f, 14.8f, 15.6f, 9.6f), 1f, 0.3f)) }
        }
    }
    val shieldLefthalfFilled by lazy {
        symbol("shield.lefthalf.filled") {
            stroke { svg(SHIELD) }
            fill { svg("M12 2.8L4.5 5.7v5.6c0 4.8 3.1 8.6 7.5 10z") }
        }
    }
    val checkmarkIcloudFill by lazy {
        symbol("checkmark.icloud.fill") {
            fill(evenOdd = true) { svg(CLOUD); polygon(*SymbolGeometry.thickPolyline(floatArrayOf(8.6f, 13.4f, 11f, 15.8f, 15.6f, 11f), 0.95f, 0.3f)) }
        }
    }
    val paperplaneFill by lazy { symbol("paperplane.fill") { roundedFill(1.2f) { polygon(21f, 3f, 3.2f, 10.4f, 10.3f, 13.7f, 13.6f, 20.8f) } } }
    val folderFill by lazy {
        symbol("folder.fill") {
            fill { svg("M3 7.5A2.5 2.5 0 0 1 5.5 5H9.6l2 2.2h6.9A2.5 2.5 0 0 1 21 9.7v8.8A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5z") }
        }
    }
    val laptopcomputer by lazy { symbol("laptopcomputer") { laptop(4.5f, 15f, 2f, 22f) } }
    val macbook by lazy { symbol("macbook") { laptop(4f, 16f, 1.5f, 22.5f) } }
    val iphone by lazy {
        symbol("iphone") {
            stroke { roundRect(6.8f, 2.5f, 10.4f, 19f, 2.8f) }
            fill { roundRect(10.4f, 4.4f, 3.2f, 1.2f, 0.6f) }
        }
    }
    val macbookAndIphone by lazy {
        symbol("macbook.and.iphone") {
            stroke(1.7f) { roundRect(2f, 5f, 13f, 9.5f, 1.4f); roundRect(16.2f, 7.5f, 6.3f, 12f, 1.7f) }
            stroke(2f) { line(0.9f, 17.5f, 14.4f, 17.5f) }
        }
    }
    val laptopcomputerAndArrowDown by lazy {
        symbol("laptopcomputer.and.arrow.down") {
            laptop(4.5f, 15f, 2f, 22f)
            stroke(1.7f) { line(12f, 7f, 12f, 12.6f); polyline(9.6f, 10.4f, 12f, 12.8f, 14.4f, 10.4f) }
        }
    }
    val platterFilledBottomAndArrowDownIphone by lazy {
        symbol("platter.filled.bottom.and.arrow.down.iphone") {
            stroke { roundRect(6f, 2f, 12f, 20f, 2.8f) }
            fill { roundRect(8.3f, 14.2f, 7.4f, 5.4f, 1.4f) }
            stroke(1.7f) { line(12f, 5.2f, 12f, 11.4f); polyline(9.6f, 9.2f, 12f, 11.6f, 14.4f, 9.2f) }
        }
    }
    val qrcodeViewfinder by lazy {
        symbol("qrcode.viewfinder") {
            stroke {
                svg("M3.5 8V5.5a2 2 0 0 1 2-2H8")
                svg("M16 3.5h2.5a2 2 0 0 1 2 2V8")
                svg("M20.5 16v2.5a2 2 0 0 1-2 2H16")
                svg("M8 20.5H5.5a2 2 0 0 1-2-2V16")
            }
            fill {
                roundRect(7.5f, 7.5f, 3.6f, 3.6f, 0.6f)
                roundRect(12.9f, 7.5f, 3.6f, 3.6f, 0.6f)
                roundRect(7.5f, 12.9f, 3.6f, 3.6f, 0.6f)
                roundRect(13f, 13f, 1.6f, 1.6f, 0.3f)
                roundRect(14.9f, 14.9f, 1.6f, 1.6f, 0.3f)
            }
        }
    }
    val gearshape by lazy { symbol("gearshape") { stroke(1.8f) { polygon(*SymbolGeometry.gear(12f, 12f, 9.6f, 7.6f, 8)); circle(12f, 12f, 3.1f) } } }
    val gear by lazy { symbol("gear") { stroke(1.7f) { polygon(*SymbolGeometry.gear(12f, 12f, 9.4f, 7.9f, 12)); circle(12f, 12f, 3f) } } }
    val clockArrowCirclepath by lazy {
        symbol("clock.arrow.circlepath") {
            stroke { svg("M5 12A7.5 7.5 0 1 0 7.2 6.7"); polyline(2.6f, 9.6f, 5f, 12f, 7.4f, 9.6f); polyline(12.5f, 8f, 12.5f, 12.3f, 15.3f, 14.1f) }
        }
    }
    val characterCursorIbeam by lazy {
        symbol("character.cursor.ibeam") {
            stroke {
                polyline(3f, 19f, 7.5f, 5.5f, 12f, 19f)
                line(4.6f, 14.5f, 10.4f, 14.5f)
                line(18f, 5f, 18f, 19f)
                line(16f, 4.5f, 20f, 4.5f)
                line(16f, 19.5f, 20f, 19.5f)
            }
        }
    }
    val textformatSize by lazy {
        symbol("textformat.size") {
            stroke { polyline(2.5f, 19f, 8f, 5f, 13.5f, 19f); line(4.6f, 14f, 11.4f, 14f) }
            stroke(1.8f) { polyline(14.2f, 19f, 17.6f, 10.5f, 21f, 19f); line(15.3f, 16.2f, 19.9f, 16.2f) }
        }
    }
    val textformatSizeLarger by lazy {
        symbol("textformat.size.larger") { stroke(BOLD) { polyline(5f, 20f, 12f, 3.5f, 19f, 20f); line(7.6f, 14.5f, 16.4f, 14.5f) } }
    }
    val textformatSizeSmaller by lazy {
        symbol("textformat.size.smaller") { stroke { polyline(7.5f, 18f, 12f, 7f, 16.5f, 18f); line(9.2f, 14f, 14.8f, 14f) } }
    }
    val eyes by lazy {
        symbol("eyes") {
            fill(evenOdd = true) {
                ellipse(7.6f, 12f, 3.6f, 7f)
                ellipse(16.4f, 12f, 3.6f, 7f)
                ellipse(6.9f, 13f, 1.65f, 2.8f)
                ellipse(15.7f, 13f, 1.65f, 2.8f)
            }
        }
    }
    val eyeglasses by lazy {
        symbol("eyeglasses") {
            stroke {
                circle(6.3f, 13.5f, 3.6f)
                circle(17.7f, 13.5f, 3.6f)
                svg("M9.9 13.2a2.6 2.6 0 0 1 4.2 0")
                line(2.7f, 13f, 4.4f, 7.5f)
                line(21.3f, 13f, 19.6f, 7.5f)
            }
        }
    }
    val eraserFill by lazy {
        symbol("eraser.fill") {
            fill(evenOdd = true) {
                svg("M13.6 3.9a1.6 1.6 0 0 1 2.3 0l4.2 4.2a1.6 1.6 0 0 1 0 2.3L11 19.5H6.8l-3-3a1.6 1.6 0 0 1 0-2.3z")
                polygon(7.76f, 10.14f, 14.06f, 16.44f, 13.14f, 17.36f, 6.84f, 11.06f)
            }
        }
    }
    val exclamationmarkTriangleFill by lazy {
        symbol("exclamationmark.triangle.fill") {
            fill(evenOdd = true) {
                svg("M10.3 3.9a2 2 0 0 1 3.4 0l8.2 14.2a2 2 0 0 1-1.7 3H3.8a2 2 0 0 1-1.7-3z")
                roundRect(10.95f, 8.3f, 2.1f, 7.2f, 1.05f)
                circle(12f, 17.9f, 1.25f)
            }
        }
    }
    val handRaisedFill by lazy { symbol("hand.raised.fill") { raisedHand() } }
    val handWaveFill by lazy {
        symbol("hand.wave.fill") {
            group(rotate = -24f, pivotX = 12f, pivotY = 13f) { raisedHand() }
            stroke(1.5f) { svg("M3.4 8.4a6.5 6.5 0 0 1 2.4-4.2"); svg("M18.4 21a6.5 6.5 0 0 0 3.6-3") }
        }
    }
    val handPointUpLeftFill by lazy {
        symbol("hand.point.up.left.fill") {
            group(rotate = -35f, pivotX = 13f, pivotY = 14f) {
                fill {
                    roundRect(9.9f, 1.5f, 2.7f, 11f, 1.35f)
                    roundRect(9.6f, 9.4f, 9.8f, 12f, 4f)
                }
                fill { roundRect(6.2f, 12f, 5f, 2.5f, 1.25f) }
            }
        }
    }
    val handDrawFill by lazy {
        symbol("hand.draw.fill") {
            stroke(1.6f) { svg("M2.5 9.5c1.5-3.5 4-4.5 5-2.5s-1 4.5 1 5 4-3 5.5-3") }
            group(rotate = -15f, pivotX = 12f, pivotY = 12f, scale = 0.62f, translationX = 4.5f, translationY = 4.5f) { raisedHand() }
        }
    }
    val handDraw by lazy { handDrawFill }
    val sparkles by lazy { symbol("sparkles") { fill { sparkle(10f, 13.5f, 7f); sparkle(18f, 5.5f, 3.6f); sparkle(18.6f, 18.2f, 2.6f) } } }
    val paintpaletteFill by lazy {
        symbol("paintpalette.fill") {
            fill(evenOdd = true) {
                svg("M12 2.5C6.8 2.5 2.5 6.6 2.5 11.7c0 5 4.1 9.3 9.2 9.3 1.4 0 2.1-.8 2.1-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.2c3 0 5.2-2.3 5.2-5.2C22 6.5 17.5 2.5 12 2.5z")
                circle(7.3f, 11.6f, 1.5f)
                circle(9.6f, 7.4f, 1.5f)
                circle(14.4f, 7.4f, 1.5f)
                circle(17.1f, 11.2f, 1.5f)
            }
        }
    }
    val link by lazy {
        symbol("link") {
            group(rotate = -45f) { stroke { roundRect(3.6f, 9.2f, 9.8f, 5.6f, 2.8f); roundRect(10.6f, 9.2f, 9.8f, 5.6f, 2.8f) } }
        }
    }

    private val byName: Map<String, () -> ImageVector> = mapOf(
        "plus" to { plus },
        "minus" to { minus },
        "xmark" to { xmark },
        "checkmark" to { checkmark },
        "chevron.up" to { chevronUp },
        "chevron.down" to { chevronDown },
        "chevron.left" to { chevronLeft },
        "chevron.right" to { chevronRight },
        "chevron.up.chevron.down" to { chevronUpChevronDown },
        "chevron.left.forwardslash.chevron.right" to { chevronLeftForwardslashChevronRight },
        "arrow.right" to { arrowRight },
        "arrow.up.forward" to { arrowUpForward },
        "arrow.uturn.backward" to { arrowUturnBackward },
        "arrow.clockwise" to { arrowClockwise },
        "arrow.right.circle" to { arrowRightCircle },
        "arrow.down.circle.fill" to { arrowDownCircleFill },
        "arrow.up.forward.app.fill" to { arrowUpForwardAppFill },
        "arrow.up.forward.square" to { arrowUpForwardSquare },
        "square.and.arrow.up" to { squareAndArrowUp },
        "square.and.arrow.up.fill" to { squareAndArrowUpFill },
        "trash" to { trash },
        "archivebox" to { archivebox },
        "archivebox.fill" to { archiveboxFill },
        "square.stack" to { squareStack },
        "square.on.square" to { squareOnSquare },
        "square.on.square.dashed" to { squareOnSquareDashed },
        "doc.on.doc" to { docOnDoc },
        "doc.text" to { docText },
        "doc.plaintext" to { docPlaintext },
        "list.bullet.rectangle" to { listBulletRectangle },
        "list.bullet.rectangle.portrait.fill" to { listBulletRectanglePortraitFill },
        "line.3.horizontal.decrease" to { line3HorizontalDecrease },
        "ellipsis" to { ellipsis },
        "magnifyingglass" to { magnifyingglass },
        "text.magnifyingglass" to { textMagnifyingglass },
        "globe" to { globe },
        "safari.fill" to { safariFill },
        "star" to { star },
        "star.fill" to { starFill },
        "pin.fill" to { pinFill },
        "moon.fill" to { moonFill },
        "mic" to { mic },
        "mic.fill" to { micFill },
        "stop.fill" to { stopFill },
        "keyboard.fill" to { keyboardFill },
        "info" to { info },
        "equal.circle.fill" to { equalCircleFill },
        "xmark.circle.fill" to { xmarkCircleFill },
        "checkmark.circle.fill" to { checkmarkCircleFill },
        "checkmark.shield" to { checkmarkShield },
        "checkmark.shield.fill" to { checkmarkShieldFill },
        "shield.lefthalf.filled" to { shieldLefthalfFilled },
        "checkmark.icloud.fill" to { checkmarkIcloudFill },
        "paperplane.fill" to { paperplaneFill },
        "folder.fill" to { folderFill },
        "laptopcomputer" to { laptopcomputer },
        "macbook" to { macbook },
        "iphone" to { iphone },
        "macbook.and.iphone" to { macbookAndIphone },
        "laptopcomputer.and.arrow.down" to { laptopcomputerAndArrowDown },
        "platter.filled.bottom.and.arrow.down.iphone" to { platterFilledBottomAndArrowDownIphone },
        "qrcode.viewfinder" to { qrcodeViewfinder },
        "gearshape" to { gearshape },
        "gear" to { gear },
        "clock.arrow.circlepath" to { clockArrowCirclepath },
        "character.cursor.ibeam" to { characterCursorIbeam },
        "textformat.size" to { textformatSize },
        "textformat.size.larger" to { textformatSizeLarger },
        "textformat.size.smaller" to { textformatSizeSmaller },
        "eyes" to { eyes },
        "eyeglasses" to { eyeglasses },
        "eraser.fill" to { eraserFill },
        "exclamationmark.triangle.fill" to { exclamationmarkTriangleFill },
        "hand.raised.fill" to { handRaisedFill },
        "hand.wave.fill" to { handWaveFill },
        "hand.point.up.left.fill" to { handPointUpLeftFill },
        "hand.draw" to { handDraw },
        "hand.draw.fill" to { handDrawFill },
        "sparkles" to { sparkles },
        "link" to { link },
        "paintpalette.fill" to { paintpaletteFill },
    )

    val names: Set<String> get() = byName.keys

    fun named(sfSymbol: String): ImageVector? = byName[sfSymbol]?.invoke()
}
