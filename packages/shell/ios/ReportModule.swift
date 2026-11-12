import AppKit
import ArdiaCore
import AVFoundation
import ExpoModulesCore

public class ReportModule: Module {
  private static let event = "onReport"
  private static let escapeKey: UInt16 = 53
  private static let recordingOptions = (maxSeconds: 60.0, fps: 15.0, maxPixelWidth: 1440.0)

  private let lifetime = ModuleLifetime()
  private var recorder: ReportRecorder?
  private var pill: RecordingPill?
  private var escapeMonitor: Any?
  private lazy var uploader = ReportUploader { [weak self] id, sent, total in
    DispatchQueue.main.async { self?.send(["type": "upload", "id": id, "sent": sent, "total": total]) }
  }

  public func definition() -> ModuleDefinition {
    Name("ArdiaReport")
    Events(Self.event)

    OnCreate {
      self.lifetime.begin(self) { [weak self] in
        self?.recorder?.cancel()
        self?.endRecordingUI()
        self?.uploader.cancelAll()
      }
    }

    OnDestroy { self.lifetime.end() }

    View(ReportVideoView.self) {
      Prop("path") { (view: ReportVideoView, path: String?) in view.path = path }
      Prop("playing") { (view: ReportVideoView, playing: Bool) in view.playing = playing }
    }

    Function("draftDirectory") { () -> String in ReportFiles.draftDirectory() }

    Function("fileSize") { (path: String) -> Int in ReportFiles.size(path) }

    Function("removeFile") { (path: String) in ReportFiles.remove(path) }

    AsyncFunction("startRecording") { (windowId: String, includePages: Bool, path: String, maxSeconds: Double?, fps: Double?, maxPixelWidth: Double?) -> Bool in
      self.startRecording(windowId: windowId, includePages: includePages, path: path, maxSeconds: maxSeconds, fps: fps, maxPixelWidth: maxPixelWidth)
    }.runOnQueue(.main)

    AsyncFunction("stopRecording") { () -> Bool in
      self.stopRecording()
    }.runOnQueue(.main)

    AsyncFunction("cancelRecording") { () in
      self.recorder?.cancel()
      self.recorder = nil
      self.endRecordingUI()
    }.runOnQueue(.main)

    Function("isRecording") { () -> Bool in self.recorder != nil }

    AsyncFunction("recordingThumbnail") { (path: String, out: String) -> Bool in
      Self.thumbnail(path: path, out: out)
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))

    AsyncFunction("gzipFile") { (source: String, destination: String, removeSource: Bool) -> Int in
      let bytes = try ReportFiles.gzip(file: source, to: destination)
      if removeSource { ReportFiles.remove(source) }
      return bytes
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    AsyncFunction("gzipText") { (text: String, destination: String) -> Int in
      try ReportFiles.gzip(text: text, to: destination)
    }.runOnQueue(DispatchQueue.global(qos: .utility))

    AsyncFunction("upload") { (id: String, url: String, method: String, headers: [String: String], path: String, promise: Promise) in
      guard let target = URL(string: url), ["http", "https"].contains(target.scheme ?? "") else {
        return promise.resolve(["status": 0, "body": "", "error": "bad url"])
      }
      self.uploader.upload(id: id, url: target, method: method, headers: headers, file: URL(fileURLWithPath: path)) { promise.resolve($0) }
    }

    Function("cancelUploads") { () in self.uploader.cancelAll() }

    AsyncFunction("devRenderCost") { (windowId: String) -> [[String: Any]] in
      guard let content = WindowManager.shared.window(windowId)?.contentView, let root = content.layer else { return [] }
      let ctx = CGContext(data: nil, width: Int(content.bounds.width), height: Int(content.bounds.height), bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      var out: [[String: Any]] = []
      func time(_ layer: CALayer, _ path: String, _ depth: Int) {
        let t0 = CACurrentMediaTime()
        layer.render(in: ctx)
        let ms = (CACurrentMediaTime() - t0) * 1000
        out.append(["path": path, "ms": ms, "class": String(describing: type(of: layer)), "delegate": layer.delegate.map { String(describing: type(of: $0)) } ?? "", "subs": layer.sublayers?.count ?? 0])
        if depth < 12, ms > 2 { for (i, sub) in (layer.sublayers ?? []).enumerated() { time(sub, path + "/\(i)", depth + 1) } }
      }
      time(root, "", 0)
      return out.sorted { ($0["path"] as! String) < ($1["path"] as! String) }
    }.runOnQueue(.main)

    AsyncFunction("devSnapshotPill") { (path: String) -> [String: Double]? in
      self.pill?.snapshot(to: path)
    }.runOnQueue(.main)

    AsyncFunction("devRecordingPages") { (windowId: String) -> [[String: Any]] in
      WindowManager.shared.window(windowId).map(ReportRecorder.devScan) ?? []
    }.runOnQueue(.main)

    AsyncFunction("devPlaceWindow") { (windowId: String, frame: [Double]) -> Bool in
      guard LaunchConfig.shared.background, frame.count == 4, let window = WindowManager.shared.window(windowId) else { return false }
      window.setFrame(NSRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]), display: true)
      return true
    }.runOnQueue(.main)

