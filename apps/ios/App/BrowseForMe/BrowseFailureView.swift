import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct BrowseFailureView: View {
  var failure: BrowseFailure
  var onRetry: () -> Void
  var onOpenSettings: () -> Void
  var onOpenExperiments: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Image(systemName: symbol)
        .font(.title2.weight(.semibold))
        .foregroundStyle(IntelligencePalette.ink)
        .accessibilityHidden(true)
      Text(failure.title)
        .font(.title3.weight(.bold))
      Text(failure.message)
        .font(.body)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 10) {
        if failure.canRetry {
          Button("Try Again", action: onRetry)
            .buttonStyle(.borderedProminent)
        }
        if failure.offersSettingsLink {
          Button("Open Settings", action: onOpenSettings)
            .buttonStyle(.bordered)
        }
        if failure.opensExperiments {
          Button("Open Settings", action: onOpenExperiments)
            .buttonStyle(.borderedProminent)
        }
      }
      .tint(IntelligencePalette.ink)
      .controlSize(.large)
      .padding(.top, 4)
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(IntelligencePalette.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
  }

  private var symbol: String {
    switch failure {
    case .offline: "wifi.slash"
    case .noResults: "magnifyingglass"
    case .modelUnavailable: "sparkles"
    case .guardrail: "hand.raised"
    case .featureOff: "flask"
    default: "exclamationmark.circle"
    }
  }
}
