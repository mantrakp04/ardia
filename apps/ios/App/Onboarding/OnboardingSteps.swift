import ArdiaDesign
import SwiftUI

struct OnboardingBlockingStep: View {
  var onContinue: () -> Void
  @Environment(AppModel.self) private var app

  var body: some View {
    @Bindable var blocking = app.blocking
    OnboardingPage(
      title: Text("Never see another \(Text.emphasized("ad"))."),
      subtitle: Text("Trackers and cookie banners too."),
      illustrationAlignment: .bottom
    ) {
      VStack(spacing: 0) {
        BlockingToggleRow(title: "Block Ads", systemImage: "hand.raised.fill", tint: SettingsTint.ads, isOn: $blocking.blocksAds)
        Divider().padding(.leading, BlockingToggleRow.dividerInset)
        BlockingToggleRow(title: "Block Trackers", systemImage: "eyeglasses", tint: SettingsTint.trackers, isOn: $blocking.blocksTrackers)
        Divider().padding(.leading, BlockingToggleRow.dividerInset)
        BlockingToggleRow(title: "Block Cookie Banners", systemImage: "list.bullet.rectangle.portrait.fill", tint: SettingsTint.cookies, isOn: $blocking.hidesCookieBanners)
      }
      .padding(.vertical, Tokens.Space.xs)
      .dynamicTypeSize(...DynamicTypeSize.large)
      .background(.background.opacity(0.9), in: .rect(cornerRadius: Tokens.Radius.hero, style: .continuous))
      .shadow(Tokens.Shadow.card)
    } actions: {
      OnboardingPrimaryButton("Continue", action: onContinue)
    }
  }
}

private struct BlockingToggleRow: View {
  static let dividerInset = Tokens.Space.xl + SettingsTile.side + Tokens.Space.l
  static let height: CGFloat = 52

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
    .padding(.horizontal, Tokens.Space.xl)
    .frame(minHeight: Self.height)
  }
}

struct OnboardingDefaultBrowserStep: View {
  var onContinue: () -> Void
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.onboardingFrame) private var frame

  var body: some View {
    switch frame.composition {
    case .stacked:
      if dynamicTypeSize.isAccessibilitySize {
        ScrollView {
          instructions
            .padding(Tokens.Space.xxl)
            .background(.background, in: .rect(cornerRadius: MenuLayout.sheetRadius, style: .continuous))
            .padding(.horizontal, Tokens.Space.m)
            .padding(.top, Tokens.Space.xxxl)
        }
        .scrollBounceBehavior(.basedOnSize)
      } else {
        layout
      }
    case .column, .sideBySide:
      ComposedPage {
        LinkBubbleIllustration()
          .dynamicTypeSize(...DynamicTypeSize.large)
      } content: {
        instructions
          .padding(Tokens.Space.xxl)
          .background(.background, in: .rect(cornerRadius: Tokens.Radius.hero, style: .continuous))
          .shadow(Tokens.Shadow.card)
      }
    }
  }

  private var instructions: some View {
    DefaultBrowserInstructions(onLater: onContinue, onOpened: onContinue)
  }

  private var layout: some View {
    VStack(spacing: 0) {
      LinkBubbleIllustration()
        .dynamicTypeSize(...DynamicTypeSize.large)
        .frame(maxHeight: .infinity)
        .padding(.horizontal, Tokens.Space.huge)

      instructions
        .padding(.horizontal, Tokens.Space.xxl + Tokens.Space.xs)
        .padding(.top, Tokens.Space.huge)
        .padding(.bottom, Tokens.Space.l)
        .background {
          UnevenRoundedRectangle(topLeadingRadius: MenuLayout.sheetRadius, topTrailingRadius: MenuLayout.sheetRadius, style: .continuous)
            .fill(.background)
            .shadow(Tokens.Shadow.sheet)
            .ignoresSafeArea(edges: .bottom)
        }
    }
  }
}

private struct LinkBubbleIllustration: View {
  var body: some View {
    HStack(alignment: .bottom, spacing: Tokens.Space.l) {
      VStack(alignment: .leading, spacing: 0) {
        Rectangle()
          .fill(ProfileLook.plum.swatchColor.gradient)
          .frame(height: 64)
        VStack(alignment: .leading, spacing: 2) {
          Text("The best tapas in Lisbon")
            .font(Typography.row.weight(.semibold))
            .lineLimit(1)
          Text(verbatim: "timeout.com")
            .font(Typography.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Tokens.Space.l)
        .padding(.vertical, Tokens.Space.ml)
      }
      .frame(width: 210)
      .background(Color(.secondarySystemBackground))
      .clipShape(.rect(cornerRadius: Tokens.Radius.hero, style: .continuous))
      .shadow(Tokens.Shadow.card)
      Image(systemName: "arrow.right")
        .font(Typography.title.weight(.bold))
        .foregroundStyle(Color.ardiaAccentText)
        .padding(.bottom, 26)
      AppIconPreview(side: 60)
        .shadow(Tokens.Shadow.tooltip)
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
      subtitle: Text("Happy browsing."),
      illustrationAlignment: .bottom
    ) {
      VStack(alignment: .leading, spacing: Tokens.Space.xxl) {
        AllSetTip(symbol: "plus", text: "Tap + to search.")
        AllSetTip(symbol: "square.on.square", text: "Flick a tab up to close it.")
        AllSetTip(symbol: "hand.draw", text: "Swipe a page to go back.")
        AllSetTip(symbol: "archivebox", text: "Old tabs archive after a day.")
      }
      .padding(Tokens.Space.xxl)
      .background(.background.opacity(0.9), in: .rect(cornerRadius: Tokens.Radius.hero, style: .continuous))
      .shadow(Tokens.Shadow.card)
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
    HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.l) {
      Image(systemName: symbol)
        .font(Typography.title)
        .foregroundStyle(Color.ardiaAccentText)
        .frame(width: width)
        .accessibilityHidden(true)
      Text(text)
        .font(Typography.row)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
