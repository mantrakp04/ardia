import ExpoModulesCore

struct MenuEntry: Record, Equatable {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var current: Bool = false

  static func == (a: MenuEntry, b: MenuEntry) -> Bool { a.id == b.id && a.title == b.title && a.current == b.current }
}
