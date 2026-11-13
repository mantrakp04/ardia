package com.ardia.browser

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView

@Composable
fun PageSurface(page: Page, modifier: Modifier = Modifier, backdrop: Color = Color.Unspecified) {
    val view by page.view.collectAsState()
    val backdropArgb = if (backdrop.isSpecified) backdrop.toArgb() else android.graphics.Color.TRANSPARENT
    AndroidView(
        modifier = modifier,
        factory = { FrameLayout(it) },
        update = { container ->
            container.setBackgroundColor(backdropArgb)
            container.show(view)
        },
        onRelease = { it.removeAllViews() },
    )
}

private fun FrameLayout.show(view: View?) {
    if (view != null && view.parent === this && childCount == 1) return
    removeAllViews()
    if (view == null) return
    (view.parent as? ViewGroup)?.removeView(view)
    addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
}
