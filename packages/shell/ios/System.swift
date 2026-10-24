import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

public class SystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSystem")

    Constant("backgroundInstance") { () -> Bool in FileDropView.background }

    AsyncFunction("isDefaultBrowser") { () -> Bool in
      guard let probe = URL(string: "https://example.com"),
            let handler = NSWorkspace.shared.urlForApplication(toOpen: probe) else { return false }
      return handler.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL
    }.runOnQueue(.main)

    AsyncFunction("setAsDefaultBrowser") { (promise: Promise) in
      if FileDropView.background {
        NSLog("ArdiaSystem: background instance, not setting the default browser")
        return promise.resolve(false)
      }
      let app = Bundle.main.bundleURL
      NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "http") { error in
        guard error == nil else { return promise.resolve(false) }
        NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "https") { _ in
          DispatchQueue.main.async {
            let handler = URL(string: "https://example.com").flatMap(NSWorkspace.shared.urlForApplication(toOpen:))
            promise.resolve(handler?.standardizedFileURL == app.standardizedFileURL)
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("launchAtLoginStatus") { () -> String in
      switch SMAppService.mainApp.status {
      case .enabled: return "enabled"
      case .requiresApproval: return "requiresApproval"
      case .notFound: return "notFound"
      default: return "notRegistered"
      }
    }.runOnQueue(.main)

    AsyncFunction("setLaunchAtLogin") { (enabled: Bool) in
      if FileDropView.background {
        NSLog("ArdiaSystem: background instance, not changing launch at login")
        return
      }
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    }.runOnQueue(.main)

    Function("fileExists") { (path: String) -> Bool in FileManager.default.fileExists(atPath: path) }

    AsyncFunction("openFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      if FileDropView.background {
        NSLog("ArdiaSystem: background instance, not opening %@", path)
        return true
      }
      return NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }.runOnQueue(.main)

    AsyncFunction("revealFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      if FileDropView.background {
        NSLog("ArdiaSystem: background instance, not revealing %@", path)
        return true
      }
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
      return true
    }.runOnQueue(.main)

    AsyncFunction("moveToTrash") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      do {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        return true
      } catch {
        return false
      }
    }.runOnQueue(.main)

    AsyncFunction("fileIcon") { (path: String, size: Double) -> String? in
      let icon = FileManager.default.fileExists(atPath: path)
        ? NSWorkspace.shared.icon(forFile: path)
        : NSWorkspace.shared.icon(for: .init(filenameExtension: (path as NSString).pathExtension) ?? .data)
      let points = CGFloat(size)
      let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(points * 2), pixelsHigh: Int(points * 2), bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
      guard let rep else { return nil }
      rep.size = NSSize(width: points, height: points)
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      icon.draw(in: NSRect(x: 0, y: 0, width: points, height: points))
      NSGraphicsContext.restoreGraphicsState()
      guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
      return "data:image/png;base64,\(png.base64EncodedString())"
    }.runOnQueue(.main)

    AsyncFunction("appIcon") { (pid: Int, size: Double) -> String? in
      guard let icon = NSRunningApplication(processIdentifier: pid_t(pid))?.icon else { return nil }
      let points = CGFloat(size)
      guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(points * 2), pixelsHigh: Int(points * 2), bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
      else { return nil }
      rep.size = NSSize(width: points, height: points)
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
      icon.draw(in: NSRect(x: 0, y: 0, width: points, height: points))
      NSGraphicsContext.restoreGraphicsState()
      guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
      return "data:image/png;base64,\(png.base64EncodedString())"
    }.runOnQueue(.main)

    Function("hapticTick") {
      DispatchQueue.main.async {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        HapticLog.note("alignment")
      }
    }

    AsyncFunction("menuShortcuts") { () -> [[String: Any]] in MainMenu.shortcutList() }.runOnQueue(.main)

    AsyncFunction("recordShortcut") { (promise: Promise) in ShortcutRecorder.shared.record(promise) }.runOnQueue(.main)
    AsyncFunction("cancelRecording") { ShortcutRecorder.shared.finish(nil) }.runOnQueue(.main)
  }
}

final class ShortcutRecorder {
  static let shared = ShortcutRecorder()
  private var monitor: Any?
  private var promise: Promise?

