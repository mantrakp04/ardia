import ArdiaBrowser
import ArdiaDesign
import ArdiaSync
import SwiftUI
import UIKit

struct SitePermissionsSection: View {
  @Environment(AppModel.self) private var app
  @State private var revokeTicks = 0

  var body: some View {
    let grants = app.preferences.permissionGrants
    Section {
      if grants.isEmpty {
        Text("None")
          .foregroundStyle(.secondary)
      }
      ForEach(grants) { grant in
        Menu {
          ForEach(grant.permissions) { permission in
            Button("Revoke \(permission.title)", systemImage: permission.symbol, role: .destructive) {
              revoke([permission], from: grant.host)
            }
          }
          if grant.permissions.count > 1 {
            Divider()
            Button("Revoke All", systemImage: "hand.raised.slash", role: .destructive) {
              revoke(Set(grant.permissions), from: grant.host)
            }
          }
        } label: {
          SitePermissionRow(grant: grant)
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
          Button("Revoke", role: .destructive) { revoke(Set(grant.permissions), from: grant.host) }
        }
        .accessibilityHint("Shows what you can revoke.")
      }
    } header: {
      Text("Camera, Microphone and Location")
        .scrolledIntoViewAtLaunch()
    } footer: {
      Text("Sites you allowed keep access on this \(ThisDevice.current.noun) until you revoke it. Private tabs always ask.")
    }
    .sensoryFeedback(.success, trigger: revokeTicks)
  }

  private func revoke(_ permissions: Set<SitePermission>, from host: String) {
    app.web.revoke(permissions, host: host)
    revokeTicks += 1
  }
}

private struct SitePermissionRow: View {
  let grant: SitePermissionGrant
  @ScaledMetric(relativeTo: .body) private var iconSize = 20

  var body: some View {
    HStack(spacing: Tokens.Space.l) {
      FaviconImage(iconURL: nil, pageURL: "https://\(grant.host)/", size: iconSize)
      VStack(alignment: .leading, spacing: Tokens.Space.xxs) {
        Text(grant.host)
          .foregroundStyle(.primary)
          .lineLimit(1)
          .truncationMode(.middle)
        Text(grant.permissions.map(\.title).formatted(.list(type: .and)))
          .typography(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
    .contentShape(.rect)
  }
}

#if DEBUG
private struct LaunchScrollToSection: UIViewRepresentable {
  static let isRequested = ProcessInfo.processInfo.arguments.contains("-ArdiaSitePermissions")

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    Task { @MainActor [weak view] in
      try? await Task.sleep(for: .milliseconds(900))
      var ancestor = view?.superview
      while let candidate = ancestor, !(candidate is UIScrollView) { ancestor = candidate.superview }
      guard let scroll = ancestor as? UIScrollView else { return }
      let end = scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom
      scroll.setContentOffset(CGPoint(x: 0, y: max(-scroll.adjustedContentInset.top, end)), animated: false)
    }
    return view
  }

  func updateUIView(_ uiView: UIView, context: Context) {}
}
#endif

private extension View {
  @ViewBuilder
  func scrolledIntoViewAtLaunch() -> some View {
    #if DEBUG
    if LaunchScrollToSection.isRequested {
      background { LaunchScrollToSection() }
    } else {
      self
    }
    #else
    self
    #endif
  }
}
