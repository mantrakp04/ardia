import ExpoModulesCore

struct PromptOptions: Record {
  @Field var title: String = ""
  @Field var message: String = ""
  @Field var value: String = ""
  @Field var placeholder: String?
  @Field var confirmTitle: String = "OK"
  @Field var windowId: String?
}
