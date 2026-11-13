import AppKit

enum PictureInPictureAnswer {
  case opened
  case nothingPlaying
  case failed
}

extension WebKitTab {
  var autoPictureInPictureRule: WebKitAutoPictureInPicture {
    get { webView?.autoPictureInPictureRule ?? WebKitAutoPictureInPicture() }
    set { webView?.autoPictureInPictureRule = newValue }
  }

  func watchSight() {
    stopWatchingSight()
    guard !closed, let window else { return }
    sightObserver = NotificationCenter.default.addObserver(forName: NSNotification.Name.ArdiaWindowSeenDidChange, object: window, queue: .main) { [weak self] _ in
      self?.updateSight()
    }
    updateSight()
  }

  func stopWatchingSight() {
    if let sightObserver { NotificationCenter.default.removeObserver(sightObserver) }
    sightObserver = nil
  }

  func updateSight() {
    guard !closed, let window else { return }
    let seen = visible && ArdiaChromeWindowHost.userSees(window)
    let activeCapture = webView?.cameraCaptureState == .active || webView?.microphoneCaptureState == .active
    switch autoPictureInPictureRule.sight(seen, enabled: autoPictureInPicture, playing: !playingFrames.isEmpty || activeCapture) {
    case .open: setPictureInPicture(true, automatic: true) { [weak self] answer in if answer == .nothingPlaying { self?.emit("autoPictureInPictureKept", ["reason": "nothingPlaying"]) } }
    case .close: setPictureInPicture(false) { _ in }
    case .none: break
    }
  }
}