  func record(_ promise: Promise) {
    finish(nil)
    self.promise = promise
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown]) { [weak self] event in
      guard let self else { return event }
      guard event.type == .keyDown else {
        self.finish(nil)
        return event
      }
      let flags = event.modifierFlags.intersection([.command, .option, .control, .shift, .function])
      if event.keyCode == 53, flags.subtracting(.function).isEmpty {
        self.finish(nil)
        return nil
      }
      let key = (event.characters(byApplyingModifiers: []) ?? event.charactersIgnoringModifiers ?? "").lowercased()
      guard !key.isEmpty else { return nil }
      let functionKey = key.unicodeScalars.first.map { (0xF704...0xF726).contains($0.value) } ?? false
      guard flags.contains(.command) || flags.contains(.control) || functionKey else {
        NSSound.beep()
        return nil
      }
      var mods: [String] = []
      if flags.contains(.control) { mods.append("control") }
      if flags.contains(.option) { mods.append("option") }
      if flags.contains(.shift) { mods.append("shift") }
      if flags.contains(.command) { mods.append("command") }
      if flags.contains(.function), let scalar = key.unicodeScalars.first, scalar.value < 0xF700 { mods.append("function") }
      self.finish(["key": key, "modifiers": mods])
      return nil
    }
  }

  func finish(_ result: [String: Any]?) {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    let pending = promise
    promise = nil
    pending?.resolve(result)
  }
}

public class FileDragModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFileDrag")

    View(FileDragView.self) {
      Events("onMiddleClick")
      Prop("path") { (view: FileDragView, path: String?) in view.path = path }
    }
  }
}

final class FileDragView: ExpoView, NSDraggingSource {
  var path: String?
  let onMiddleClick = EventDispatcher()
  private var downAt: NSPoint?

  override func otherMouseUp(with event: NSEvent) {
    guard event.buttonNumber == 2 else { return super.otherMouseUp(with: event) }
    let flags = event.modifierFlags
    onMiddleClick(["shiftKey": flags.contains(.shift), "altKey": flags.contains(.option), "metaKey": flags.contains(.command)])
  }

  override func mouseDown(with event: NSEvent) {
    downAt = event.locationInWindow
    super.mouseDown(with: event)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let start = downAt, let path, FileManager.default.fileExists(atPath: path) else {
      return super.mouseDragged(with: event)
    }
    let p = event.locationInWindow
    guard hypot(p.x - start.x, p.y - start.y) > 4 else { return }
    downAt = nil
    let url = URL(fileURLWithPath: path)
    if FileDropView.background {
      FileDropView.lastFileDrag = [url]
      return
    }
    let item = NSDraggingItem(pasteboardWriter: url as NSURL)
    let icon = NSWorkspace.shared.icon(forFile: path)
    let local = convert(event.locationInWindow, from: nil)
    item.setDraggingFrame(NSRect(x: local.x - 16, y: local.y - 16, width: 32, height: 32), contents: icon)
    beginDraggingSession(with: [item], event: event, source: self)
  }

  override func mouseUp(with event: NSEvent) {
    downAt = nil
    super.mouseUp(with: event)
  }

  func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
    [.copy, .generic]
  }
}

enum HapticLog {
  private static let path: String? = {
    let env = ProcessInfo.processInfo.environment
    guard env["ARDIA_BACKGROUND"] == "1", let dir = env["ARDIA_DATA_DIR"] else { return nil }
    return (dir as NSString).appendingPathComponent("haptics.log")
  }()

  private static let queue = DispatchQueue(label: "ardia.haptic-log", qos: .utility)
  private static let maxBytes: UInt64 = 64 * 1024

  static func note(_ pattern: String) {
    guard let path else { return }
    let line = "\(Date()) \(pattern)\n"
    queue.async {
      guard let data = line.data(using: .utf8) else { return }
      guard let file = FileHandle(forWritingAtPath: path) else {
        FileManager.default.createFile(atPath: path, contents: data)
        return
      }
      defer { file.closeFile() }
      if file.seekToEndOfFile() < maxBytes { file.write(data) }
    }
  }
}
public class FileDropModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFileDrop")

    View(FileDropView.self) {
      Events("onDropUpdate")
    }

    AsyncFunction("devDrag") { (windowId: String, action: String, x: Double, y: Double, payload: [String: Any]?) -> String in
      #if DEBUG
      return DevDragSession.act(windowId: windowId, action: action, x: x, y: y, payload: payload ?? [:])
      #else
      return "debug builds only"
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devLastFileDrag") { () -> [String] in
      #if DEBUG
      return FileDropView.lastFileDrag.map(\.path)
      #else
      return []
      #endif
    }.runOnQueue(.main)
  }
}

enum DroppedLinks {
  static let maxItems = 50
  static let linkFileExtensions: Set<String> = ["webloc", "inetloc", "url"]
  private static let maxLinkFileSize = 64 * 1024

