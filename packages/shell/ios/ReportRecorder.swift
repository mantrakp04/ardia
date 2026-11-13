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

  private static let mainThreadShare = 0.4
  private static let firstPictureWait = 0.5
  private static let pictureDeadline = 1.0
  private static let pictureExpiry = 0.6
  private static let pageEngineClasses: [AnyClass] = ["RenderWidgetHostViewCocoa", "WebContentsViewCocoa"].compactMap { NSClassFromString($0) }
  private static let chromiumBundlePath: String? = NSClassFromString("RenderWidgetHostViewCocoa").map { Bundle(for: $0).bundlePath }
  private static var origins: [ObjectIdentifier: ReportViewOrigin] = [:]

  private enum PageSource { case engine, idle, picture, unknown }

  private struct Page {
    let view: NSView
    let rect: CGRect
    let source: PageSource
  }

  private struct Overlay {
    let window: NSWindow
    let content: NSView
    let placement: ReportOverlayPlacement
    let pages: [Page]
    let cornerRadius: CGFloat
    let controls: NSView?
  }

  private struct Picture {
    var clock = ReportPictureClock(deadline: ReportRecorder.pictureDeadline, expiry: ReportRecorder.pictureExpiry)
    var image: CGImage?
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
  private var pages: [Page] = []
  private var stillViews: [NSView] = []
  private let stills = ReportLayerCache()
  private var overlays: [Overlay] = []
  private var pagePictures: [ObjectIdentifier: Picture] = [:]
  private var windowPictures: [Int: Picture] = [:]
  private var pictureMisses = 0
  private var webKitMediaWithheld = 0
  private var overlaysSeen: [String: Int] = [:]
  private var withheld: Set<Int> = []
  private var maskedPages = 0
  private var renderMs: [Double] = []
  private var skipped = 0
  private var finished = false
  private let usage = ReportProcessUsage()

  var onTick: ((Double) -> Void)?
  var excludedWindows: () -> [NSWindow] = { [] }
  var onLimit: (() -> Void)?

  var seconds: Double { startedAt == 0 ? 0 : CACurrentMediaTime() - startedAt }
  private var outputScale: CGFloat { CGFloat(pixelWidth) / pointSize.width }

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
    let misses = pictureMisses + pagePictures.values.reduce(0) { $0 + $1.clock.misses } + windowPictures.values.reduce(0) { $0 + $1.clock.misses }
    let withheldWindows = withheld.count
    let mediaWithheld = webKitMediaWithheld
    let masked = maskedPages
    let pageRects = pages.map { "\(NSStringFromClass(type(of: $0.view))) \(Int($0.rect.minX)),\(Int($0.rect.minY)) \(Int($0.rect.width))x\(Int($0.rect.height))" }
    writer.finishWriting { [writer, path, pixelWidth, pixelHeight, options, skipped, pageRects, stillRefreshes, overlayKinds, misses, withheldWindows, mediaWithheld, masked] in
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
        "maskedPages": masked,
        "stillRefreshes": stillRefreshes,
        "windows": overlayKinds.sorted { $0.key < $1.key }.map { ["kind": $0.key, "frames": $0.value] },
        "withheldWindows": withheldWindows,
        "windowPictureMisses": misses,
        "webKitMediaWithheld": mediaWithheld,
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
    let scanned = Self.scan(content, collectingStills: true)
    stillViews = scanned.stills
    pages = scanned.pages
    overlays = collectOverlays(of: window)
    forgetPictures()
    if options.includePages {
      requestPictures(now: began)
      let waiting = pages.contains { $0.source == .engine && freshPicture(of: $0.view, now: began) == nil }
        || overlays.contains { ReportOverlayLayout.fill(for: $0.placement.candidate.kind, includePages: true, pictureFresh: freshWindowPicture($0.placement.candidate.number, now: began) != nil) == .black }
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
    ctx.scaleBy(x: outputScale, y: CGFloat(pixelHeight) / pointSize.height)
    ctx.saveGState()
    if content.isFlipped || layer.isGeometryFlipped {
      ctx.translateBy(x: 0, y: pointSize.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    stills.update(stillViews, scale: outputScale, now: began)
    stills.render(layer, in: ctx)
    ctx.restoreGState()
    drawPages(pages, height: pointSize.height, in: ctx, now: began)
    drawOverlays(in: ctx, now: began)
    maskedPages = max(maskedPages, pages.count)
    let at = CMTime(seconds: now, preferredTimescale: 600)
    if now > lastFrameAt, adaptor.append(buffer, withPresentationTime: at) { lastFrameAt = now }
    let spent = CACurrentMediaTime() - began
    renderMs.append(spent * 1000)
    nextFrameAt = began + max(0, spent / Self.mainThreadShare - 1 / options.fps * 0.5)
  }

  private func drawPages(_ pages: [Page], height: CGFloat, in ctx: CGContext, now: CFTimeInterval) {
    for page in pages {
      let rect = CGRect(x: page.rect.minX, y: height - page.rect.maxY, width: page.rect.width, height: page.rect.height)
      if options.includePages {
        if page.source == .picture || page.source == .idle { continue }
        if page.source == .engine, let picture = freshPicture(of: page.view, now: now) {
          ctx.interpolationQuality = .medium
          ctx.draw(picture, in: rect)
          continue
        }
      }
      ctx.setFillColor(CGColor(gray: 0, alpha: 1))
      ctx.fill(rect)
    }
  }

  private func drawOverlays(in ctx: CGContext, now: CFTimeInterval) {
    for overlay in overlays {
      let kind = overlay.placement.candidate.kind
      let rect = overlay.placement.rect
      let size = overlay.content.bounds.size
      guard size.width >= 1, size.height >= 1 else { continue }
      overlaysSeen[kind.rawValue, default: 0] += 1
      ctx.saveGState()
      ctx.clip(to: overlay.placement.clip)
      let radius = max(0, min(overlay.cornerRadius, rect.width / 2, rect.height / 2))
      ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
      ctx.clip()
      let picture = freshWindowPicture(overlay.placement.candidate.number, now: now)
      let fill = ReportOverlayLayout.fill(for: kind, includePages: options.includePages, pictureFresh: picture != nil)
      switch fill {
      case .black:
        ctx.setFillColor(CGColor(gray: 0, alpha: 1))
        ctx.fill(rect)
      case .picture:
        if let picture {
          ctx.interpolationQuality = .medium
          ctx.draw(picture, in: rect)
        }
      case .layers:
        break
      }
      ctx.translateBy(x: rect.minX, y: rect.minY)
      ctx.scaleBy(x: rect.width / size.width, y: rect.height / size.height)
      if fill == .layers {
        render(overlay.content, in: overlay.content, size: size, ctx: ctx)
        drawPages(overlay.pages, height: size.height, in: ctx, now: now)
      }
      if ReportOverlayLayout.drawsControls(kind), let controls = overlay.controls {
        render(controls, in: overlay.content, size: size, ctx: ctx)
      }
      ctx.restoreGState()
    }
  }

  private func render(_ view: NSView, in content: NSView, size: CGSize, ctx: CGContext) {
    guard let layer = view.layer else { return }
    var frame = view.convert(view.bounds, to: content)
    if content.isFlipped { frame.origin.y = size.height - frame.maxY }
    ctx.saveGState()
    ctx.translateBy(x: frame.minX, y: frame.minY)
    if view.isFlipped || layer.isGeometryFlipped {
      ctx.translateBy(x: 0, y: frame.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    layer.render(in: ctx)
    ctx.restoreGState()
  }

  private func collectOverlays(of window: NSWindow) -> [Overlay] {
    let excluded = Set(excludedWindows().map(\.windowNumber))
    var owned: [(window: NSWindow, kind: ReportOverlayKind)] = ArdiaWebView.recordingPictureInPictureWindows(of: window).map { ($0, .pictureInPicture) }
    var seen = Set(owned.map { ObjectIdentifier($0.window) })
    seen.insert(ObjectIdentifier(window))
    func adopt(_ child: NSWindow) {
      guard seen.insert(ObjectIdentifier(child)).inserted else { return }
      owned.append((child, Self.isChromium(child) ? .chrome : .app))
      for grandchild in child.childWindows ?? [] { adopt(grandchild) }
      if let sheet = child.attachedSheet { adopt(sheet) }
    }
    for child in window.childWindows ?? [] { adopt(child) }
    if let sheet = window.attachedSheet { adopt(sheet) }
    let order = (NSWindow.windowNumbers(options: []) ?? []).map(\.intValue)
    guard let mainDepth = order.firstIndex(of: window.windowNumber) else { return [] }
    let above = Array(order.prefix(mainDepth))
    let alphas = Self.windowServerAlphas(above)
    let canvas = Self.canvasFrame(of: window)
    let ownedNumbers = Set(owned.map(\.window.windowNumber))
    for number in above where !ownedNumbers.contains(number) && !excluded.contains(number) && (alphas[number] ?? 0) > ReportOverlayLayout.minimumAlpha {
      if let other = NSApp.window(withWindowNumber: number), other.frame.intersects(canvas) { withheld.insert(number) }
    }
    let byNumber = Dictionary(owned.map { ($0.window.windowNumber, $0) }, uniquingKeysWith: { first, _ in first })
    let candidates = owned.filter(\.window.isVisible).map {
      ReportOverlayCandidate(number: $0.window.windowNumber, frame: $0.window.frame, kind: $0.kind, owned: true, alpha: alphas[$0.window.windowNumber] ?? 0)
    }
    let placements = ReportOverlayLayout.select(
      frontToBack: order, main: window.windowNumber, mainFrame: canvas, screens: NSScreen.screens.map(\.frame), candidates: candidates, excluded: excluded)
    return placements.compactMap { placement in
      guard let entry = byNumber[placement.candidate.number], let content = entry.window.contentView else { return nil }
      let pages = placement.candidate.kind == .app ? Self.scan(content, collectingStills: false).pages : []
      return Overlay(
        window: entry.window, content: content, placement: placement, pages: pages,
        cornerRadius: ArdiaWebView.recordingCornerRadius(of: entry.window),
        controls: placement.candidate.kind == .pictureInPicture ? ArdiaWebView.recordingControls(of: entry.window) : nil)
    }
  }

  private static func windowServerAlphas(_ numbers: [Int]) -> [Int: CGFloat] {
    guard !numbers.isEmpty else { return [:] }
    var pointers: [UnsafeRawPointer?] = numbers.map { UnsafeRawPointer(bitPattern: UInt($0)) }
    guard let ids = CFArrayCreate(nil, &pointers, pointers.count, nil) else { return [:] }
    let list = CGWindowListCreateDescriptionFromArray(ids) as? [[String: Any]] ?? []
    var alphas: [Int: CGFloat] = [:]
    for info in list {
      guard let number = info[kCGWindowNumber as String] as? Int, (info[kCGWindowIsOnscreen as String] as? Bool) ?? false else { continue }
      alphas[number] = CGFloat(info[kCGWindowAlpha as String] as? Double ?? 0)
    }
    return alphas
  }

  private static func canvasFrame(of window: NSWindow) -> CGRect {
    window.convertToScreen(window.contentView.map { $0.convert($0.bounds, to: nil) } ?? .zero)
  }

  private static func isChromium(_ window: NSWindow) -> Bool {
    origin(of: type(of: window)) == .chromium
  }

  private static func origin(of cls: AnyClass) -> ReportViewOrigin {
    let key = ObjectIdentifier(cls)
    if let known = origins[key] { return known }
    let path = Bundle(for: cls).bundlePath
    let found: ReportViewOrigin
    if let chromium = chromiumBundlePath, path == chromium {
      found = .chromium
    } else if path == Bundle.main.bundlePath || path.hasPrefix(Bundle.main.bundlePath + "/") {
      found = .app
    } else if path.hasPrefix("/System/") {
      found = .system
    } else {
      found = .other
    }
    origins[key] = found
    return found
  }

  private static func traits(of view: NSView) -> ReportViewTraits {
    let cls: AnyClass = type(of: view)
    let engine = view is ArdiaWebView || view is WKWebView || pageEngineClasses.contains { view.isKind(of: $0) }
    return ReportViewTraits(
      pageEngine: engine, pagePicture: view.accessibilityIdentifier() == ReportPageMask.pagePictureIdentifier, origin: origin(of: cls),
      chromiumContainer: ReportPageMask.chromiumContainers.contains(NSStringFromClass(cls)))
  }

  private static func source(of view: NSView, traits: ReportViewTraits) -> PageSource {
    if let web = view as? ArdiaWebView { return web.recordingShowsPage ? .engine : .idle }
    if view is WKWebView { return .engine }
    return traits.pagePicture && !traits.pageEngine && traits.origin != .chromium ? .picture : .unknown
  }

  private static func scan(_ content: NSView, collectingStills: Bool) -> (pages: [Page], stills: [NSView]) {
    var found: [Page] = []
    var still: [NSView] = []
    func visit(_ view: NSView, isRoot: Bool) {
      if view.isHidden || view.alphaValue <= 0.01 || (view.layer?.opacity ?? 1) <= 0.01 { return }
      if collectingStills, ReportLayerCache.isStill(view) {
        still.append(view)
        return
      }
      let traits = traits(of: view)
      if !isRoot, ReportPageMask.verdict(traits) == .page {
        var rect = view.convert(view.bounds, to: content)
        if !content.isFlipped { rect.origin.y = content.bounds.height - rect.maxY }
        found.append(Page(view: view, rect: rect.intersection(content.bounds), source: source(of: view, traits: traits)))
        return
      }
      for child in Self.backToFront(view.subviews) { visit(child, isRoot: false) }
    }
    visit(content, isRoot: true)
    return (found.filter { !$0.rect.isNull && !$0.rect.isEmpty }, still)
  }

  private static func backToFront(_ views: [NSView]) -> [NSView] {
    guard views.contains(where: { ($0.layer?.zPosition ?? 0) != 0 }) else { return views }
    return views.enumerated()
      .sorted { a, b in
        let za = a.element.layer?.zPosition ?? 0, zb = b.element.layer?.zPosition ?? 0
        return za != zb ? za < zb : a.offset < b.offset
      }
      .map(\.element)
  }

  static func devScan(_ window: NSWindow) -> [[String: Any]] {
    guard let content = window.contentView else { return [] }
    return scan(content, collectingStills: true).pages.map {
      ["class": NSStringFromClass(type(of: $0.view)), "rect": [$0.rect.minX, $0.rect.minY, $0.rect.width, $0.rect.height], "source": "\($0.source)"]
    }
  }

  private func freshPicture(of view: NSView, now: CFTimeInterval) -> CGImage? {
    guard let entry = pagePictures[ObjectIdentifier(view)], entry.clock.fresh(now: now) else { return nil }
    return entry.image
  }

  private func freshWindowPicture(_ number: Int, now: CFTimeInterval) -> CGImage? {
    guard let entry = windowPictures[number], entry.clock.fresh(now: now) else { return nil }
    return entry.image
  }

  private func forgetPictures() {
    let livePages = Set((pages + overlays.flatMap(\.pages)).filter { $0.source == .engine }.map { ObjectIdentifier($0.view) })
    for (key, entry) in pagePictures where !livePages.contains(key) {
      pictureMisses += entry.clock.misses
      pagePictures[key] = nil
    }
    let liveWindows = Set(overlays.filter { $0.placement.candidate.kind != .app }.map(\.placement.candidate.number))
    for (key, entry) in windowPictures where !liveWindows.contains(key) {
      pictureMisses += entry.clock.misses
      windowPictures[key] = nil
    }
  }

  private func capped(_ image: CGImage, points: CGSize) -> CGImage? {
    let width = Int((points.width * outputScale).rounded(.up)), height = Int((points.height * outputScale).rounded(.up))
    guard width > 0, height > 0 else { return nil }
    if image.width <= width, image.height <= height { return image }
    guard let ctx = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return nil }
    ctx.interpolationQuality = .medium
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return ctx.makeImage()
  }

  private func requestPictures(now: CFTimeInterval) {
    for page in pages + overlays.flatMap(\.pages) where page.source == .engine {
      let key = ObjectIdentifier(page.view)
      var entry = pagePictures[key] ?? Picture()
      guard let generation = entry.clock.request(now: now) else { continue }
      pagePictures[key] = entry
      let points = page.rect.size
      let done: (CGImage?) -> Void = { [weak self] image in
        guard let self, var entry = self.pagePictures[key] else { return }
        let kept = image.flatMap { self.capped($0, points: points) }
        if entry.clock.receive(generation, ok: kept != nil, now: CACurrentMediaTime()) { entry.image = kept }
        self.pagePictures[key] = entry
      }
      if let web = page.view as? ArdiaWebView {
        web.copyRecordingPicture { image in
          let kept = image
          DispatchQueue.main.async { done(kept) }
        }
      } else if let web = page.view as? WKWebView {
        snapshotWithoutMedia(web, done: done)
      } else {
        done(nil)
      }
    }
    for overlay in overlays where overlay.placement.candidate.kind != .app {
      let number = overlay.placement.candidate.number
      var entry = windowPictures[number] ?? Picture()
      guard let generation = entry.clock.request(now: now) else { continue }
      windowPictures[number] = entry
      let points = overlay.placement.rect.size
      ArdiaWebView.copyRecordingPicture(of: overlay.window) { [weak self] image in
        let kept = image
        DispatchQueue.main.async {
          guard let self, var entry = self.windowPictures[number] else { return }
          let capped = kept.flatMap { $0.width > 1 ? self.capped($0, points: points) : nil }
          if entry.clock.receive(generation, ok: capped != nil, now: CACurrentMediaTime()) { entry.image = capped }
          self.windowPictures[number] = entry
        }
      }
    }
  }

  private func snapshotWithoutMedia(_ web: WKWebView, done: @escaping (CGImage?) -> Void) {
    web.requestMediaPlaybackState { [weak self, weak web] before in
      guard let web, before == WKMediaPlaybackState.none else {
        self?.webKitMediaWithheld += 1
        return done(nil)
      }
      web.takeSnapshot(with: nil) { image, _ in
        web.requestMediaPlaybackState { after in
          guard after == WKMediaPlaybackState.none else {
            self?.webKitMediaWithheld += 1
            return done(nil)
          }
          done(image?.cgImage(forProposedRect: nil, context: nil, hints: nil))
        }
      }
    }
  }
}
