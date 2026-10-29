import AppIntents

struct ProfileEntity: AppEntity {
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Profile"
  static let defaultQuery = ProfileQuery()

  let id: String
  let name: String

  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

  static var all: [ProfileEntity] { ShellScripting.state.profiles.map { ProfileEntity(id: $0.id, name: $0.name) } }
}
