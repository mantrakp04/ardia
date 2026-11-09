import ExpoModulesCore

struct NotificationOptions: Record {
  @Field var id: String?
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var subtitle: String?
  @Field var silent: Bool = false
  @Field var icon: String?
  @Field var tabId: String?
  @Field var windowId: String?
  @Field var origin: String?
  @Field var dismissible: Bool = false
  @Field var data: [String: Any]?
}
