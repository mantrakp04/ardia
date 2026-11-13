package com.ardia.settings

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import com.ardia.design.ArdiaSymbols
import com.ardia.design.Motion
import com.ardia.design.ProfileBackdrop
import com.ardia.design.ProfileLook
import com.ardia.design.SystemPalette
import com.ardia.design.ardiaColor
import com.ardia.design.ardiaGradient

private data class SketchTab(val color: Color, val width: Int)

private val sketchTabs = listOf(
    SketchTab(ProfileLook.of(ProfileLook.Preset.Blue).swatchColor, 44),
    SketchTab(ProfileLook.of(ProfileLook.Preset.Pink).swatchColor, 36),
    SketchTab(ProfileLook.of(ProfileLook.Preset.Orange).swatchColor, 48),
    SketchTab(ProfileLook.of(ProfileLook.Preset.Green).swatchColor, 30),
    SketchTab(ProfileLook.of(ProfileLook.Preset.Purple).swatchColor, 40),
)

@Composable
fun SyncScanIllustration(connected: Boolean, modifier: Modifier = Modifier) {
    Box(modifier.clearAndSetSemantics {}, contentAlignment = Alignment.BottomEnd) {
        MacWindowSketch(Modifier.padding(end = 46.dp, bottom = 40.dp).size(250.dp, 168.dp))
        PhoneSketch(connected, Modifier.size(92.dp, 186.dp))
    }
}

@Composable
private fun MacWindowSketch(modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(12.dp)
    val ink = SystemPalette.label.current
    Row(
        modifier
            .shadow(18.dp, shape, ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.18f))
            .clip(shape)
            .border(1.dp, ink.copy(alpha = 0.1f), shape),
    ) {
        Box(Modifier.width(84.dp).fillMaxHeight()) {
            ProfileBackdrop(Modifier.fillMaxSize())
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Row(Modifier.padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (light in trafficLights) Box(Modifier.size(7.dp).background(light, CircleShape))
                }
                for (tab in sketchTabs) {
                    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(9.dp).background(tab.color, RoundedCornerShape(2.5.dp)))
                        Box(Modifier.size(tab.width.dp, 5.dp).background(ink.copy(alpha = 0.18f), CircleShape))
                    }
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxHeight().background(SystemPalette.background.current), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SketchQrCode(Modifier.size(74.dp), ink)
                Box(Modifier.size(90.dp, 5.dp).background(ink.copy(alpha = 0.14f), CircleShape))
                Box(Modifier.size(64.dp, 5.dp).background(ink.copy(alpha = 0.1f), CircleShape))
            }
        }
    }
}

private val trafficLights = listOf(ardiaColor(0xFF5F57), ardiaColor(0xFEBC2E), ardiaColor(0x28C840))

@Composable
private fun PhoneSketch(connected: Boolean, modifier: Modifier = Modifier) {
    val plum = remember { ProfileLook.plum.swatchColor }
    Box(
        modifier
            .shadow(14.dp, RoundedCornerShape(22.dp), ambientColor = Color.Black.copy(alpha = 0.25f), spotColor = Color.Black.copy(alpha = 0.25f))
            .background(Color(0xFF141414), RoundedCornerShape(22.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .padding(4.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (connected) plum.ardiaGradient() else androidx.compose.ui.graphics.SolidColor(Color(0xFF383838))),
        )
        AnimatedContent(
            connected,
            transitionSpec = { (scaleIn(Motion.smooth.spec()) + fadeIn(Motion.smooth.spec())) togetherWith (scaleOut(Motion.smooth.spec()) + fadeOut(Motion.smooth.spec())) },
            label = "phoneSketch",
        ) { done ->
            if (done) {
                Icon(ArdiaSymbols.checkmark, null, Modifier.size(30.dp), tint = Color.White)
            } else {
                Box(Modifier.size(58.dp), contentAlignment = Alignment.Center) {
                    Canvas(Modifier.size(58.dp)) { drawViewfinderCorners(Color.White, 3.dp.toPx()) }
                    SketchQrCode(Modifier.size(40.dp), Color.White.copy(alpha = 0.85f))
                }
            }
        }
        Column(Modifier.fillMaxSize().padding(top = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(28.dp, 8.dp).background(Color.Black, CircleShape))
            Spacer(Modifier.height(0.dp))
        }
    }
}

@Composable
private fun SketchQrCode(modifier: Modifier, color: Color) {
    val matrix = remember { SketchQr.matrix }
    Canvas(modifier) {
        val cell = size.width / matrix.width
        val module = Size(cell + 0.5f, cell + 0.5f)
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                if (matrix[x, y]) drawRect(color, Offset(x * cell, y * cell), module)
            }
        }
    }
}
