import ArdiaPhoneNative
import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene,
          let factory = (UIApplication.shared.delegate as? AppDelegate)?.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    let links = PhoneSystemLinks.shared
    for context in connectionOptions.urlContexts {
      links.receive(url: context.url)
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
    if let item = connectionOptions.shortcutItem { links.receive(shortcutType: item.type) }
    for activity in connectionOptions.userActivities { links.receive(userActivity: activity) }
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    PhoneSystemLinks.shared.sceneBecameActive()
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      PhoneSystemLinks.shared.receive(url: context.url)
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    PhoneSystemLinks.shared.receive(userActivity: userActivity)
  }

  func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem) async -> Bool {
    PhoneSystemLinks.shared.receive(shortcutType: shortcutItem.type)
  }
}
