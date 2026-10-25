import ArdiaBrowser
import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct SummaryView: View {
  let tabID: UUID
  var onClose: (() -> Void)?

  @Environment(AppModel.self) private var app
  @State private var summarizer: PageSummarizer?
  @State private var unreadable = false
  @State private var completions = 0

  init(tabID: UUID, onClose: (() -> Void)? = nil) {
    self.tabID = tabID
    self.onClose = onClose
  }

  var body: some View {
    SummaryContent(
      summarizer: summarizer,
      unreadable: unreadable,
      allowsQuestions: app.settings.isAskAboutPageOn,
      onRetry: { Task { await load(forceFresh: true) } },
      onClose: close,
      onOpenExperiments: { app.openSettings(at: .experiments) })
    .task(id: tabID) { await load(forceFresh: false) }
    .onChange(of: summarizer?.phase) { previous, phase in
      guard phase == .done, let previous, previous.isWorking else { return }
      completions += 1
    }
    .sensoryFeedback(.success, trigger: completions)
  }

  private func load(forceFresh: Bool) async {
    app.intelligence.summaryWillOpen()
    unreadable = false
    if !forceFresh, let existing = app.intelligence.existingSummarizer(forTab: tabID) {
      summarizer = existing
      if existing.phase == .idle || existing.phase == .cancelled { existing.summarize() }
      return
    }
    guard let webTab = app.web.webTab(for: tabID), let content = try? await webTab.readableContent() else {
      unreadable = true
      return
    }
    let page = PageText(
      url: URL(string: content.url), title: content.title, siteName: content.siteName, paragraphs: content.paragraphs,
      language: content.language)
    let created = app.intelligence.summarizer(forTab: tabID, page: page)
    summarizer = created
    if forceFresh || created.phase == .idle || created.phase == .cancelled { created.summarize() }
  }

  private func close() {
    if let onClose {
      onClose()
    } else {
      app.browse.summaryTabID = nil
    }
  }
}

private extension PageSummarizer.Phase {
  var isWorking: Bool {
    switch self {
    case .reading, .writing: true
    case .idle, .done, .failed, .cancelled: false
    }
  }
}
