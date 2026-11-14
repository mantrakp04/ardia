package com.ardia.phone

import android.content.Context
import com.ardia.blocking.BlockingCategory
import com.ardia.blocking.ContentBlocker
import com.ardia.blocking.FilterListException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class BlockingModule : Module() {
    private val context: Context get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "The app context is gone", null)

    private fun blocking(): PhoneBlocking {
        PhonePages.engine(context)
        return PhonePages.blocking
    }

    override fun definition() = ModuleDefinition {
        Name("ArdiaPhoneBlocking")

        Events("onBlockingEvent")

        OnCreate {
            PhonePages.blockingSink = { sendEvent("onBlockingEvent", it) }
        }

        OnDestroy {
            PhonePages.blockingSink = null
        }

        AsyncFunction("state") { -> blocking().state() }.runOnQueue(Queues.MAIN)

        AsyncFunction("setEnabled") { enabled: Boolean -> blocking().setEnabled(enabled) }.runOnQueue(Queues.MAIN)

        AsyncFunction("setCategory") { category: String, enabled: Boolean ->
            val parsed = BlockingCategory.fromRawValue(category) ?: throw PagePayloads.badArgs("Unknown blocking category $category")
            blocking().setCategory(parsed, enabled)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("isEnabledForSite") { url: String, isPrivate: Boolean? ->
            val blocking = blocking()
            blocking.isEnabled.value && blocking.blocker.blockersEnabled(url, isPrivate == true)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setEnabledForSite") { url: String, enabled: Boolean, isPrivate: Boolean? ->
            val host = ContentBlocker.hostOf(url) ?: return@AsyncFunction null
            blocking().blocker.setBlockersEnabled(url, enabled, isPrivate == true)
            host
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("setListEnabled") Coroutine { id: String, enabled: Boolean ->
            val blocking = withContext(Dispatchers.Main) { blocking() }
            blocking.lists.setEnabled(id, enabled).join()
        }

        AsyncFunction("removeList") Coroutine { id: String ->
            val blocking = withContext(Dispatchers.Main) { blocking() }
            blocking.lists.removeList(id).join()
        }

        AsyncFunction("updateLists") Coroutine { ->
            val blocking = withContext(Dispatchers.Main) { blocking() }
            blocking.updateNow()
        }

        AsyncFunction("resetToDefaults") Coroutine { ->
            val blocking = withContext(Dispatchers.Main) { blocking() }
            blocking.lists.resetToDefaults()
        }

        AsyncFunction("addCustomList") Coroutine { url: String ->
            val blocking = withContext(Dispatchers.Main) { blocking() }
            val added = try {
                blocking.lists.addCustomList(url)
            } catch (refused: FilterListException) {
                throw CodedException("ERR_FILTER_LIST", refused.error.message, refused)
            }
            added.id
        }

        AsyncFunction("setMyFilters") Coroutine { text: String ->
            val blocking = withContext(Dispatchers.Main) { blocking() }
            val result = blocking.lists.applyMyFilters(text)
            mapOf("ruleCount" to result.ruleCount, "skippedCount" to result.skippedCount, "isTooLarge" to result.isTooLarge)
        }

        AsyncFunction("blockedCount") { pageId: String -> PhonePages.page(pageId)?.state?.value?.blockedRequests }.runOnQueue(Queues.MAIN)
    }
}
