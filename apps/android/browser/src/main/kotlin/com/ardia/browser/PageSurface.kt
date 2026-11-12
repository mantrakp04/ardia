package com.ardia.browser

import android.view.ViewGroup
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

@Composable
fun PageSurface(page: Page, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier,
        factory = {
            (page.view.parent as? ViewGroup)?.removeView(page.view)
            page.view
        },
    )
}
