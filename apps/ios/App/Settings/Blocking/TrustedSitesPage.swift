import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct TrustedSitesPage: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let hosts = app.blocking.exemptHosts.sorted()
    Group {
      if hosts.isEmpty {
        ContentUnavailableView {
          Label("No Trusted Sites", systemImage: "checkmark.shield")
        } description: {
          Text("When you turn off blocking for a site from its page menu, it appears here.")
        }
      } else {
        List {
          Section {
            ForEach(hosts, id: \.self) { host in
              Label {
                Text(verbatim: host)
              } icon: {
                Image(systemName: "globe")
                  .foregroundStyle(.secondary)
              }
            }
            .onDelete { offsets in
              for index in offsets { app.blocking.setExempt(hosts[index], false) }
            }
          } footer: {
            Text("Ardia doesn’t block ads, trackers or cookie banners on these sites. Swipe left on a site to block on it again.")
          }
        }
        .toolbar { EditButton() }
      }
    }
    .navigationTitle("Trusted Sites")
    .navigationBarTitleDisplayMode(.inline)
    .animation(Motion.snappy, value: hosts)
  }
}

#Preview("Trusted Sites") {
  NavigationStack {
    TrustedSitesPage()
  }
  .environment(AppModel(isDemo: true))
}
