import ArdiaPhoneNative
import React
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard start(scene) else { return }
    let links = PhoneSystemLinks.shared
    for context in connectionOptions.urlContexts {
      links.receive(url: context.url)
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
    if let item = connectionOptions.shortcutItem { links.receive(shortcutType: item.type) }
    for activity in connectionOptions.userActivities { links.receive(userActivity: activity) }
  }

  @discardableResult
  func start(_ scene: UIScene) -> Bool {
    guard window == nil, let windowScene = scene as? UIWindowScene,
          let factory = (UIApplication.shared.delegate as? AppDelegate)?.reactNativeFactory else { return false }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    return true
  }

  static func adopt(_ scene: UIScene) {
    guard !(scene.delegate is SceneDelegate) else { return }
    let adopted = SceneDelegate()
    scene.delegate = adopted
    DispatchQueue.main.async {
      guard adopted.start(scene) else { return }
      if scene.activationState == .foregroundActive { adopted.sceneDidBecomeActive(scene) }
    }
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    PhoneSystemLinks.shared.sceneBecameActive()
    PhoneSyncHost.shared.sceneBecameActive()
  }

  func sceneWillResignActive(_ scene: UIScene) {
    PhoneSyncHost.shared.sceneWillResignActive()
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
