package com.ardia.design

import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.TweenSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionTest {
    private fun assertSpring(spring: ArdiaSpring, stiffness: Double, damping: Double) {
        assertEquals(stiffness, spring.stiffness.toDouble(), stiffness * 1e-5)
        assertEquals(damping, spring.damping.toDouble(), damping * 1e-5)
    }

    @Test
    fun `response and damping springs have SwiftUI's stiffness and damping`() {
        assertSpring(Motion.snappy, 438.64908449286037, 36.02359576116296)
        assertSpring(Motion.smooth, 223.80055331268383, 26.927937030769655)
        assertSpring(Motion.searchRise, 259.5556712975504, 32.221463113741464)
        assertSpring(Motion.press, 986.9604401089357, 43.982297150257104)
        assertSpring(TabsMotion.openScale, 1093.5849751899566, 66.13879270715354)
    }

    @Test
    fun `duration and bounce springs have SwiftUI's stiffness and damping`() {
        assertSpring(Motion.tabStack, 246.74011002723387, 25.132741228718345)
        assertSpring(Motion.modeToggle, 438.6490844928605, 35.604716740684324)
        assertSpring(Motion.barPressIn, 6168.502750680849, 157.07963267948966)
        assertSpring(Motion.barPressOut, 1542.1256876702118, 70.68583470577035)
        assertSpring(Motion.pagerSettle, 273.39624379748915, 33.06939635357677)
        assertSpring(TabsMotion.settle, 246.74011002723395, 31.41592653589793)
    }

    @Test
    fun `a negative bounce over-damps the way SwiftUI does`() {
        assertEquals(1f / 0.8f, ArdiaSpring.withBounce(0.3f, -0.2f).dampingRatio, 1e-6f)
    }

    @Test
    fun `specs carry the same constants into Compose`() {
        val spring = Motion.snappy.spec<Float>() as SpringSpec<Float>
        assertEquals(0.86f, spring.dampingRatio, 0f)
        assertEquals(Motion.snappy.stiffness, spring.stiffness, 0f)
        val tween = Motion.progressAdvance.spec<Float>() as TweenSpec<Float>
        assertEquals(450, tween.durationMillis)
        assertEquals(SwiftEasing.easeOut, tween.easing)
    }

    @Test
    fun `SwiftUI's ease out curve starts fast and lands softly`() {
        assertEquals(0f, SwiftEasing.easeOut.transform(0f), 1e-4f)
        assertEquals(1f, SwiftEasing.easeOut.transform(1f), 1e-4f)
        assertTrue(SwiftEasing.easeOut.transform(0.5f) > 0.6f)
        assertEquals(0.5f, SwiftEasing.easeInOut.transform(0.5f), 1e-3f)
    }

    @Test
    fun `the deck settle hands over a clamped relative velocity`() {
        assertEquals(30.0 * 100, TabsMotion.settleVelocity(100.0, 9000.0), 1e-9)
        assertEquals(-500.0, TabsMotion.settleVelocity(100.0, -500.0), 1e-9)
        assertEquals(0.0, TabsMotion.settleVelocity(0.0, 900.0), 0.0)
    }
}
