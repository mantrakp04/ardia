import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct ReaderView: View {
  enum Theme: String, CaseIterable, Identifiable {
    case light
    case sepia
    case dark

    var id: String { rawValue }

    var title: LocalizedStringKey {
      switch self {
      case .light: "Light"
      case .sepia: "Sepia"
      case .dark: "Dark"
      }
    }

    var background: Color {
      switch self {
      case .light: .white
      case .sepia: Color(hex: 0xF8F1E3)
      case .dark: Color(hex: 0x121214)
      }
    }

    var ink: Color {
      switch self {
      case .light: Color(hex: 0x1C1C1E)
      case .sepia: Color(hex: 0x4F321C)
      case .dark: Color(hex: 0xE3E3E6)
      }
    }

    var secondary: Color { ink.opacity(0.6) }
  }

  static let sizeSteps: [CGFloat] = [0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6]

  let tabID: UUID

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.colorScheme) private var systemScheme
  @AppStorage("reader.sizeStep") private var sizeStep = 2
  @AppStorage("reader.serif") private var serif = true
  @AppStorage("reader.theme") private var storedTheme = ""
  @ScaledMetric(relativeTo: .body) private var baseSize: CGFloat = 19
  @State private var content: ReadableContent?
  @State private var failed = false

  private var theme: Theme {
    Theme(rawValue: storedTheme) ?? (systemScheme == .dark ? .dark : .light)
  }

  private var bodySize: CGFloat {
    baseSize * Self.sizeSteps[min(max(sizeStep, 0), Self.sizeSteps.count - 1)]
  }

  var body: some View {
    NavigationStack {
      ZStack {
        theme.background.ignoresSafeArea()
        if let content {
          article(content)
        } else if failed {
          ContentUnavailableView("Reader Unavailable", systemImage: "doc.plaintext", description: Text("This page doesn’t have an article Ardia can show in Reader."))
        } else {
          ProgressView()
        }
      }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        if content != nil {
          ToolbarItem(placement: .topBarLeading) {
            appearanceMenu
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", role: .close) { dismiss() }
        }
      }
      .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
    }
    .environment(\.colorScheme, theme == .dark ? .dark : .light)
    .task { await load() }
  }

  private var appearanceMenu: some View {
    Menu {
      ControlGroup {
        Button("Smaller Text", systemImage: "textformat.size.smaller") { sizeStep = max(sizeStep - 1, 0) }
          .disabled(sizeStep == 0)
        Button("Larger Text", systemImage: "textformat.size.larger") { sizeStep = min(sizeStep + 1, Self.sizeSteps.count - 1) }
          .disabled(sizeStep == Self.sizeSteps.count - 1)
      }
      .controlGroupStyle(.compactMenu)
      Picker("Font", selection: $serif) {
        Text("New York").tag(true)
        Text("San Francisco").tag(false)
      }
      Picker("Theme", selection: Binding(get: { theme }, set: { storedTheme = $0.rawValue })) {
        ForEach(Theme.allCases) { Text($0.title).tag($0) }
      }
    } label: {
      Label("Text Appearance", systemImage: "textformat.size")
    }
    .menuActionDismissBehavior(.disabled)
  }

  private func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: serif ? .serif : .default)
  }

  private func article(_ content: ReadableContent) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        header(content)
        if let lead = content.leadImage.flatMap(URL.init(string:)) {
          AsyncImage(url: lead) { phase in
            if let image = phase.image {
              image
                .resizable()
                .scaledToFit()
                .clipShape(.rect(cornerRadius: 10, style: .continuous))
                .padding(.bottom, bodySize)
            }
          }
          .accessibilityHidden(true)
        }
        ForEach(content.paragraphs.enumerated(), id: \.offset) { _, paragraph in
          Text(paragraph)
            .font(font(bodySize))
            .lineSpacing(bodySize * 0.32)
            .foregroundStyle(theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, bodySize * 0.9)
        }
        Text("Reader")
          .font(.footnote.smallCaps())
          .foregroundStyle(theme.secondary)
          .padding(.top, Spacing.large)
      }
      .textSelection(.enabled)
      .frame(maxWidth: 680, alignment: .leading)
      .padding(.horizontal, Spacing.medium)
      .padding(.top, Spacing.tight)
      .padding(.bottom, Spacing.section)
      .frame(maxWidth: .infinity)
    }
    .animation(.snappy(duration: 0.2), value: sizeStep)
  }

  private func header(_ content: ReadableContent) -> some View {
    VStack(alignment: .leading, spacing: Spacing.tight) {
      let source = [content.siteName, content.byline ?? ""].filter { !$0.isEmpty }
      if !source.isEmpty {
        Text(source.formatted(.list(type: .and, width: .narrow)))
          .font(.subheadline.smallCaps())
          .foregroundStyle(theme.secondary)
      }
      Text(content.title)
        .font(font(bodySize * 1.55, weight: .bold))
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      if content.wordCount > 0 {
        let minutes = max(1, Int((Double(content.wordCount) / 230).rounded()))
        Text("\(Duration.seconds(minutes * 60).formatted(.units(allowed: [.minutes], width: .abbreviated))) read")
          .font(.subheadline)
          .foregroundStyle(theme.secondary)
      }
    }
    .padding(.bottom, bodySize * 1.2)
  }

  private func load() async {
    guard let page = app.web.existingWebTab(tabID) else {
      failed = true
      return
    }
    do {
      let loaded = try await page.readableContent()
      if loaded.paragraphs.isEmpty { failed = true } else { content = loaded }
    } catch {
      failed = true
    }
  }
}

struct ActivitySheet: UIViewControllerRepresentable {
  let url: URL

  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: [url], applicationActivities: nil)
  }

  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension URL: @retroactive Identifiable {
  public var id: String { absoluteString }
}
