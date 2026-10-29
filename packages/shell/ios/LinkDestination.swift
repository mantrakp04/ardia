import AppIntents

enum LinkDestination: String, AppEnum {
  case tab
  case littleArdia

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Destination"
  static let caseDisplayRepresentations: [LinkDestination: DisplayRepresentation] = [
    .tab: "A Tab",
    .littleArdia: "Little Ardia",
  ]
}
