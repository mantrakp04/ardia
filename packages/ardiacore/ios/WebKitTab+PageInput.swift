extension WebKitTab {
  func listen(to view: WebKitWebView) {
    view.onFocus = { [weak self] in self?.pageFocused() }
    view.onPressRefused = { [weak self] in self?.pagePressRefused() }
  }

  func stopListening(to view: WebKitWebView) {
    view.onFocus = nil
    view.onPressRefused = nil
  }

  private func pageFocused() { emit("focus") }

  private func pagePressRefused() { emit("pagePress", ["refused": true]) }
}