  static func webURL(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.count < 8192, let url = URL(string: text), let scheme = url.scheme?.lowercased(),
          scheme == "http" || scheme == "https", url.host?.isEmpty == false else { return nil }
    return url.absoluteString
  }

  static func hostLike(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, text.count < 2048, text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return nil }
    if let colon = text.firstIndex(of: ":") {
      let scheme = text[..<colon]
      if !scheme.isEmpty, scheme.allSatisfy({ $0.isLetter || $0.isNumber || "+.-".contains($0) }), !scheme.contains(".") {
        return webURL(text)
      }
    }
    return text.contains(".") ? text : nil
  }

  static func linkTarget(_ file: URL) -> String? {
    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? Int.max
    guard size <= maxLinkFileSize, let data = try? Data(contentsOf: file) else { return nil }
    if file.pathExtension.lowercased() == "url" {
      let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
      for line in text.components(separatedBy: .newlines) where line.lowercased().hasPrefix("url=") {
        return webURL(String(line.dropFirst(4)))
      }
      return nil
    }
    let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
    return (plist?["URL"] as? String).flatMap(webURL)
  }

  static func fileURLs(_ pasteboard: NSPasteboard) -> [URL] {
    (pasteboard.pasteboardItems ?? []).compactMap { item -> URL? in
      guard let raw = item.string(forType: .fileURL), let url = URL(string: raw), url.isFileURL else { return nil }
      let path = ((url as NSURL).filePathURL ?? url).standardizedFileURL
      return path.isFileURL && path.path.hasPrefix("/") ? path : nil
    }
  }

  static func webURLs(_ pasteboard: NSPasteboard) -> [String] {
    (pasteboard.pasteboardItems ?? []).compactMap { $0.string(forType: .URL).flatMap(webURL) }
  }

  static func items(_ pasteboard: NSPasteboard) -> [[String: String]] {
    let files = fileURLs(pasteboard)
    if !files.isEmpty {
      return Array(files.prefix(maxItems).compactMap { file -> [String: String]? in
        if linkFileExtensions.contains(file.pathExtension.lowercased()) { return linkTarget(file).map { ["kind": "url", "url": $0] } }
        return FileManager.default.fileExists(atPath: file.path) ? ["kind": "file", "url": file.absoluteString] : nil
      })
    }
    let links = webURLs(pasteboard)
    if !links.isEmpty { return links.prefix(maxItems).map { ["kind": "url", "url": $0] } }
    if let text = pasteboard.string(forType: .string), let candidate = hostLike(text) {
      return [webURL(candidate).map { ["kind": "url", "url": $0] } ?? ["kind": "text", "text": candidate]]
    }
    return []
  }

  static func count(_ pasteboard: NSPasteboard) -> Int {
    items(pasteboard).count
  }
}

final class FileDropView: ExpoView {
  static let background = ProcessInfo.processInfo.environment["ARDIA_BACKGROUND"] == "1"
  static var lastFileDrag: [URL] = []

  let onDropUpdate = EventDispatcher()
  private var count = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    registerForDraggedTypes([.fileURL, .URL, .string])
  }

  private func emit(_ phase: String, _ info: NSDraggingInfo, items: [[String: String]] = []) {
    let p = convert(info.draggingLocation, from: nil)
    onDropUpdate(["phase": phase, "x": p.x, "y": isFlipped ? p.y : bounds.height - p.y, "count": count, "items": items])
  }

  private func operation(_ info: NSDraggingInfo) -> NSDragOperation {
    guard count > 0 else { return [] }
    let mask = info.draggingSourceOperationMask
    if mask.contains(.copy) { return .copy }
    if mask.contains(.generic) { return .generic }
    return mask.contains(.link) ? .link : []
  }

  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
    count = DroppedLinks.count(sender.draggingPasteboard)
    guard count > 0 else { return [] }
    emit("enter", sender)
    return operation(sender)
  }

  override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
    guard count > 0 else { return [] }
    emit("move", sender)
    return operation(sender)
  }

  override func draggingExited(_ sender: NSDraggingInfo?) {
    guard count > 0 else { return }
    if let sender { emit("exit", sender) } else { onDropUpdate(["phase": "exit", "x": 0, "y": 0, "count": count, "items": []]) }
    count = 0
  }

  override func draggingEnded(_ sender: NSDraggingInfo) {
    guard count > 0 else { return }
    emit("exit", sender)
    count = 0
  }

  override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
    count > 0
  }

  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    guard count > 0 else { return false }
    let items = DroppedLinks.items(sender.draggingPasteboard)
    emit("drop", sender, items: items)
    count = 0
    return !items.isEmpty
  }

}

