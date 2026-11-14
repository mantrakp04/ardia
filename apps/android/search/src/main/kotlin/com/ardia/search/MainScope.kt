package com.ardia.search

import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers

@Composable
internal fun rememberMainScope(): CoroutineScope = rememberCoroutineScope { Dispatchers.Main.immediate }
