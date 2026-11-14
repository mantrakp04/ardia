import ArdiaDesign

extension WidgetExporter {
  func export(_ snapshot: SystemSnapshot, from app: AppModel) {
    guard let store = app.systemStore else { return }
    export(snapshot, into: store)
  }

  static func snapshot(for app: AppModel) -> SystemSnapshot {
    snapshot(sync: app.sync, colorChoice: app.settings.colorChoice)
  }
}
