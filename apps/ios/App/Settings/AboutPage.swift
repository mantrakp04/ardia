import ArdiaDesign
import SwiftUI

struct AboutPage: View {
  var body: some View {
    Form {
      Section {
        VStack(spacing: Spacing.small) {
          AppIconPreview(side: 72)
            .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
          VStack(spacing: Spacing.hairline) {
            Text("Ardia")
              .font(.system(.title, design: .rounded, weight: .bold))
              .accessibilityAddTraits(.isHeader)
            Text(AppVersion.footer)
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
          }
        }
        .frame(maxWidth: .infinity)
        .listRowBackground(Color.clear)
      }

      Section {
        AboutLink("ardia.dev", systemImage: "globe", url: "https://ardia.dev")
        AboutLink("Release Notes", systemImage: "sparkles", url: "https://ardia.dev/release-notes")
        AboutLink("Source Code", systemImage: "chevron.left.forwardslash.chevron.right", url: "https://github.com/mantrakp04/ardia")
      } footer: {
        Text("Ardia has no accounts. Your tabs, history and sync key stay on your devices and in your own iCloud Drive.")
      }

      Section {
        NavigationLink(value: SettingsRoute.licenses) {
          Label("Open Source Licenses", systemImage: "doc.text")
        }
      }
    }
    .navigationTitle("About Ardia")
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct AboutLink: View {
  var title: LocalizedStringKey
  var systemImage: String
  var url: String

  init(_ title: LocalizedStringKey, systemImage: String, url: String) {
    self.title = title
    self.systemImage = systemImage
    self.url = url
  }

  var body: some View {
    if let destination = URL(string: url) {
      Link(destination: destination) {
        HStack {
          Label(title, systemImage: systemImage)
            .foregroundStyle(.primary)
          Spacer()
          Image(systemName: "arrow.up.forward")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
        }
      }
    }
  }
}

struct LicensesPage: View {
  var body: some View {
    Form {
      ForEach(OpenSourceCredit.all) { credit in
        Section {
          VStack(alignment: .leading, spacing: Spacing.hairline) {
            Text(verbatim: credit.name).font(.body.weight(.semibold))
            Text(credit.use).font(.subheadline).foregroundStyle(.secondary)
          }
          .padding(.vertical, 2)
          LabeledContent("License", value: credit.license)
          if let url = URL(string: credit.url) {
            Link(destination: url) {
              Text(verbatim: credit.displayURL)
                .lineLimit(1)
                .truncationMode(.middle)
            }
          }
        }
      }
    }
    .navigationTitle("Open Source Licenses")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct OpenSourceCredit: Identifiable {
  var name: String
  var use: String
  var license: String
  var url: String

  var id: String { name }
  var displayURL: String { url.replacingOccurrences(of: "https://", with: "") }

  static let all: [OpenSourceCredit] = [
    OpenSourceCredit(
      name: "Ardia",
      use: String(localized: "This app, and the Mac browser it syncs with."),
      license: "Apache License 2.0",
      url: "https://github.com/mantrakp04/ardia"
    ),
    OpenSourceCredit(
      name: "EasyList",
      use: String(localized: "The list behind Block Ads."),
      license: "CC BY-SA 3.0 or GPLv3",
      url: "https://easylist.to"
    ),
    OpenSourceCredit(
      name: "EasyPrivacy",
      use: String(localized: "The list behind Block Trackers."),
      license: "CC BY-SA 3.0 or GPLv3",
      url: "https://easylist.to"
    ),
    OpenSourceCredit(
      name: "Fanboy’s Cookie Monster List",
      use: String(localized: "The list behind Block Cookie Banners."),
      license: "CC BY-SA 3.0 or GPLv3",
      url: "https://secure.fanboy.co.nz"
    ),
  ]
}

#Preview("About") {
  NavigationStack {
    AboutPage()
      .navigationDestination(for: SettingsRoute.self) { $0.destination }
  }
}
