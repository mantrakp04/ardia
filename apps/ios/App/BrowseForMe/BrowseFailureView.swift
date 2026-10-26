import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct BrowseFailureView: View {
  var failure: BrowseFailure
  var onRetry: () -> Void
  var onOpenSettings: () -> Void
  var onOpenExperiments: () -> Void

  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    if failure.showsSources {
      card
    } else {
      centered
    }
  }

  private var centered: some View {
    VStack(spacing: 10) {
      Image(systemName: symbol)
        .font(.largeTitle.weight(.semibold))
        .foregroundStyle(IntelligencePalette.ink)
        .padding(.bottom, 6)
        .accessibilityHidden(true)
      Text(failure.title)
        .font(.title2.weight(.bold))
        .fontDesign(.rounded)
        .multilineTextAlignment(.center)
      Text(failure.message)
        .font(.body)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      buttons
        .controlSize(.large)
        .padding(.top, 10)
    }
    .padding(.horizontal, Spacing.section)
    .frame(maxWidth: .infinity)
    .padding(.vertical, typeSize.isAccessibilitySize ? 24 : 0)
    .containerRelativeFrame(.vertical, alignment: .center) { height, _ in
      typeSize.isAccessibilitySize ? height : height * 0.62
    }
    .accessibilityElement(children: .contain)
  }

  private var card: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label {
        Text(failure.title)
      } icon: {
        Image(systemName: symbol)
          .foregroundStyle(IntelligencePalette.ink)
      }
      .font(.headline)
      Text(failure.message)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      buttons
        .padding(.top, 6)
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(IntelligencePalette.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
  }

  @ViewBuilder private var buttons: some View {
    if failure.canRetry || failure.offersSettingsLink || failure.opensExperiments {
      HStack(spacing: 10) {
        if failure.canRetry {
          Button("Try Again", action: onRetry)
        }
        if failure.offersSettingsLink {
          Button("Open Settings", action: onOpenSettings)
        }
        if failure.opensExperiments {
          Button("Open Settings", action: onOpenExperiments)
        }
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.capsule)
      .tint(IntelligencePalette.ink)
    }
  }

  private var symbol: String {
    switch failure {
    case .offline: "wifi.slash"
    case .noResults: "magnifyingglass"
    case .modelUnavailable(.modelDownloading): "arrow.down.circle"
    case .modelUnavailable: "apple.intelligence"
    case .guardrail: "hand.raised"
    case .featureOff: "flask"
    default: "exclamationmark.circle"
    }
  }
}
