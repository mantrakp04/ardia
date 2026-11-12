import AppKit
import UserNotifications

final class NotificationHub: NSObject, UNUserNotificationCenterDelegate {
  static let shared = NotificationHub()

  private var pending: [(String, String, [String: Any])] = []
  private static let dismissibleCategory = "ardia.dismissible"

  private var center: UNUserNotificationCenter { .current() }

  func install() {
    center.delegate = self
    center.setNotificationCategories([
      UNNotificationCategory(identifier: Self.dismissibleCategory, actions: [], intentIdentifiers: [], options: [.customDismissAction]),
    ])
  }

  func flushPending() {
    while let (id, action, info) = pending.first, deliver(id, action, info) { pending.removeFirst() }
  }

  private func deliver(_ id: String, _ action: String, _ info: [String: Any]) -> Bool {
    ShellEvents.send(.notificationResponse, [
      "id": id, "action": action, "tabId": info["tabId"] as Any, "windowId": info["windowId"] as Any, "data": info["data"] as Any,
    ])
  }

  func permission(_ completion: @escaping (String) -> Void) {
    center.getNotificationSettings { settings in
      let status: String
      switch settings.authorizationStatus {
      case .authorized: status = "granted"
      case .denied: status = "denied"
      case .provisional, .ephemeral: status = "provisional"
      default: status = "notDetermined"
      }
      DispatchQueue.main.async { completion(status) }
    }
  }

  func requestPermission(_ completion: @escaping (Bool) -> Void) {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      DispatchQueue.main.async { completion(granted) }
    }
  }

  func post(_ options: NotificationOptions, completion: @escaping (String?) -> Void) {
    let id = options.id ?? UUID().uuidString
    let content = UNMutableNotificationContent()
    content.title = options.title
    content.body = options.body
    if let subtitle = options.subtitle { content.subtitle = subtitle }
    if !options.silent { content.sound = .default }
    if let origin = options.origin { content.threadIdentifier = origin }
    if options.dismissible { content.categoryIdentifier = Self.dismissibleCategory }
    let info: [String: Any?] = ["tabId": options.tabId, "windowId": options.windowId, "origin": options.origin, "data": options.data]
    content.userInfo = info.compactMapValues { $0 }

    let deliver = { [center] in
      center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
        DispatchQueue.main.async { completion(error == nil ? id : nil) }
      }
    }
    guard let icon = options.icon.flatMap(URL.init(string:)) else { return deliver() }
    attachment(from: icon, id: id) { attachment in
      if let attachment { content.attachments = [attachment] }
      deliver()
    }
  }

  func remove(_ ids: [String]) {
    center.removeDeliveredNotifications(withIdentifiers: ids)
    center.removePendingNotificationRequests(withIdentifiers: ids)
  }

  private func attachment(from url: URL, id: String, completion: @escaping (UNNotificationAttachment?) -> Void) {
    let make = { (file: URL) in completion(try? UNNotificationAttachment(identifier: "icon", url: file)) }
    if url.isFileURL { return make(url) }
    URLSession.shared.dataTask(with: url) { data, response, _ in
      guard let data, !data.isEmpty else { return DispatchQueue.main.async { completion(nil) } }
      let ext = (response?.mimeType == "image/png" || url.absoluteString.hasPrefix("data:image/png")) ? "png"
        : (response?.suggestedFilename as NSString?)?.pathExtension.nonEmpty ?? "png"
      let file = FileManager.default.temporaryDirectory.appendingPathComponent("ac-notification-\(id).\(ext)")
      do {
        try data.write(to: file)
        DispatchQueue.main.async { make(file) }
      } catch {
        DispatchQueue.main.async { completion(nil) }
      }
    }.resume()
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let id = response.notification.request.identifier
    let info = response.notification.request.content.userInfo as? [String: Any] ?? [:]
    let action: String? = switch response.actionIdentifier {
    case UNNotificationDefaultActionIdentifier: "click"
    case UNNotificationDismissActionIdentifier: "close"
    default: nil
    }
    DispatchQueue.main.async { [self] in
      if let action {
        if action == "click" { NSApp.activate() }
        if !deliver(id, action, info) { pending.append((id, action, info)) }
      }
      completionHandler()
    }
  }
}

private extension String {
  var nonEmpty: String? { isEmpty ? nil : self }
}
