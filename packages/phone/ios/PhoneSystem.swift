import ArdiaBrowser
import Darwin
import ArdiaDesign
import ExpoModulesCore
import UIKit

@MainActor
public final class PhoneSystemLinks {
  public static let shared = PhoneSystemLinks()

  public static let quickActions: [String: SystemLink] = [
    "com.ardia.browser.ios.search": .search(query: nil),
    "com.ardia.browser.ios.voice": .voiceSearch,
    "com.ardia.browser.ios.incognito": .incognito,
  ]

  public let defaultBrowser = DefaultBrowserStatus(defaults: .standard, asksSystem: true)

  var sink: (([String: Any]) -> Void)? {
    didSet { flush() }
  }

  private var queued: [[String: Any]] = []

  @discardableResult
  public func receive(url: URL, source: String = "system") -> Bool {
    if let link = SystemLink(url) {
      deliver(Self.payload(link, source: source))
      return true
    }
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
    defaultBrowser.receivedLinkFromSystem()
    deliver(["kind": "open", "url": url.absoluteString, "source": "web"])
    return true
  }

  @discardableResult
  public func receive(shortcutType: String) -> Bool {
    guard let link = Self.quickActions[shortcutType] else { return false }
    deliver(Self.payload(link, source: "shortcut"))
    return true
  }

  @discardableResult
  public func receive(userActivity: NSUserActivity) -> Bool {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL,
          let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
    deliver(["kind": "open", "url": url.absoluteString, "source": "handoff"])
    return true
  }

  public func post(_ link: SystemLink, source: String) {
    deliver(Self.payload(link, source: source))
  }

  public func sceneBecameActive() {
    defaultBrowser.sceneBecameActive()
    UIApplication.shared.shortcutItems = [
      UIApplicationShortcutItem(type: "com.ardia.browser.ios.search", localizedTitle: String(localized: "Search"), localizedSubtitle: nil, icon: UIApplicationShortcutIcon(systemImageName: "magnifyingglass")),
      UIApplicationShortcutItem(type: "com.ardia.browser.ios.voice", localizedTitle: String(localized: "Voice Search"), localizedSubtitle: nil, icon: UIApplicationShortcutIcon(systemImageName: "mic")),
      UIApplicationShortcutItem(type: "com.ardia.browser.ios.incognito", localizedTitle: String(localized: "New Incognito Tab"), localizedSubtitle: nil, icon: UIApplicationShortcutIcon(systemImageName: "eyes")),
    ]
    drainInbox()
  }

  func takeInitial() -> [String: Any]? {
    queued.isEmpty ? nil : queued.removeFirst()
  }

  private func drainInbox() {
    guard let store = SystemStore.shared else { return }
    for item in store.pendingInbox() {
      guard case .open = item.action else { continue }
      store.removeFromInbox(item.id)
      if let url = item.url { deliver(["kind": "open", "url": url, "source": "share"]) }
    }
  }

  private func deliver(_ payload: [String: Any]) {
    if PhoneTestBuild.flag("ArdiaLogSystemLinks"),
       let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
      NSLog("ARDIA_SYSTEM_LINK %@", String(decoding: data, as: UTF8.self))
    }
    queued.append(payload)
    flush()
  }

  private func flush() {
    guard let sink else { return }
    while !queued.isEmpty { sink(queued.removeFirst()) }
  }

  static func payload(_ link: SystemLink, source: String) -> [String: Any] {
    switch link {
    case .search(let query):
      var payload: [String: Any] = ["kind": "search", "source": source]
      if let query { payload["query"] = query }
      return payload
    case .voiceSearch: return ["kind": "voiceSearch", "source": source]
    case .incognito: return ["kind": "incognito", "source": source]
    case .open(let url): return ["kind": "open", "url": url.absoluteString, "source": source]
    case .tab(let id): return ["kind": "tab", "id": id.uuidString, "source": source]
    case .macTabs: return ["kind": "macTabs", "source": source]
    case .inbox: return ["kind": "inbox", "source": source]
    }
  }
}

public final class SystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPhoneSystem")

    Events("onSystemLink")

    OnStartObserving {
      onMain {
        PhoneSystemLinks.shared.sink = { [weak self] link in self?.sendEvent("onSystemLink", link) }
      }
    }

    OnStopObserving {
      onMain { PhoneSystemLinks.shared.sink = nil }
    }

    Function("processStartedAt") { () -> Double? in
      ProcessStart.epochMilliseconds()
    }

    AsyncFunction("initialLink") { () -> [String: Any]? in
      MainActor.assumeIsolated { PhoneSystemLinks.shared.takeInitial() }
    }.runOnQueue(.main)
  }
}

public final class DefaultBrowserModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPhoneDefaultBrowser")

    AsyncFunction("status") { () -> [String: Any] in
      MainActor.assumeIsolated {
        ["isDefault": PhoneSystemLinks.shared.defaultBrowser.isDefault, "canAsk": DefaultBrowserStatus.isOffered]
      }
    }.runOnQueue(.main)

    AsyncFunction("requestRole") { () -> Bool in
      false
    }

    AsyncFunction("openDefaultAppsSettings") {
      MainActor.assumeIsolated {
        PhoneSystemLinks.shared.defaultBrowser.willOpenSystemSettings()
        if let url = URL(string: UIApplication.openDefaultApplicationsSettingsURLString) {
          UIApplication.shared.open(url)
        }
      }
    }.runOnQueue(.main)
  }
}

enum ProcessStart {
  static func epochMilliseconds() -> Double? {
    var record = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&name, UInt32(name.count), &record, &size, nil, 0) == 0, size > 0 else { return nil }
    let start = record.kp_proc.p_un.__p_starttime
    let milliseconds = Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
    return milliseconds > 0 ? milliseconds.rounded() : nil
  }
}
