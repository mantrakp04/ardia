import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct MyFiltersEditor: View {
  @Environment(AppModel.self) private var app
  @State private var draft = ""
  @State private var isApplying = false
  @State private var applies = 0
  @State private var hasLoaded = false
  @FocusState private var isFocused: Bool

  var body: some View {
    let source = app.filterLists
    let hasChanges = hasLoaded && draft != source.myFilters
    TextEditor(text: $draft)
      .font(.callout.monospaced())
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .keyboardType(.asciiCapable)
      .focused($isFocused)
      .scrollContentBackground(.hidden)
      .padding(.horizontal, Spacing.small)
      .background(Color(.systemBackground))
      .overlay(alignment: .topLeading) {
        if draft.isEmpty {
          Text(verbatim: "||ads.example.com^\nexample.com##.newsletter-popup")
            .font(.callout.monospaced())
            .foregroundStyle(.tertiary)
            .padding(.horizontal, Spacing.small + 5)
            .padding(.top, Spacing.tight)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
      }
      .safeAreaInset(edge: .bottom, spacing: 0) {
        MyFiltersFooter(result: source.myFiltersResult, hasChanges: hasChanges)
      }
      .navigationTitle("My Filters")
      .navigationBarTitleDisplayMode(.inline)
      .navigationBarBackButtonHidden(hasChanges)
      .toolbar {
        if hasChanges {
          ToolbarItem(placement: .cancellationAction) {
            Button("Revert") { draft = source.myFilters }
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          if isApplying {
            ProgressView()
          } else {
            Button("Apply", role: .confirm) { apply() }
              .disabled(!hasChanges)
          }
        }
      }
      .onAppear {
        guard !hasLoaded else { return }
        draft = source.myFilters
        hasLoaded = true
      }
      .sensoryFeedback(.success, trigger: applies)
  }

  private func apply() {
    isApplying = true
    Task {
      _ = await app.filterLists.applyMyFilters(draft)
      isApplying = false
      isFocused = false
      applies += 1
    }
  }
}

private struct MyFiltersFooter: View {
  let result: MyFiltersResult
  let hasChanges: Bool
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    VStack(alignment: .leading, spacing: Spacing.hairline) {
      Text(summary)
        .font(.footnote.weight(.semibold))
        .foregroundStyle(hasChanges ? AnyShapeStyle(.ink(.orange)) : AnyShapeStyle(.secondary))
        .contentTransition(.opacity)
      if !dynamicTypeSize.isAccessibilitySize {
        Text("\(Text(verbatim: "||site.com^").monospaced()) blocks a site. \(Text(verbatim: "site.com##.ad").monospaced()) hides part of a page. Lines that start with ! are notes.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      if let docs = URL(string: "https://github.com/gorhill/uBlock/wiki/Static-filter-syntax") {
        Link("Filter Syntax", destination: docs)
          .font(.footnote.weight(.semibold))
      }
    }
    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, Spacing.page)
    .padding(.vertical, Spacing.small)
    .background(.bar)
  }

  private var summary: String {
    if hasChanges { return String(localized: "Changes aren’t applied yet") }
    if result.ruleCount == 0 && result.skippedCount == 0 { return String(localized: "No rules yet") }
    let rules = FilterListWords.rules(result.ruleCount)
    guard result.skippedCount > 0 else { return rules }
    return String(localized: "\(rules) · \(result.skippedCount.formatted()) skipped")
  }
}

#Preview("My Filters") {
  NavigationStack {
    MyFiltersEditor()
  }
  .environment(AppModel(isDemo: true))
}
