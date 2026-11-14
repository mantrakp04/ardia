package com.ardia.browsing

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols

internal object BrowsingSymbols {
    private const val STROKE = 1.9f

    private fun outline(name: String, vararg paths: String): ImageVector {
        val builder = ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (path in paths) {
            builder.addPath(
                pathData = addPathNodes(path),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return builder.build()
    }

    val moon by lazy { outline("moon", "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z") }
    val desktop by lazy {
        outline(
            "desktopcomputer",
            "M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z",
            "M12 16.5v3.5",
            "M8 20h8",
        )
    }
    val translate by lazy {
        outline("translate", "M3 5h10", "M8 3v2", "M5.5 5c.8 3.6 3.2 6.4 6.5 8", "M11 5c-.9 3.9-3.6 7.1-7.5 9", "M13 21l4-10 4 10", "M14.4 17.5h5.2")
    }
    val wifiSlash by lazy {
        outline("wifi.slash", "M2.5 9a14 14 0 0 1 19 0", "M5.5 12.3a9.5 9.5 0 0 1 13 0", "M8.7 15.6a5 5 0 0 1 6.6 0", "M12 19.2h.01", "M3.5 3.5l17 17")
    }
    val handRaisedSlash by lazy {
        outline(
            "hand.raised.slash",
            "M8 13V6.5a1.5 1.5 0 0 1 3 0V12",
            "M11 11V5a1.5 1.5 0 0 1 3 0v6",
            "M14 11V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.2 15a1.5 1.5 0 0 1 2.3-1.9L8 15.5",
            "M3 3l18 18",
        )
    }
    val paperplane by lazy { outline("paperplane", "M21 3L10 14", "M21 3l-7 18-4-7-7-4z") }
    val arrowDownCircle by lazy { outline("arrow.down.circle", "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z", "M12 7.5v8.5", "M8.5 12.5L12 16l3.5-3.5") }
    val plusSquareOnSquare by lazy {
        outline(
            "plus.square.on.square",
            "M8 3.5h10.5a2 2 0 0 1 2 2V16",
            "M5.5 7.5h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z",
            "M10 11v6",
            "M7 14h6",
        )
    }
    val exclamationTriangle by lazy { outline("exclamationmark.triangle", "M12 3.5L21.5 20h-19z", "M12 9.5v5", "M12 17.3h.01") }
    val camera by lazy {
        outline(
            "camera",
            "M4 7.5h3l1.5-2.5h7L17 7.5h3a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 4 7.5z",
            "M12 10a3.5 3.5 0 1 1 0 7a3.5 3.5 0 1 1 0-7z",
        )
    }
    val video by lazy {
        outline("video", "M3.5 7h11a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 2 15.5v-7A1.5 1.5 0 0 1 3.5 7z", "M16 10.5l5-3v9l-5-3")
    }
    val filterLists by lazy { ArdiaSymbols.named("line.3.horizontal.decrease") ?: outline("line.3.horizontal.decrease", "M4 7h16", "M7 12h10", "M10 17h4") }
}
