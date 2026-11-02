import AppKit
import ArdiaCore
import Expo
import React
import ArdiaShell
import ArdiaSync
import ReactAppDependencyProvider

final class AppDelegate: ExpoAppDelegate {
  private var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  private var reactNativeFactory: RCTReactNativeFactory?

  override func applicationDidFinishLaunching(_ notification: Notification) {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    WindowHost.makeWindow = { BrowserWindow() }
    WindowHost.makeContentView = { [weak factory] windowId in
      (factory?.rootViewFactory as? ExpoReactRootViewFactory)?.superView(
        withModuleName: "main", initialProperties: ["windowId": windowId], launchOptions: nil) ?? NSView()
    }
    factory.rootViewFactory.initializeReactHost(launchOptions: nil)

    super.applicationDidFinishLaunching(notification)

    LegacyDockTile.repointSoon(isolatedInstance: LaunchConfig.shared.isolated)
  }

  override func application(_ application: NSApplication, open urls: [URL]) {
    OpenURLInbox.receive(urls)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    ShellApp.shouldTerminate()
  }

  override func applicationWillTerminate(_ notification: Notification) {
    super.applicationWillTerminate(notification)
    atexit {
      fflush(nil)
      _exit(0)
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    ShellApp.reopen(hasVisibleWindows: flag)
  }

  func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
    ShellApp.dockMenu()
  }

  override func application(_ application: NSApplication, willContinueUserActivityWithType userActivityType: String) -> Bool {
    userActivityType == NSUserActivityTypeBrowsingWeb || super.application(application, willContinueUserActivityWithType: userActivityType)
  }

  override func application(
    _ application: NSApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void
  ) -> Bool {
    Handoff.continue(userActivity) || super.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }

  func application(_ sender: NSApplication, delegateHandlesKey key: String) -> Bool {
    ShellScripting.handles(key)
  }

  @objc var appleScriptWindows: [NSObject] { ShellScripting.windows }
  @objc var appleScriptProfiles: [NSObject] { ShellScripting.profiles }
  @objc var version: String { ShellScripting.version }
}

final class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    if let location = LaunchConfig.shared.instance("jsLocation") {
      var arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
      arguments["RCT_jsLocation"] = location
      UserDefaults.standard.setVolatileDomain(arguments, forName: UserDefaults.argumentDomain)
    }
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
