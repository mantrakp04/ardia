import ArdiaDesign
import ArdiaSync
import SwiftUI

struct AppearancePage: View {
  @Environment(AppModel.self) private var app
  @Environment(\.chromeLayout) private var layout
  @Environment(\.hingeState) private var hinge

  var body: some View {
    let syncIsOn = app.sync.isEnabled
    let shown = app.settings.appearanceChoices.shown(syncIsOn: syncIsOn)
    Form {
      Section {
        ColorChoiceRows()
      }

      Section {
        AppearanceChoiceList(
          options: InterfaceStyleChoice.allCases.filter { syncIsOn || $0 != .matchMac },
          selection: Binding(get: { shown.interfaceStyle }, set: { app.settings.interfaceStyleChoice = $0 }),
          title: \.title
        )
      } header: {
        Text("Interface Style")
      } footer: {
        Text(syncIsOn ? "Match My Mac follows your Mac. Reduce Transparency in iOS Settings always uses Classic." : "Reduce Transparency in iOS Settings always uses Classic.")
      }

      Section {
        AppearanceChoiceList(
          options: ColorSchemeChoice.allCases.filter { syncIsOn || $0 != .matchMac },
          selection: Binding(get: { shown.colorScheme }, set: { app.settings.colorSchemeChoice = $0 }),
          title: \.title
        )
      } header: {
        Text("Light or Dark")
      } footer: {
        if syncIsOn { Text("Match My Mac follows your Mac. System follows this device.") }
      }

      if SidebarPeek.offersEdgeSetting(layout: layout, hinge: hinge, isTablet: ThisDevice.current.isTablet) {
        Section {
          Toggle("Show Sidebar at Screen Edge", isOn: Binding(get: { app.settings.showsSidebarAtEdge }, set: { app.settings.showsSidebarAtEdge = $0 }))
        } header: {
          Text("Sidebar")
        } footer: {
          Text("When the sidebar is hidden, move the pointer to the edge or swipe in from it to show the sidebar.")
        }
      }
    }
    .contentMargins(.top, Tokens.Space.l, for: .scrollContent)
    .navigationTitle("Appearance")
    .navigationBarTitleDisplayMode(.inline)
    .animation(Motion.snappy, value: syncIsOn)
  }
}

private struct AppearanceChoiceList<Choice: Hashable>: View {
  var options: [Choice]
  @Binding var selection: Choice
  var title: KeyPath<Choice, LocalizedStringKey>

  var body: some View {
    ForEach(options, id: \.self) { option in
      Button {
        selection = option
      } label: {
        HStack {
          Text(option[keyPath: title])
            .foregroundStyle(Color.primary)
          Spacer()
          if option == selection {
            Image(systemName: "checkmark")
              .font(Typography.title)
              .foregroundStyle(Palette.formAccent)
              .accessibilityHidden(true)
          }
        }
        .contentShape(.rect)
      }
      .accessibilityAddTraits(option == selection ? .isSelected : [])
    }
  }
}

#Preview("Appearance") {
  NavigationStack {
    AppearancePage()
  }
  .environment(AppModel(isDemo: true))
}
