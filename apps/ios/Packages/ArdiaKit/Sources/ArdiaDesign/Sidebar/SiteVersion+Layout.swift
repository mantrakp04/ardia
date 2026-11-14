import ArdiaBrowser

public extension SiteVersion {
  init(layout: ChromeLayout) {
    self.init(layoutHasSidebar: layout.hasSidebar)
  }
}
