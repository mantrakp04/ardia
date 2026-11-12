import AppKit
import ArdiaCore
import AVFoundation
import WebKit

final class ReportRecorder {
  struct Options {
    let includePages: Bool
    let maxSeconds: Double
    let fps: Double
    let maxPixelWidth: Double
  }

  private static let pageViewClasses: Set<String> = ["RenderWidgetHostViewCocoa", "WebContentsViewCocoa"]
  private static let pageScanInterval = 0.25
  private static let mainThreadShare = 0.4
  private static let firstPictureWait = 0.5

  private struct Overlay {
    weak var window: NSWindow?
    let placement: ReportOverlayPlacement
    let pages: [(view: NSView, rect: CGRect)]
    let cornerRadius: CGFloat
    weak var controls: NSView?
  }

  let path: String
  private weak var window: NSWindow?
  private let options: Options
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private let pixelWidth: Int
  private let pixelHeight: Int
  private let pointSize: CGSize
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
  private var timer: DispatchSourceTimer?
  private var startedAt: CFTimeInterval = 0
  private var lastFrameAt: CFTimeInterval = -1
  private var nextFrameAt: CFTimeInterval = 0
  private var pages: [(view: NSView, rect: CGRect)] = []
  private var stillViews: [NSView] = []
  private let stills = ReportLayerCache()
  private var pagesScannedAt: CFTimeInterval = -1
  private var overlays: [Overlay] = []
  private var windowPictures: [Int: CGImage] = [:]
  private var windowPicturesInFlight: Set<Int> = []
  private var windowPictureMisses = 0
  private var overlaysSeen: [String: Int] = [:]
  private var pinnedSeen = false
  private var pictures: [ObjectIdentifier: CGImage] = [:]
  private var picturesInFlight: Set<ObjectIdentifier> = []
  private var renderMs: [Double] = []
  private var skipped = 0
  private var finished = false
  private let usage = ReportProcessUsage()

  var onTick: ((Double) -> Void)?
  var excludedWindows: () -> [NSWindow] = { [] }
  var onLimit: (() -> Void)?

  var seconds: Double { startedAt == 0 ? 0 : CACurrentMediaTime() - startedAt }

