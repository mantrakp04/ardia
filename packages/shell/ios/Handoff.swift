import AppKit

public enum Handoff {
  private static var urls: [String: URL] = [:]

  static func setActivity(windowId: String, url: String?, title: String?) {
    guard let window = WindowManager.shared.windows[windowId] else { return }
    guard let url = url.flatMap(URL.init(string:)), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
      urls[windowId] = nil
      window.userActivity?.invalidate()
      window.userActivity = nil
      return
    }
    if urls[windowId] == url, let activity = window.userActivity {
      activity.title = title
      return
    }
    urls[windowId] = url
    window.userActivity?.invalidate()
    let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
    activity.webpageURL = url
    activity.title = title
    activity.isEligibleForHandoff = true
    window.userActivity = activity
    if window.isKeyWindow { activity.becomeCurrent() }
  }

  public static func `continue`(_ activity: NSUserActivity) -> Bool {
    guard activity.activityType == NSUserActivityTypeBrowsingWeb, let url = activity.webpageURL else { return false }
    OpenURLInbox.receive([url])
    return true
  }
}
