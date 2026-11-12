import AppKit
import ImageIO
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
        guard let picture, self.window != nil, self.bounds.size == size, !self.isHiddenOrHasHiddenAncestor, !frame.isEmpty else {
          return self.sendCaptureEnding("failed")
        }
        let overlay = CaptureOverlay(frame: self.convert(frame, from: self.page), picture: picture, page: self.page) { [weak self] ending in
          self?.captureEnded(ending)
        }
        self.captureOverlay = overlay
        self.addSubview(overlay, positioned: .above, relativeTo: self.page)
      }
    }
    return true
  }

  func captureFullPage() -> Bool {
    guard window != nil, !isHiddenOrHasHiddenAncestor else { return false }
    endCapture()
    captureStartedAt = CACurrentMediaTime()
    let backing = window?.backingScaleFactor ?? 2
    page.copyFullPage { [weak self] png in
      DispatchQueue.main.async {
        guard let self else { return }
        guard let png, let source = CGImageSourceCreateWithData(png as CFData, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          let copied = CaptureOverlay.copyToPasteboard(image, points: NSSize(width: CGFloat(image.width) / backing, height: CGFloat(image.height) / backing))
        else { return self.sendCaptureEnding("failed", kind: "page") }
        self.capturedPNG = copied
        self.sendCaptureEnding("copied", kind: "page", width: image.width, height: image.height)
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

  func saveCapture(folder: String, name: String) -> String? {
    guard let png = capturedPNG, !folder.isEmpty else { return nil }
    let directory = URL(fileURLWithPath: (folder as NSString).expandingTildeInPath, isDirectory: true)
    let base = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: ".")
    var file = directory.appendingPathComponent(base).appendingPathExtension("png")
    var copy = 2
    while FileManager.default.fileExists(atPath: file.path) {
      file = directory.appendingPathComponent("\(base) \(copy)").appendingPathExtension("png")
      copy += 1
    }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try png.write(to: file, options: .withoutOverwriting)
    } catch {
      return nil
    }
    return file.path
  }

  private func captureEnded(_ ending: CaptureOverlay.Ending) {
    captureOverlay = nil
    switch ending {
    case .copied(let shot):
      capturedPNG = shot.png
      sendCaptureEnding("copied", kind: shot.kind, width: shot.width, height: shot.height)
    case .cancelled:
      sendCaptureEnding("cancelled")
    case .failed:
      sendCaptureEnding("failed")
    }
  }

  private func sendCaptureEnding(_ outcome: String, kind: String? = nil, width: Int = 0, height: Int = 0) {
    let ms = Int(((CACurrentMediaTime() - captureStartedAt) * 1000).rounded())
    var payload: [String: Any] = ["outcome": outcome, "width": width, "height": height, "ms": ms]
    if let kind { payload["kind"] = kind }
    send("capture", payload: payload)
  }
}
