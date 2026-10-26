import ExpoModulesCore

enum PageEvents {
  static let channel = "onPageEvent"

  static func send(_ dispatcher: EventDispatcher, wanted: Set<String>, name: String, payload: [String: Any]) {
    guard wanted.contains(name) else { return }
    dispatcher(["name": name, "data": payload])
  }
}