    AsyncFunction("devWindowServerAlpha") { (windowNumber: Int, alpha: Double) -> Bool in
      typealias MainConnection = @convention(c) () -> Int32
      typealias SetAlpha = @convention(c) (Int32, Int32, Float) -> Int32
      guard LaunchConfig.shared.background, let connection = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGSMainConnectionID"),
        let set = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGSSetWindowAlpha")
      else { return false }
      let main = unsafeBitCast(connection, to: MainConnection.self)
      return unsafeBitCast(set, to: SetAlpha.self)(main(), Int32(windowNumber), Float(alpha)) == 0
    }.runOnQueue(.main)

    AsyncFunction("devPages") { (windowId: String) -> [[String: Any]] in
      guard let content = WindowManager.shared.window(windowId)?.contentView else { return [] }
      var out: [[String: Any]] = []
      func visit(_ view: NSView, depth: Int) {
        let name = NSStringFromClass(type(of: view))
        if view is ArdiaWebView || name.contains("RenderWidgetHost") || name.contains("WebContentsView") {
          let inWindow = view.convert(view.bounds, to: nil)
          var opacity: Float = 1
          var chain: NSView? = view
          while let v = chain { opacity *= v.layer?.opacity ?? 1; chain = v.superview }
          out.append(["class": name, "depth": depth, "window": [inWindow.minX, inWindow.minY, inWindow.width, inWindow.height], "visible": [view.visibleRect.minX, view.visibleRect.minY, view.visibleRect.width, view.visibleRect.height], "hidden": view.isHiddenOrHasHiddenAncestor, "opacity": opacity, "flipped": view.isFlipped])
        }
        for child in view.subviews { visit(child, depth: depth + 1) }
      }
      visit(content, depth: 0)
      return out
    }.runOnQueue(.main)
  }

  private func startRecording(windowId: String, includePages: Bool, path: String, maxSeconds: Double?, fps: Double?, maxPixelWidth: Double?) -> Bool {
    guard recorder == nil, let window = WindowManager.shared.window(windowId) else { return false }
    let limits = Self.recordingOptions
    let options = ReportRecorder.Options(
      includePages: includePages && !ArdiaWebView.recordingWindowIsPrivate(window), maxSeconds: min(maxSeconds ?? limits.maxSeconds, limits.maxSeconds),
      fps: min(max(fps ?? limits.fps, 1), 30), maxPixelWidth: min(max(maxPixelWidth ?? limits.maxPixelWidth, 320), 2880))
    guard let recorder = ReportRecorder(window: window, path: path, options: options) else { return false }
    let pill = RecordingPill(over: window) { [weak self] in _ = self?.stopRecording() }
    recorder.onTick = { [weak self] seconds in
      self?.pill?.update(seconds: seconds)
      self?.send(["type": "tick", "seconds": seconds])
    }
    recorder.onLimit = { [weak self] in _ = self?.stopRecording() }
    recorder.excludedWindows = { [weak pill] in pill.map { [$0.window] } ?? [] }
    guard recorder.start() else { return false }
    self.recorder = recorder
    self.pill = pill
    pill.show()
    escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard event.keyCode == Self.escapeKey, self?.recorder != nil else { return event }
      _ = self?.stopRecording()
      return nil
    }
    return true
  }

  private func stopRecording() -> Bool {
    guard let recorder else { return false }
    self.recorder = nil
    endRecordingUI()
    recorder.stop { [weak self] result in
      self?.send(["type": "stopped", "result": result as Any])
    }
    return true
  }

  private func endRecordingUI() {
    pill?.close()
    pill = nil
    if let escapeMonitor { NSEvent.removeMonitor(escapeMonitor) }
    escapeMonitor = nil
  }

  private static func thumbnail(path: String, out: String) -> Bool {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: path)))
    generator.appliesPreferredTrackTransform = true
    generator.maximumSize = CGSize(width: 480, height: 480)
    generator.requestedTimeToleranceBefore = .positiveInfinity
    generator.requestedTimeToleranceAfter = .positiveInfinity
    let at = CMTime(seconds: 1, preferredTimescale: 600)
    guard let image = (try? generator.copyCGImage(at: at, actualTime: nil)) ?? (try? generator.copyCGImage(at: .zero, actualTime: nil)) else { return false }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let png = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? png.write(to: URL(fileURLWithPath: out))) != nil
  }

  private func send(_ body: [String: Any]) {
    guard lifetime.isAlive, appContext != nil else { return }
    sendEvent(Self.event, body)
  }
}
