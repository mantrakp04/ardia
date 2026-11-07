import ArdiaDesign
import SwiftUI

struct OnboardingBlockingStep: View {
  var onContinue: () -> Void
  @Environment(AppModel.self) private var app

  var body: some View {
    @Bindable var blocking = app.blocking
    OnboardingPage(
      title: Text("Never see another \(Text.emphasized("ad"))."),
      subtitle: Text("Trackers and cookie banners too.")
    ) {
      VStack(spacing: 0) {
        BlockingToggleRow(title: "Block Ads", systemImage: "hand.raised.fill", tint: SettingsTint.ads, isOn: $blocking.blocksAds)
        Divider().padding(.leading, 58)
        BlockingToggleRow(title: "Block Trackers", systemImage: "eyeglasses", tint: SettingsTint.trackers, isOn: $blocking.blocksTrackers)
        Divider().padding(.leading, 58)
        BlockingToggleRow(title: "Block Cookie Banners", systemImage: "list.bullet.rectangle.portrait.fill", tint: SettingsTint.cookies, isOn: $blocking.hidesCookieBanners)
      }
      .padding(.vertical, Spacing.hairline)
      .dynamicTypeSize(...DynamicTypeSize.large)
      .background(.background.opacity(0.9), in: .rect(cornerRadius: Radius.card, style: .continuous))
      .shadow(color: .black.opacity(0.06), radius: 16, y: 6)
      .frame(maxHeight: .infinity, alignment: .bottom)
    } actions: {
      OnboardingPrimaryButton("Continue", action: onContinue)
    }
  }
}

private struct BlockingToggleRow: View {
  var title: LocalizedStringKey
  var systemImage: String
  var tint: Color
  @Binding var isOn: Bool

  var body: some View {
    Toggle(isOn: $isOn) {
      Label {
        Text(title)
      } icon: {
        SettingsIconTile(systemImage: systemImage, color: tint)
      }
    }
    .padding(.horizontal, Spacing.page)
    .frame(minHeight: 52)
  }
}

struct OnboardingDefaultBrowserStep: View {
  var onContinue: () -> Void
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    if dynamicTypeSize.isAccessibilitySize {
      ScrollView {
        DefaultBrowserInstructions(onLater: onContinue, onOpened: onContinue)
          .padding(Spacing.medium)
          .background(.background, in: .rect(cornerRadius: 38, style: .continuous))
          .padding(.horizontal, Spacing.tight)
          .padding(.top, Spacing.large)
      }
      .scrollBounceBehavior(.basedOnSize)
    } else {
      layout
    }
  }

  private var layout: some View {
    VStack(spacing: 0) {
      LinkBubbleIllustration()
        .dynamicTypeSize(...DynamicTypeSize.large)
        .frame(maxHeight: .infinity)
        .padding(.horizontal, Spacing.section)

      DefaultBrowserInstructions(onLater: onContinue, onOpened: onContinue)
        .padding(.horizontal, Spacing.medium + 4)
        .padding(.top, Spacing.section)
        .padding(.bottom, Spacing.small)
        .background {
          UnevenRoundedRectangle(topLeadingRadius: 38, topTrailingRadius: 38, style: .continuous)
            .fill(.background)
            .shadow(color: .black.opacity(0.08), radius: 20, y: -4)
            .ignoresSafeArea(edges: .bottom)
        }
    }
  }
}

private struct LinkBubbleIllustration: View {
  var body: some View {
    HStack(alignment: .bottom, spacing: Spacing.small) {
      VStack(alignment: .leading, spacing: 0) {
        LaunchGradient()
          .frame(height: 64)
        VStack(alignment: .leading, spacing: 2) {
          Text("The best tapas in Lisbon")
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
          Text(verbatim: "timeout.com")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Spacing.small)
        .padding(.vertical, Spacing.tight + 2)
      }
      .frame(width: 210)
      .background(Color(.secondarySystemBackground))
      .clipShape(.rect(cornerRadius: 18, style: .continuous))
      .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
      Image(systemName: "arrow.right")
        .font(.title3.weight(.bold))
        .foregroundStyle(Color.ardiaAccentText)
        .padding(.bottom, 26)
      AppIconPreview(side: 60)
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
        .padding(.bottom, 8)
    }
    .accessibilityHidden(true)
  }
}

struct OnboardingSyncStep: View {
  var onContinue: () -> Void
  @Environment(AppModel.self) private var app
  @State private var isConnecting = false

  var body: some View {
    let connected = SyncStatusWords(sync: app.sync).isConnected
    OnboardingPage(
      title: Text("Every tab, \(Text.emphasized("anywhere")).") ,
      subtitle: connected
        ? Text("Connected.")
        : Text("Your Mac’s tabs, right here. End-to-end encrypted.")
    ) {
      SyncScanIllustration(connected: connected)
    } actions: {
      if connected {
        OnboardingPrimaryButton("Continue", action: onContinue)
      } else {
        OnboardingPrimaryButton("Connect to Your Mac") { isConnecting = true }
        OnboardingSecondaryButton("Not Now", action: onContinue)
      }
    }
    .sheet(isPresented: $isConnecting) {
      SyncSetupView()
    }
    .animation(Motion.smooth, value: connected)
  }
}

struct OnboardingAllSetStep: View {
  var onFinish: () -> Void
  @State private var celebrations = 0

  var body: some View {
    OnboardingPage(
      title: Text("You’re all set!"),
      subtitle: Text("Happy browsing.")
    ) {
      VStack(alignment: .leading, spacing: Spacing.medium) {
        AllSetTip(symbol: "plus", text: "Tap + to search.")
        AllSetTip(symbol: "square.on.square", text: "Flick a tab up to close it.")
        AllSetTip(symbol: "hand.draw", text: "Swipe a page to go back.")
        AllSetTip(symbol: "archivebox", text: "Old tabs archive after a day.")
      }
      .padding(Spacing.medium)
      .background(.background.opacity(0.9), in: .rect(cornerRadius: Radius.card, style: .continuous))
      .shadow(color: .black.opacity(0.06), radius: 16, y: 6)
      .frame(maxHeight: .infinity, alignment: .bottom)
    } actions: {
      OnboardingPrimaryButton("Start Browsing") {
        celebrations += 1
        onFinish()
      }
    }
    .sensoryFeedback(.success, trigger: celebrations)
  }
}

private struct AllSetTip: View {
  var symbol: String
  var text: LocalizedStringKey
  @ScaledMetric(relativeTo: .body) private var width: CGFloat = 28

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: Spacing.small) {
      Image(systemName: symbol)
        .font(.body.weight(.semibold))
        .foregroundStyle(Color.ardiaAccentText)
        .frame(width: width)
        .accessibilityHidden(true)
      Text(text)
        .font(.subheadline)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
