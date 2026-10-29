import ExpoModulesCore

struct MenuItem: Record {
  @Field var separator: Bool = false
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var symbol: String?
  @Field var swatch: String?
  @Field var swatchDark: String?
  @Field var key: String = ""
  @Field var modifiers: [ModifierName] = []
  @Field var enabled: Bool = true
  @Field var checked: Bool = false
  @Field var alternate: Bool = false
  @Field var children: [MenuItem]?
  @Field var share: Bool = false
}
