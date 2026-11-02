import AppKit
import ArdiaCore
import ExpoModulesCore

public class ShellModule: Module {
  private static var quitCancelledOwner: ObjectIdentifier?

  private let lifetime = ModuleLifetime()
  private var appearanceObservation: NSKeyValueObservation?
  private var sidebarObservers: [(NotificationCenter, NSObjectProtocol)] = []
  private var flagsMonitor: Any?

  public func definition() -> ModuleDefinition {
    Name("ArdiaShell")
    Events(ShellEvents.Channel.openURLs.rawValue, ShellEvents.Channel.app.rawValue)

    OnCreate {
      _ = installTextFieldSelectAll
      _ = installInputSourceKeys
      _ = installScrollViewInsetFix
      _ = installOutsidePressMonitor
      _ = installWindowMoveFallback
      self.lifetime.begin(self) {
        self.appearanceObservation?.invalidate()
        self.appearanceObservation = nil
        for (center, token) in self.sidebarObservers { center.removeObserver(token) }
        self.sidebarObservers = []
        if let monitor = self.flagsMonitor { NSEvent.removeMonitor(monitor) }
        self.flagsMonitor = nil
        if Self.quitCancelledOwner == ObjectIdentifier(self) {
          Self.quitCancelledOwner = nil
          ArdiaHost.quitCancelledHandler = nil
        }
        ShellEvents.retire(self)
      }
      self.lifetime.onMain { [weak self] in
        guard let self else { return }
        self.appearanceObservation = NSApp.observe(\.effectiveAppearance) { _, _ in
          ShellEvents.send(.app, ["type": "appearance", "dark": ShellModule.isDark])
        }
        self.observeForSidebar()
        ArdiaHost.quitCancelledHandler = { ShellEvents.send(.app, ["type": "quitCancelled"]) }
        Self.quitCancelledOwner = ObjectIdentifier(self)
      }
    }

    OnDestroy {
      self.lifetime.end()
      ShellEvents.detach(self)
    }

    OnStartObserving(ShellEvents.Channel.app.rawValue) { ShellEvents.attach(.app, to: self, while: self.lifetime) }

    OnStartObserving(ShellEvents.Channel.openURLs.rawValue) { ShellEvents.attach(.openURLs, to: self, while: self.lifetime) }

    AsyncFunction("setAppearance") { (mode: String) in
      NSApp.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    }.runOnQueue(.main)
    AsyncFunction("isDarkAppearance") { () -> Bool in ShellModule.isDark }.runOnQueue(.main)
    Function("startDictation") {
      DispatchQueue.main.async { NSApp.sendAction(Selector(("startDictation:")), to: nil, from: nil) }
    }
    AsyncFunction("fetchBangList") { (etag: String?, promise: Promise) in
      BangListFetch.start(etag: etag) { result in
        switch result {
        case .success(let reply): promise.resolve(reply)
        case .failure(let error): promise.reject("ERR_BANG_LIST", error.localizedDescription)
        }
      }
    }
    Function("copyText") { (text: String) in
      DispatchQueue.main.async {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      }
    }
    AsyncFunction("readText") { () -> String in NSPasteboard.general.string(forType: .string) ?? "" }.runOnQueue(.main)
  }

  private func observeForSidebar() {
    let emit: (String) -> Void = { ShellEvents.send(.app, ["type": $0]) }
    let quiet = { NSApp.modalWindow == nil && !NSApp.windows.contains { $0.attachedSheet != nil || $0.isSheet && $0.isVisible } }
    let workspace = NotificationCenter.default
    sidebarObservers.append((workspace, workspace.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in
      if quiet() { emit("resignActive") }
    }))
    let distributed = DistributedNotificationCenter.default()
    sidebarObservers.append((distributed, distributed.addObserver(forName: .init("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
      emit("lockedOrAsleep")
      if quiet() { emit("screenLocked") }
    }))
    let session = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
      sidebarObservers.append((session, session.addObserver(forName: name, object: nil, queue: .main) { _ in emit("lockedOrAsleep") }))
    }
    flagsMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
      if SwitcherHold.released(by: event.modifierFlags) { emit("switcherReleased") }
      return event
    }
  }

  static var isDark: Bool {
    NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
  }
}
