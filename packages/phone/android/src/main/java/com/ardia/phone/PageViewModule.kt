package com.ardia.phone

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PageViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ArdiaPageView")

        OnActivityEntersForeground {
            appContext.currentActivity?.let(PhonePages::attach)
        }

        OnActivityDestroys {
            appContext.currentActivity?.let(PhonePages::detach)
        }

        AsyncFunction("closePage") { pageId: String ->
            PhonePages.close(pageId)
            Unit
        }.runOnQueue(Queues.MAIN)

        View(PageView::class) {
            Events("onPageEvent")

            Prop("pageId") { view: PageView, pageId: String -> view.pageId = pageId }

            Prop("initialUrl") { view: PageView, url: String? -> view.initialUrl = url }

            Prop("toneInsets") { view: PageView, insets: List<Double>? ->
                view.toneInsets = insets?.takeIf { it.size == 2 }?.let { it[0] to it[1] } ?: (0.0 to 0.0)
            }

            OnViewDidUpdateProps { view -> view.bind() }

            OnViewDestroys { view -> view.unbind() }

            AsyncFunction("loadUrl") { view: PageView, url: String -> view.page?.load(url) }

            AsyncFunction("goBack") { view: PageView -> view.page?.goBack() == true }

            AsyncFunction("goForward") { view: PageView -> view.page?.goForward() == true }

            AsyncFunction("reload") { view: PageView -> view.page?.reload() }

            AsyncFunction("stopLoading") { view: PageView -> view.page?.stop() }
        }
    }
}
