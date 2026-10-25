import ArdiaDesign
import SwiftUI

struct DefaultBrowserPage: View {
  var body: some View {
    ScrollView {
      DefaultBrowserInstructions()
        .padding(.horizontal, Spacing.page + 4)
        .padding(.top, Spacing.large)
        .padding(.bottom, Spacing.section)
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Default Browser")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct DefaultBrowserInstructions: View {
  var onLater: (() -> Void)?
  var onOpened: (() -> Void)?

  @Environment(\.openURL) private var openURL
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    VStack(spacing: Spacing.large) {
      VStack(spacing: Spacing.small) {
        Text("How to change your default browser")
          .font(.system(.title, design: .rounded, weight: .bold))
          .foregroundStyle(Color.ardiaTitle)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        Text("Set Ardia as your default to automatically open links from other apps.")
          .font(.body)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
      }

      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: Spacing.small) {
          Text("1. Open Ardia in Settings")
          Text("2. Tap on “Default Browser App”")
          Text("3. Select Ardia")
        }
        .font(.body)
        .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        stepsCard
      }

      VStack(spacing: Spacing.small) {
        Button {
          onOpened?()
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
          Text("Open Ardia in Settings")
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.roundedRectangle(radius: 14))
        .tint(Palette.indigo)

        if let onLater {
          Button("Maybe Later", action: onLater)
            .font(.body.weight(.semibold))
            .foregroundStyle(Color.ardiaTitle)
            .frame(minHeight: 44)
        }
      }
    }
  }

  private var stepsCard: some View {
    VStack(spacing: 0) {
      DefaultBrowserStep(number: 1, text: Text("Open Ardia in Settings")) {
        Image(systemName: "gear")
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(.white)
          .frame(width: 29, height: 29)
          .background(Color.gray.gradient, in: .rect(cornerRadius: 7, style: .continuous))
      }
      Divider().padding(.leading, 56)
      DefaultBrowserStep(number: 2, text: Text("Tap on “Default Browser App”")) {
        Image(systemName: "hand.point.up.left.fill")
          .font(.system(size: 18))
          .foregroundStyle(.secondary)
          .frame(width: 29, height: 29)
      }
      Divider().padding(.leading, 56)
      DefaultBrowserStep(number: 3, text: Text("Select Ardia")) {
        AppIconPreview()
      }
    }
    .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: Radius.field, style: .continuous))
  }
}

private struct DefaultBrowserStep<Icon: View>: View {
  var number: Int
  var text: Text
  @ViewBuilder var icon: Icon

  var body: some View {
    HStack(spacing: Spacing.small + 3) {
      icon
        .frame(minWidth: 29)
      Text("\(number.formatted()). \(text)")
    }
    .font(.body)
    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, Spacing.hairline)
    .accessibilityElement(children: .combine)
  }
}

#Preview("Default Browser") {
  NavigationStack {
    DefaultBrowserPage()
  }
}
