import ExpoModulesCore

struct OpenWindowOptions: Record {
  @Field var frame: CGRect?
  @Field var incognito: Bool = false
  @Field var title: String = ""
  @Field var focus: Bool = true
  @Field var kind: WindowKind = .browser
  @Field var profile: String?
  @Field var size: CGSize?
  @Field var behind: String?
  @Field var chromeWindow: String?
  @Field var claim: String?
  @Field var pointer: CGPoint?
  @Field var animated: Bool = false
}
