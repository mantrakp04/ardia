import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UIKit

struct ResearchView: View {
  let session: ResearchSession

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var readAloud: ReadAloud { session.readAloud }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: Spacing.large) {
          Text(session.query)
            .font(.title.weight(.bold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
          if !session.isFinished {
            status
          }
          if !chips.isEmpty {
            sourcesStrip
          }
          content
        }
        .padding(.horizontal, Spacing.medium)
        .padding(.top, Spacing.tight)
        .padding(.bottom, Spacing.section)
        .frame(maxWidth: 680, alignment: .leading)
        .frame(maxWidth: .infinity)
      }
      .scrollBounceBehavior(.basedOnSize)
      .safeAreaInset(edge: .bottom) {
        if session.phase == .done {
          listenBar
            .padding(.horizontal, Spacing.medium)
            .padding(.bottom, Spacing.tight)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
      }
      .animation(reduceMotion ? nil : Motion.smooth, value: session.phase)
      .background(Color(.systemBackground))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { moreMenu }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", role: .close) { dismiss() }
        }
      }
    }
    .overlay { simulatedScreenOff }
    .onAppear {
      readAloud.watch()
    }
    .onDisappear { session.cancel() }
  }

  private var moreMenu: some View {
    Menu {
      Button("Search the Web", systemImage: "magnifyingglass") { app.searchInsteadOfResearch(session.query) }
      if session.phase == .done {
        Button("Copy Answer", systemImage: "doc.on.doc") {
          UIPasteboard.general.string = ResearchAnswer.spoken(session.answer)
          app.toasts.show(Toast(String(localized: "Copied Answer"), symbol: "doc.on.doc"))
        }
      }
      if session.isFinished {
        Button("Browse Again", systemImage: "arrow.clockwise") { session.retry() }
      }
    } label: {
      Label("More", systemImage: "ellipsis")
    }
  }

  @ViewBuilder
  private var status: some View {
    HStack(spacing: Spacing.small) {
      ProgressView()
      Text(statusText)
        .font(.subheadline.weight(.medium))
        .foregroundStyle(.secondary)
        .contentTransition(.numericText())
    }
    .accessibilityElement(children: .combine)
  }

  private var statusText: String {
    switch session.phase {
    case .searching: String(localized: "Searching the web")
    case .reading(let done, let total): String(localized: "Reading \(min(done + 1, total)) of \(total) pages")
    case .writing: String(localized: "Writing your answer")
    case .done, .failed: ""
    }
  }

  private struct Chip: Identifiable {
    var id: String
    var number: Int?
    var url: URL
    var site: String
    var title: String
  }

  private var chips: [Chip] {
    if !session.sources.isEmpty {
      return session.sources.map { Chip(id: $0.url.absoluteString, number: $0.id, url: $0.url, site: $0.siteName, title: $0.title) }
    }
    return session.links.map { link in
      Chip(id: link.url.absoluteString, number: nil, url: link.url, site: link.url.host()?.replacingOccurrences(of: "www.", with: "") ?? "", title: link.title)
    }
  }

  private var sourcesStrip: some View {
    ScrollView(.horizontal) {
      HStack(spacing: Spacing.tight) {
        ForEach(chips) { chip in
          Button {
            app.openResearchSource(chip.url)
          } label: {
            chipLabel(chip)
          }
          .buttonStyle(.plain)
          .accessibilityLabel(Text("\(chip.site), \(chip.title)"))
        }
      }
      .scrollTargetLayout()
    }
    .scrollIndicators(.hidden)
    .scrollClipDisabled()
    .opacity(session.sources.isEmpty ? 0.6 : 1)
  }

  private func chipLabel(_ chip: Chip) -> some View {
    VStack(alignment: .leading, spacing: Spacing.hairline) {
      HStack(spacing: 6) {
        FaviconImage(iconURL: nil, pageURL: chip.url.absoluteString, size: 16)
        Text(chip.site)
          .font(.caption.weight(.semibold))
          .lineLimit(1)
        Spacer(minLength: 0)
        if let number = chip.number {
          Text("\(number)")
            .font(.caption2.weight(.bold).monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }
      Text(chip.title)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(2, reservesSpace: true)
        .multilineTextAlignment(.leading)
    }
    .padding(Spacing.small)
    .frame(width: 176, alignment: .leading)
    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14, style: .continuous))
  }

  @ViewBuilder
  private var content: some View {
    switch session.phase {
    case .failed(let message):
      VStack(alignment: .leading, spacing: Spacing.small) {
        Text(message)
          .font(.body)
          .foregroundStyle(.secondary)
        HStack(spacing: Spacing.tight) {
          Button("Try Again") { session.retry() }
            .buttonStyle(.glassProminent)
          Button("Search the Web") { app.searchInsteadOfResearch(session.query) }
            .buttonStyle(.glass)
        }
      }
    default:
      VStack(alignment: .leading, spacing: Spacing.small) {
        ForEach(Array(ResearchAnswer.blocks(session.answer).enumerated()), id: \.offset) { _, block in
          blockView(block)
        }
        if session.phase == .done, let writer = session.writer {
          writerNote(writer)
        }
      }
      .textSelection(.enabled)
    }
  }

  @ViewBuilder
  private func blockView(_ block: ResearchAnswer.Block) -> some View {
    switch block {
    case .heading(let text):
      Text(cited(text))
        .font(.title3.weight(.semibold))
        .padding(.top, Spacing.tight)
        .accessibilityAddTraits(.isHeader)
    case .bullet(let text):
      HStack(alignment: .firstTextBaseline, spacing: Spacing.tight) {
        Text(verbatim: "•")
          .foregroundStyle(.secondary)
        Text(cited(text))
          .fixedSize(horizontal: false, vertical: true)
      }
      .font(.body)
    case .paragraph(let text):
      Text(cited(text))
        .font(.body)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private func cited(_ text: String) -> AttributedString {
    var result = AttributedString()
    var cursor = text.startIndex
    for run in ResearchAnswer.citationRuns(in: text) {
      result += AttributedString(String(text[cursor..<run.range.lowerBound]))
      var numbers = AttributedString("\u{2009}" + run.numbers.map(String.init).joined(separator: ","))
      numbers.font = .caption.weight(.semibold).monospacedDigit()
      numbers.foregroundColor = .secondary
      numbers.baselineOffset = 4
      result += numbers
      cursor = run.range.upperBound
    }
    result += AttributedString(String(text[cursor...]))
    return result
  }

  @ViewBuilder
  private func writerNote(_ writer: ResearchSession.Writer) -> some View {
    let note: String = switch writer {
    case .onDevice: String(localized: "Written on this iPhone by Apple Intelligence from the pages above. Check them for anything important.")
    case .excerpts(let reason): reason
    }
    Label(note, systemImage: writer == .onDevice ? "apple.intelligence" : "text.quote")
      .font(.footnote)
      .foregroundStyle(.secondary)
      .padding(.top, Spacing.small)
  }

  private var listenBar: some View {
    let listening = readAloud.listening
    return HStack(spacing: Spacing.small) {
      Image(systemName: listening.output == .earpiece ? "ear.fill" : "ear")
        .font(.title3)
        .symbolEffect(.variableColor.iterative, isActive: listening.isPlaying && listening.output == .earpiece && !reduceMotion)
        .frame(width: 28)
        .accessibilityHidden(true)
      Text(listenText(listening))
        .font(.subheadline.weight(.medium))
        .lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button {
        readAloud.toggleSpeaker()
      } label: {
        Image(systemName: listening.isPlaying && listening.output == .speaker ? "pause.fill" : "speaker.wave.2.fill")
          .font(.body.weight(.semibold))
          .frame(width: 44, height: 44)
          .contentShape(.circle)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(listening.isPlaying && listening.output == .speaker ? Text("Pause") : Text("Play Out Loud"))
    }
    .padding(.leading, Spacing.page)
    .padding(.trailing, Spacing.hairline)
    .padding(.vertical, Spacing.hairline)
    .background(alignment: .bottomLeading) {
      GeometryReader { proxy in
        Capsule()
          .fill(.tint.opacity(0.18))
          .frame(width: proxy.size.width * readAloud.spokenFraction)
          .animation(.linear(duration: 0.25), value: readAloud.spokenFraction)
      }
      .clipShape(.capsule)
    }
    .glassEffect(.regular, in: .capsule)
  }

  private func listenText(_ listening: EarListening) -> String {
    switch listening.state {
    case .waiting: String(localized: "Hold your iPhone to your ear to listen")
    case .playing(.earpiece): String(localized: "Reading at your ear")
    case .playing(.speaker): String(localized: "Reading out loud")
    case .paused(.earpiece): String(localized: "Paused. Hold it to your ear to keep listening")
    case .paused(.speaker): String(localized: "Paused")
    case .finished: String(localized: "Hold it to your ear to hear it again")
    }
  }

  @ViewBuilder
  private var simulatedScreenOff: some View {
    #if targetEnvironment(simulator)
    if readAloud.isNear {
      Color.black
        .ignoresSafeArea()
        .overlay(alignment: .bottom) {
          Text(verbatim: "Proximity: near")
            .font(.caption.monospaced())
            .foregroundStyle(.white.opacity(0.5))
            .padding(.bottom, Spacing.section)
        }
        .allowsHitTesting(false)
    }
    #endif
  }
}
