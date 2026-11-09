import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers
import ServiceManagement

final class ShortcutRecorder {
  static let shared = ShortcutRecorder()
  private var monitor: Any?
  private var promise: Promise?
  private var owner: ObjectIdentifier?

  var isRecording: Bool { monitor != nil }

  func record(_ promise: Promise, for module: AnyObject) {
    finish(nil)
    self.promise = promise
    owner = ObjectIdentifier(module)
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
    let pending = stop()
    pending?.resolve(result)
  }

  func abandon(by module: AnyObject) {
    guard owner == ObjectIdentifier(module) else { return }
    _ = stop()
  }

  private func stop() -> Promise? {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    owner = nil
    let pending = promise
    promise = nil
    return pending
  }
}
