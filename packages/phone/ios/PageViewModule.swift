import ExpoModulesCore

public final class PageViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPageView")

    AsyncFunction("closePage") { (pageID: String) in
      MainActor.assumeIsolated { PhonePages.shared.close(pageID) }
    }.runOnQueue(.main)

    View(PageView.self) {
      Events("onPageEvent")

      Prop("pageId") { (view: PageView, pageID: String) in
        view.pageID = pageID
      }

      Prop("initialUrl") { (view: PageView, url: String?) in
        view.initialURL = url
      }

      Prop("toneInsets") { (view: PageView, insets: [Double]?) in
        if let insets, insets.count == 2 {
          view.toneInsets = (CGFloat(insets[0]), CGFloat(insets[1]))
        } else {
          view.toneInsets = (0, 0)
        }
      }

      OnViewDidUpdateProps { (view: PageView) in
        view.bind()
      }

      AsyncFunction("loadUrl") { (view: PageView, url: String) in
        MainActor.assumeIsolated { view.load(url) }
      }.runOnQueue(.main)

      AsyncFunction("goBack") { (view: PageView) -> Bool in
        MainActor.assumeIsolated { view.goBack() }
      }.runOnQueue(.main)

      AsyncFunction("goForward") { (view: PageView) -> Bool in
        MainActor.assumeIsolated { view.goForward() }
      }.runOnQueue(.main)

      AsyncFunction("reload") { (view: PageView) in
        MainActor.assumeIsolated { view.page?.reload() }
      }.runOnQueue(.main)

      AsyncFunction("stopLoading") { (view: PageView) in
        MainActor.assumeIsolated { view.page?.stopLoading() }
      }.runOnQueue(.main)
    }
  }
}
