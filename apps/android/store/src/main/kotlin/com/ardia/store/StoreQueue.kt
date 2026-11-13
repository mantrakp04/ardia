package com.ardia.store

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

class StoreQueue(private val dispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(1)) {
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    internal fun launch(read: () -> Unit): Job = scope.launch { runCatching(read) }

    internal fun launchAfter(delayMillis: Long, work: () -> Unit): Job = scope.launch {
        delay(delayMillis)
        runCatching(work)
    }

    suspend fun <T> run(work: () -> T): T = withContext(dispatcher) { work() }

    fun <T> blocking(work: () -> T): T = runBlocking(dispatcher) { work() }

    suspend fun flush() {
        scope.launch {}.join()
    }

    fun close() {
        scope.cancel()
    }
}