#if DEBUG
final class DevDraggingInfo: NSObject, NSDraggingInfo {
  let draggingDestinationWindow: NSWindow?
  let draggingLocation: NSPoint
  let draggingPasteboard: NSPasteboard
  let draggingSequenceNumber: Int
  let draggingSourceOperationMask: NSDragOperation = [.copy, .link, .generic, .move]
  var draggedImageLocation: NSPoint { draggingLocation }
  var draggedImage: NSImage? { nil }
  var draggingSource: Any? { nil }
  var draggingFormation: NSDraggingFormation = .default
  var animatesToDestination = false
  var numberOfValidItemsForDrop = 0
  var springLoadingHighlight: NSSpringLoadingHighlight { .none }

  init(window: NSWindow, location: NSPoint, pasteboard: NSPasteboard, sequence: Int) {
    draggingDestinationWindow = window
    draggingLocation = location
    draggingPasteboard = pasteboard
    draggingSequenceNumber = sequence
  }

  func slideDraggedImage(to screenPoint: NSPoint) {}
  func enumerateDraggingItems(options enumOpts: NSDraggingItemEnumerationOptions = [], for view: NSView?, classes classArray: [AnyClass],
                              searchOptions: [NSPasteboard.ReadingOptionKey: Any] = [:],
                              using block: (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void) {}
  func resetSpringLoading() {}
}

enum DevDragSession {
  private static var pasteboard: NSPasteboard?
  private static weak var target: FileDropView?
  private static var sequence = 0

  static func act(windowId: String, action: String, x: Double, y: Double, payload: [String: Any]) -> String {
    guard let window = WindowManager.shared.windows[windowId], let content = window.contentView, let frameView = content.superview else { return "no window" }
    if pasteboard == nil || !payload.isEmpty {
      let board = NSPasteboard.withUniqueName()
      board.clearContents()
      var writers: [NSPasteboardWriting] = []
      if payload["fileDrag"] as? Bool == true { writers += FileDropView.lastFileDrag.map { $0 as NSURL } }
      writers += (payload["files"] as? [String] ?? []).map { URL(fileURLWithPath: $0) as NSURL }
      writers += (payload["urls"] as? [String] ?? []).compactMap { NSURL(string: $0) }
      if let text = payload["text"] as? String { writers.append(text as NSString) }
      for raw in payload["publicURLs"] as? [String] ?? [] {
        let item = NSPasteboardItem()
        item.setString(raw, forType: .URL)
        writers.append(item)
      }
      guard !writers.isEmpty else { return "nothing to drag" }
      board.writeObjects(writers)
      pasteboard = board
      sequence += 1
    }
    guard let board = pasteboard else { return "no drag" }
    let local = NSPoint(x: x, y: content.isFlipped ? y : content.bounds.height - y)
    let location = content.convert(local, to: nil)
    let info = DevDraggingInfo(window: window, location: location, pasteboard: board, sequence: sequence)
    let types = Set(board.types ?? [])
    var under = frameView.hitTest(location)
    while let view = under, Set(view.registeredDraggedTypes).isDisjoint(with: types) { under = view.superview }
    let ours = under as? FileDropView
    let name = { (view: NSView?) in view.map { NSStringFromClass(type(of: $0)) } ?? "none" }
    func finish() {
      pasteboard = nil
      target = nil
    }
    if action == "cancel" || action == "end" {
      if action == "cancel" { target?.draggingExited(info) }
      target?.draggingEnded(info)
      finish()
      return action == "cancel" ? "cancelled" : "ended"
    }
    var operation: NSDragOperation = []
    if ours !== target {
      target?.draggingExited(info)
      target = ours
      operation = ours?.draggingEntered(info) ?? []
    } else {
      operation = ours?.draggingUpdated(info) ?? []
    }
    guard action == "drop" else { return "\(name(under)) \(operation.rawValue)" }
    defer { finish() }
    guard let view = ours, !operation.isEmpty else {
      ours?.draggingExited(info)
      ours?.draggingEnded(info)
      return "\(name(under)) refused"
    }
    guard view.prepareForDragOperation(info) else { return "\(name(view)) refused prepare" }
    let performed = view.performDragOperation(info)
    view.concludeDragOperation(info)
    view.draggingEnded(info)
    return "\(name(view)) \(performed ? "performed" : "declined")"
  }
}
#endif