  init?(window: NSWindow, path: String, options: Options) {
    guard let content = window.contentView, content.bounds.width >= 2, content.bounds.height >= 2 else { return nil }
    self.window = window
    self.path = path
    self.options = options
    pointSize = content.bounds.size
    let scale = min(window.backingScaleFactor, max(1, options.maxPixelWidth / pointSize.width))
    pixelWidth = Int(pointSize.width * scale) & ~1
    pixelHeight = Int(pointSize.height * scale) & ~1
    try? FileManager.default.removeItem(atPath: path)
    guard let writer = try? AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .mp4) else { return nil }
    let settings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: pixelWidth,
      AVVideoHeightKey: pixelHeight,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: Int(Double(pixelWidth * pixelHeight) * options.fps * 0.06),
        AVVideoMaxKeyFrameIntervalKey: Int(options.fps * 5),
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: false,
      ],
    ]
    input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = true
    adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: pixelWidth,
        kCVPixelBufferHeightKey as String: pixelHeight,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
      ])
    guard writer.canAdd(input) else { return nil }
    writer.add(input)
    self.writer = writer
  }

  func start() -> Bool {
    guard writer.startWriting() else { return false }
    writer.startSession(atSourceTime: .zero)
    startedAt = CACurrentMediaTime()
    usage.begin()
    let source = DispatchSource.makeTimerSource(queue: .main)
    source.schedule(deadline: .now(), repeating: 1 / options.fps, leeway: .milliseconds(4))
    source.setEventHandler { [weak self] in self?.tick() }
    source.resume()
    timer = source
    return true
  }

  func stop(_ completion: @escaping ([String: Any]?) -> Void) {
    guard !finished else { return completion(nil) }
    finished = true
    timer?.cancel()
    timer = nil
    let seconds = self.seconds
    let frames = renderMs.count
    let cpu = usage.end()
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTime(seconds: max(lastFrameAt, 0) + 1 / options.fps, preferredTimescale: 600))
    let sorted = renderMs.sorted()
    let stillRefreshes = stills.refreshes
    let overlayKinds = overlaysSeen
    let pinned = pinnedSeen
    let windowPictureMisses = self.windowPictureMisses
    let pageRects = pages.map { "\(NSStringFromClass(type(of: $0.view))) \(Int($0.rect.minX)),\(Int($0.rect.minY)) \(Int($0.rect.width))x\(Int($0.rect.height))" }
    writer.finishWriting { [writer, path, pixelWidth, pixelHeight, options, skipped, pageRects, stillRefreshes, overlayKinds, pinned, windowPictureMisses] in
      let bytes = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
      let ok = writer.status == .completed && frames > 0
      let result: [String: Any] = [
        "path": path,
        "seconds": seconds,
        "frames": frames,
        "skipped": skipped,
        "fps": seconds > 0 ? Double(frames) / seconds : 0,
        "width": pixelWidth,
        "height": pixelHeight,
        "bytes": bytes,
        "includePages": options.includePages,
        "renderMsMean": sorted.isEmpty ? 0 : sorted.reduce(0, +) / Double(sorted.count),
        "renderMsP95": sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))],
        "cpuPercent": cpu.cpuPercent,
        "footprintStartMB": cpu.footprintStartMB,
        "footprintPeakMB": cpu.footprintPeakMB,
        "pages": pageRects,
        "stillRefreshes": stillRefreshes,
        "windows": overlayKinds.sorted { $0.key < $1.key }.map { ["kind": $0.key, "frames": $0.value] },
        "pinned": pinned,
        "windowPictureMisses": windowPictureMisses,
      ]
      DispatchQueue.main.async { completion(ok ? result : nil) }
    }
  }

  func cancel() {
    guard !finished else { return }
    finished = true
    timer?.cancel()
    timer = nil
    writer.cancelWriting()
    try? FileManager.default.removeItem(atPath: path)
  }

  private func tick() {
    guard !finished, let window, let content = window.contentView, let layer = content.layer else { return }
    let now = seconds
    if now >= options.maxSeconds {
      onLimit?()
      return
    }
    onTick?(now)
    usage.sample()
    guard CACurrentMediaTime() >= nextFrameAt else { return }
    guard input.isReadyForMoreMediaData, let pool = adaptor.pixelBufferPool, content.bounds.size == pointSize else {
      skipped += 1
      return
    }
    var buffer: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
      skipped += 1
      return
    }
    let began = CACurrentMediaTime()
    scanPages(in: content, at: began)
    if options.includePages {
      requestPictures()
      requestWindowPictures()
      let waiting = pages.contains { pictures[ObjectIdentifier($0.view)] == nil }
        || overlays.contains { $0.placement.candidate.kind.drawnByChrome && windowPictures[$0.placement.candidate.number] == nil }
      if now < Self.firstPictureWait, waiting { return }
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let ctx = CGContext(
      data: CVPixelBufferGetBaseAddress(buffer), width: pixelWidth, height: pixelHeight, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return }
    var background = CGColor(gray: 0, alpha: 1)
    window.effectiveAppearance.performAsCurrentDrawingAppearance {
      background = (window.backgroundColor ?? .windowBackgroundColor).cgColor
    }
    ctx.setFillColor(background)
    ctx.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
    ctx.scaleBy(x: CGFloat(pixelWidth) / pointSize.width, y: CGFloat(pixelHeight) / pointSize.height)
    ctx.saveGState()
    if content.isFlipped || layer.isGeometryFlipped {
      ctx.translateBy(x: 0, y: pointSize.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    stills.update(stillViews, scale: CGFloat(pixelWidth) / pointSize.width, now: began)
    stills.render(layer, in: ctx)
    ctx.restoreGState()
    drawPages(pages, height: pointSize.height, in: ctx)
    drawOverlays(in: ctx)
    let at = CMTime(seconds: now, preferredTimescale: 600)
    if now > lastFrameAt, adaptor.append(buffer, withPresentationTime: at) { lastFrameAt = now }
    let spent = CACurrentMediaTime() - began
    renderMs.append(spent * 1000)
    nextFrameAt = began + max(0, spent / Self.mainThreadShare - 1 / options.fps * 0.5)
  }

  private func drawPages(_ pages: [(view: NSView, rect: CGRect)], height: CGFloat, in ctx: CGContext) {
    for page in pages {
      let rect = CGRect(x: page.rect.minX, y: height - page.rect.maxY, width: page.rect.width, height: page.rect.height)
      if options.includePages, let picture = pictures[ObjectIdentifier(page.view)] {
        ctx.interpolationQuality = .medium
        ctx.draw(picture, in: rect)
      } else {
        ctx.setFillColor(CGColor(gray: 0, alpha: 1))
        ctx.fill(rect)
      }
    }
  }

  private func drawOverlays(in ctx: CGContext) {
    guard let main = window else { return }
    let canvas = Self.canvasFrame(of: main)
    for overlay in overlays {
      guard let window = overlay.window, window.isVisible, let content = window.contentView else { continue }
      let kind = overlay.placement.candidate.kind
      guard let placed = ReportOverlayLayout.place(window.frame, in: canvas, pinIfOutside: kind.followsTheUser) else { continue }
      let rect = placed.rect
      let size = content.bounds.size
      guard size.width >= 1, size.height >= 1 else { continue }
      overlaysSeen[kind.rawValue, default: 0] += 1
      if placed.pinned { pinnedSeen = true }
      ctx.saveGState()
      ctx.clip(to: CGRect(origin: .zero, size: pointSize))
      let radius = max(0, min(overlay.cornerRadius, rect.width / 2, rect.height / 2))
      ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
      ctx.clip()
      if kind.drawnByChrome {
        if options.includePages, let picture = windowPictures[overlay.placement.candidate.number] {
          ctx.interpolationQuality = .medium
          ctx.draw(picture, in: rect)
        } else {
          ctx.setFillColor(CGColor(gray: 0, alpha: 1))
          ctx.fill(rect)
        }
      }
      ctx.translateBy(x: rect.minX, y: rect.minY)
      ctx.scaleBy(x: rect.width / size.width, y: rect.height / size.height)
      if let drawn = kind.drawnByChrome ? overlay.controls : content, let drawnLayer = drawn.layer {
        var frame = drawn.convert(drawn.bounds, to: content)
        if content.isFlipped { frame.origin.y = size.height - frame.maxY }
        ctx.saveGState()
        ctx.translateBy(x: frame.minX, y: frame.minY)
        if drawn.isFlipped || drawnLayer.isGeometryFlipped {
          ctx.translateBy(x: 0, y: frame.height)
          ctx.scaleBy(x: 1, y: -1)
        }
        drawnLayer.render(in: ctx)
        ctx.restoreGState()
      }
      drawPages(overlay.pages, height: size.height, in: ctx)
      ctx.restoreGState()
    }
  }

  private func scanPages(in content: NSView, at now: CFTimeInterval) {
    guard now - pagesScannedAt >= Self.pageScanInterval else { return }
    pagesScannedAt = now
    let main = Self.scan(content, collectingStills: true)
    stillViews = main.stills
    pages = main.pages
    scanOverlays()
    let live = Set((pages + overlays.flatMap(\.pages)).map { ObjectIdentifier($0.view) })
    pictures = pictures.filter { live.contains($0.key) }
    let shownWindows = Set(overlays.map(\.placement.candidate.number))
    windowPictures = windowPictures.filter { shownWindows.contains($0.key) }
  }

  private static func scan(_ content: NSView, collectingStills: Bool) -> (pages: [(view: NSView, rect: CGRect)], stills: [NSView]) {
    var found: [(view: NSView, rect: CGRect)] = []
    var still: [NSView] = []
    func visit(_ view: NSView) {
      if view.isHidden || view.alphaValue <= 0.01 || (view.layer?.opacity ?? 1) <= 0.01 { return }
      if collectingStills, ReportLayerCache.isStill(view) {
        still.append(view)
        return
      }
      if Self.isPage(view) {
        var rect = view.convert(view.bounds, to: content)
        if !content.isFlipped { rect.origin.y = content.bounds.height - rect.maxY }
        found.append((view, rect.intersection(content.bounds)))
        return
      }
      for child in view.subviews { visit(child) }
    }
    visit(content)
    return (found.filter { !$0.rect.isEmpty }, still)
  }

  private func scanOverlays() {
    guard let window else { return overlays = [] }
    let excluded = Set(excludedWindows().map(\.windowNumber))
    let shown = Self.onScreenWindows()
    let alphas = Dictionary(shown.map { ($0.number, $0.alpha) }, uniquingKeysWith: { first, _ in first })
    let candidates = NSApp.windows.compactMap { other -> ReportOverlayCandidate? in
      guard other !== window, other.isVisible, !excluded.contains(other.windowNumber) else { return nil }
      return ReportOverlayCandidate(
        number: other.windowNumber, frame: other.frame, kind: ReportOverlayKind(rawValue: ArdiaWebView.recordingKind(of: other)) ?? .app,
        visible: alphas[other.windowNumber] != nil, alpha: alphas[other.windowNumber] ?? 0)
    }
    let placements = ReportOverlayLayout.select(
      frontToBack: shown.map(\.number), main: window.windowNumber, mainFrame: Self.canvasFrame(of: window), candidates: candidates, excluded: excluded)
    overlays = placements.compactMap { placement in
      guard let other = NSApp.window(withWindowNumber: placement.candidate.number), let content = other.contentView else { return nil }
      let pages = placement.candidate.kind.drawnByChrome ? [] : Self.scan(content, collectingStills: false).pages
      return Overlay(
        window: other, placement: placement, pages: pages, cornerRadius: ArdiaWebView.recordingCornerRadius(of: other),
        controls: ArdiaWebView.recordingControls(of: other))
    }
  }

  private static func onScreenWindows() -> [(number: Int, alpha: CGFloat)] {
    let pid = Int(getpid())
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return list.compactMap { info in
      guard (info[kCGWindowOwnerPID as String] as? Int) == pid, let number = info[kCGWindowNumber as String] as? Int else { return nil }
      return (number, CGFloat(info[kCGWindowAlpha as String] as? Double ?? 1))
    }
  }

  private static func canvasFrame(of window: NSWindow) -> CGRect {
    window.convertToScreen(window.contentView.map { $0.convert($0.bounds, to: nil) } ?? .zero)
  }

  private func requestWindowPictures() {
    for overlay in overlays where overlay.placement.candidate.kind.drawnByChrome {
      let number = overlay.placement.candidate.number
      guard let other = overlay.window, !windowPicturesInFlight.contains(number) else { continue }
      windowPicturesInFlight.insert(number)
      ArdiaWebView.copyRecordingPicture(of: other) { [weak self] image in
        let kept = image
        DispatchQueue.main.async {
          guard let self else { return }
          self.windowPicturesInFlight.remove(number)
          if let kept, kept.width > 1 { self.windowPictures[number] = kept } else { self.windowPictureMisses += 1 }
        }
      }
    }
  }


  private static func isPage(_ view: NSView) -> Bool {
    view is ArdiaWebView || view is WKWebView || pageViewClasses.contains(NSStringFromClass(type(of: view)))
  }

  private func requestPictures() {
    for page in pages {
      let key = ObjectIdentifier(page.view)
      if picturesInFlight.contains(key) { continue }
      picturesInFlight.insert(key)
      let done: (CGImage?) -> Void = { [weak self] image in
        guard let self else { return }
        self.picturesInFlight.remove(key)
        if let image { self.pictures[key] = image }
      }
      if let web = page.view as? ArdiaWebView {
        web.copyRecordingPicture { image in
          let kept = image
          DispatchQueue.main.async { done(kept) }
        }
      } else if let web = page.view as? WKWebView {
        web.takeSnapshot(with: nil) { image, _ in done(image?.cgImage(forProposedRect: nil, context: nil, hints: nil)) }
      } else {
        done(nil)
      }
    }
  }
}
