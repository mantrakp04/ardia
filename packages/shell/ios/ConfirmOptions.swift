import ExpoModulesCore

struct ConfirmOptions: Record {
  @Field var title: String = ""
  @Field var message: String = ""
  @Field var confirmTitle: String = "OK"
  @Field var cancelTitle: String = "Cancel"
  @Field var destructive: Bool = false
  @Field var suppression: String?
  @Field var windowId: String?
}
