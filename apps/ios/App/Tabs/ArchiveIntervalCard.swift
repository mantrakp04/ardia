import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct ArchiveIntervalCard: View {
  @Binding var interval: AutoArchiveInterval
  let dismiss: () -> Void
  @ScaledMetric(relativeTo: .subheadline) private var textSize: CGFloat = 14

  var body: some View {
    HStack(spacing: 4) {
      Text("Archive inactive tabs")
        .font(.system(size: textSize))
        .foregroundStyle(TabsPalette.headerText)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, alignment: .leading)
      Menu {
        Picker("Archive inactive tabs", selection: $interval) {
          ForEach(AutoArchiveInterval.allCases) { option in
            Text(option.title).tag(option)
          }
        }
      } label: {
        HStack(spacing: 3) {
          Text(interval.title)
            .font(.system(size: textSize))
          Image(systemName: "chevron.up.chevron.down")
            .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(Palette.formAccent)
        .frame(minHeight: 36)
        .contentShape(.rect)
      }
      .fixedSize()
      .accessibilityLabel("Archive inactive tabs, \(interval.title)")
      Button(action: dismiss) {
        Image(systemName: "xmark")
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(.secondary)
          .frame(width: 36, height: 36)
          .contentShape(.circle)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Dismiss")
    }
    .padding(.leading, 16)
    .padding(.trailing, 8)
    .frame(maxWidth: 560, minHeight: TabsLayout.archiveCardHeight)
    .chromeSurface(in: .capsule, interactive: false)
    .onChange(of: interval) {
      Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(600))
        dismiss()
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityAction(named: "Dismiss", dismiss)
  }
}
