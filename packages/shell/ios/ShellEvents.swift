import AppKit
import ExpoModulesCore

enum ShellEvents {
  enum Channel: String {
    case command = "onCommand"
    case openURLs = "onOpenURLs"
    case window = "onWindowEvent"
    case app = "onAppEvent"
    case notificationResponse = "onNotificationResponse"
    case scriptCommand = "onScriptCommand"
  }

  private struct Sink {
    let owner: ObjectIdentifier
    weak var module: Module?
    let lifetime: ModuleLifetime

    var live: Module? { lifetime.isAlive && module?.appContext != nil ? module : nil }
  }

  private static var sinks: [Channel: Sink] = [:]

  static func attach(_ channel: Channel, to module: Module, while lifetime: ModuleLifetime) {
    DispatchQueue.main.async { [weak module] in
      guard let module else { return }
      lifetime.run {
        sinks[channel] = Sink(owner: ObjectIdentifier(module), module: module, lifetime: lifetime)
        switch channel {
        case .openURLs: OpenURLInbox.flush()
        case .notificationResponse: NotificationHub.shared.flushPending()
        default: break
        }
      }
    }
  }

  static func detach(_ module: Module, then: @escaping (Set<Channel>) -> Void = { _ in }) {
    let owner = ObjectIdentifier(module)
    DispatchQueue.main.async {
      let owned = Set(sinks.filter { $0.value.owner == owner }.keys)
      for channel in owned { sinks[channel] = nil }
      then(owned)
    }
  }

  static func retire(_ module: Module) {
    let owner = ObjectIdentifier(module)
    sinks = sinks.filter { $0.value.owner != owner }
  }

  static func isAttached(_ channel: Channel) -> Bool { sinks[channel]?.live != nil }

  @discardableResult
  static func send(_ channel: Channel, _ body: [String: Any]) -> Bool {
    guard let module = sinks[channel]?.live else { return false }
    module.sendEvent(channel.rawValue, body)
    return true
  }
}
