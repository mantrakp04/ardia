import AppKit
import QuartzCore

extension PageTabHost {
  func toggleCapture() -> Bool {
    if captureOverlay != nil || captureStarting {
      endCapture()
      return false
    }
    guard window != nil, !isHiddenOrHasHiddenAncestor, page.superview === self else { return false }
    captureStarting = true
    captureAttempt += 1
    captureStartedAt = CACurrentMediaTime()
    let attempt = captureAttempt
    let size = bounds.size
    page.copyCapturePicture { [weak self] picture, frame in
      DispatchQueue.main.async {
        guard let self, self.captureStarting, attempt == self.captureAttempt else { return }
        self.captureStarting = false
        guard let picture, self.window != nil, !self.isHiddenOrHasHiddenAncestor, !frame.isEmpty else {
          return self.sendCaptureEnding("failed")
        }
        let place = self.bounds.size == size ? self.convert(frame, from: self.page) : self.bounds
        let overlay = CaptureOverlay(frame: place, picture: picture, pictureSize: frame.size, page: self.page) { [weak self] ending in
          self?.captureEnded(ending)
        }
        self.captureOverlay = overlay
        self.addSubview(overlay, positioned: .above, relativeTo: self.page)
        self.watchCaptureArea()
      }
    }
    return true
  }

  func endCapture() {
    if captureStarting {
      captureStarting = false
      captureAttempt += 1
      sendCaptureEnding("cancelled")
    }
    captureOverlay?.cancel()
  }

  private func watchCaptureArea() {
    stopWatchingCaptureArea()
    guard let area = page.captureArea else { return }
    captureAreaObserver = NotificationCenter.default.addObserver(forName: NSView.frameDidChangeNotification, object: area, queue: .main) { [weak self] _ in
      self?.alignCapture()
    }
  }

  private func stopWatchingCaptureArea() {
    if let captureAreaObserver { NotificationCenter.default.removeObserver(captureAreaObserver) }
    captureAreaObserver = nil
  }

  private func alignCapture() {
    guard let overlay = captureOverlay, let area = page.captureArea, let holder = area.superview else { return }
    let place = convert(area.frame, from: holder)
    guard place != overlay.frame else { return }
    overlay.frame = place
    overlay.needsLayout = true
  }

  private func captureEnded(_ ending: CaptureOverlay.Ending) {
    stopWatchingCaptureArea()
    captureOverlay = nil
    switch ending {
    case .copied(let shot):
      sendCaptureEnding("copied", kind: shot.kind, width: shot.width, height: shot.height, capture: CaptureClipboard.keep(shot.png))
    case .cancelled:
      sendCaptureEnding("cancelled")
    case .failed:
      sendCaptureEnding("failed")
    }
  }

  private func sendCaptureEnding(_ outcome: String, kind: String? = nil, width: Int = 0, height: Int = 0, capture: Int? = nil) {
    let ms = Int(((CACurrentMediaTime() - captureStartedAt) * 1000).rounded())
    var payload: [String: Any] = ["outcome": outcome, "width": width, "height": height, "ms": ms]
    if let kind { payload["kind"] = kind }
    if let capture { payload["capture"] = capture }
    send("capture", payload: payload)
  }
}
