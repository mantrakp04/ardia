package com.ardia.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequest
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

interface SyncBackgroundScheduler {
    fun update(wanted: Boolean)

    fun flushSoon()

    fun flushDone()

    companion object {
        val none: SyncBackgroundScheduler = object : SyncBackgroundScheduler {
            override fun update(wanted: Boolean) {}

            override fun flushSoon() {}

            override fun flushDone() {}
        }
    }
}

class WorkManagerSyncScheduler(context: Context) : SyncBackgroundScheduler {
    private val context = context.applicationContext
    private val work: WorkManager get() = WorkManager.getInstance(context)

    override fun update(wanted: Boolean) {
        if (wanted) {
            work.enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.UPDATE, periodicRequest())
        } else {
            work.cancelUniqueWork(PERIODIC_WORK)
            work.cancelUniqueWork(FLUSH_WORK)
        }
    }

    override fun flushSoon() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(flushConstraints)
            .setInputData(workDataOf(SyncWorker.FLUSH to true))
            .build()
        work.enqueueUniqueWork(FLUSH_WORK, ExistingWorkPolicy.KEEP, request)
    }

    override fun flushDone() {
        work.cancelUniqueWork(FLUSH_WORK)
    }

    companion object {
        const val PERIODIC_WORK = "ardia-sync"
        const val FLUSH_WORK = "ardia-sync-flush"
        const val INTERVAL_MINUTES = 15L

        val periodicConstraints: Constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build()

        val flushConstraints: Constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        fun periodicRequest(): PeriodicWorkRequest = PeriodicWorkRequestBuilder<SyncWorker>(INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setConstraints(periodicConstraints)
            .setInitialDelay(INTERVAL_MINUTES, TimeUnit.MINUTES)
            .build()
    }
}

class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val controller = (applicationContext as? SyncControllerOwner)?.syncController ?: SyncController.active ?: return Result.success()
        val updated = controller.backgroundCycle()
        return when {
            updated -> Result.success()
            inputData.getBoolean(FLUSH, false) -> Result.retry()
            else -> Result.success()
        }
    }

    companion object {
        const val FLUSH = "flush"
    }
}
