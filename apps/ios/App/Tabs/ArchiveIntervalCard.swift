import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct ArchiveIntervalCard: View {
  @Binding var interval: AutoArchiveInterval
  let dismiss: () -> Void
  @ScaledMetric(relativeTo: .body) private var tileSide = TabsLayout.archiveCardTile

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) {
        title.fixedSize()
        Spacer(minLength: 4)
        picker.fixedSize()
      }
      VStack(alignment: .leading, spacing: 4) {
        title
        picker
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.leading, 14)
    .padding(.trailing, 4)
    .padding(.vertical, 14)
    .frame(maxWidth: 520)
    .background(BrowsePalette.popover, in: .rect(cornerRadius: TabsLayout.archiveCardRadius, style: .continuous))
    .shadow(color: TabsPalette.cardShadow, radius: 24, y: 8)
    .onChange(of: interval) {
      Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(600))
        dismiss()
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityAction(named: "Dismiss", dismiss)
  }

  private var title: some View {
    HStack(spacing: 12) {
      Image(systemName: "archivebox.fill")
        .font(.system(size: min(tileSide, 48) * 0.5, weight: .semibold))
        .foregroundStyle(.white)
        .frame(width: min(tileSide, 48), height: min(tileSide, 48))
        .background(TabsPalette.archiveTile.gradient, in: .rect(cornerRadius: min(tileSide, 48) * 0.25, style: .continuous))
      Text("Archive Inactive Tabs")
        .font(.body)
        .foregroundStyle(.primary)
    }
  }

  private var picker: some View {
    Picker("Archive Inactive Tabs", selection: $interval) {
      ForEach(AutoArchiveInterval.allCases) { option in
        Text(option.title).tag(option)
      }
    }
    .pickerStyle(.menu)
    .labelsHidden()
    .tint(.secondary)
  }
}
