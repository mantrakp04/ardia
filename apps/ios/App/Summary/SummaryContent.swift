import ArdiaDesign
import ArdiaIntelligence
import SwiftUI

struct SummaryContent: View {
  var summarizer: PageSummarizer?
  var unreadable: Bool
  var allowsQuestions = true
  var onRetry: () -> Void
  var onClose: () -> Void
  var onOpenExperiments: () -> Void = {}

  @Environment(\.openURL) private var openURL

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if unreadable {
            failure(.nothingToSummarize, message: String(localized: "This page couldn\u{2019}t be read. Try again once it finishes loading."))
          } else if let summarizer {
            summary(summarizer)
          } else {
            waiting
          }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollIndicators(.hidden)
      attributionBar
    }
  }

  @ViewBuilder private func summary(_ summarizer: PageSummarizer) -> some View {
    switch summarizer.phase {
    case .failed(let failure):
      self.failure(failure, message: failure.message)
    default:
      if summarizer.summary.isEmpty {
        waiting
      } else {
        SummaryBody(summary: summarizer.summary)
        if summarizer.phase == .done, allowsQuestions {
          AskAboutPage(summarizer: summarizer, onOpenExperiments: onOpenExperiments)
            .transition(.opacity)
        }
      }
    }
  }

  private var waiting: some View {
    Text(SummaryCopy.summarizing)
      .font(.footnote)
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity)
      .blurReveal(radius: 4)
  }

  private func failure(_ failure: SummaryFailure, message: String) -> some View {
    VStack(spacing: 8) {
      Text(failure.title)
        .font(.headline)
      Text(message)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      HStack {
        if failure.opensExperiments {
          Button("Open Settings", action: onOpenExperiments)
            .buttonStyle(.borderedProminent)
        } else if failure.offersSettingsLink {
          Button("Open Settings") {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
          }
          .buttonStyle(.bordered)
        } else {
          Button("Try Again", action: onRetry)
            .buttonStyle(.bordered)
        }
      }
      .tint(IntelligencePalette.ink)
      .padding(.top, 6)
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 8)
  }

  private var attributionBar: some View {
    HStack(spacing: 8) {
      ArdiaLogoMark(outline: false)
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
      Text(SummaryCopy.attribution)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(2)
      Spacer(minLength: 8)
      Button(action: onClose) {
        Image(systemName: "xmark")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.secondary)
          .frame(width: 28, height: 28)
          .background(.fill.tertiary, in: .circle)
          .frame(width: 44, height: 44)
          .contentShape(.circle)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Close Summary")
    }
    .padding(.leading, 20)
    .padding(.trailing, 8)
    .padding(.vertical, 4)
    .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    .background(.bar)
  }
}

struct SummaryBody: View {
  var summary: PageSummary

  @ScaledMetric(relativeTo: .subheadline) private var circle: CGFloat = 24
  @ScaledMetric(relativeTo: .subheadline) private var capHeight: CGFloat = 10.5

  var body: some View {
    let capHeight = capHeight
    VStack(alignment: .leading, spacing: 18) {
      if !summary.headline.isEmpty {
        Text(summary.headline)
          .font(.body)
          .fixedSize(horizontal: false, vertical: true)
          .blurReveal(radius: 8)
      }
      ForEach(summary.points.enumerated(), id: \.offset) { _, point in
        HStack(alignment: .firstTextBaseline, spacing: 12) {
          ZStack {
            Circle().fill(IntelligencePalette.symbolCircle)
            if !point.symbol.isEmpty {
              Image(systemName: point.symbol)
                .font(.system(size: circle * 0.48, weight: .semibold))
                .foregroundStyle(.white)
                .contentTransition(.symbolEffect(.replace))
            }
          }
          .frame(width: circle, height: circle)
          .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + capHeight / 2 }
          .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 4) {
            Text(point.label)
              .font(.subheadline.weight(.semibold))
            Text(point.text)
              .font(.subheadline)
              .foregroundStyle(.primary.opacity(0.82))
              .fixedSize(horizontal: false, vertical: true)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .blurReveal(radius: 8)
      }
    }
  }
}

struct AskAboutPage: View {
  let summarizer: PageSummarizer
  var onOpenExperiments: () -> Void = {}

  @State private var question = ""
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      ForEach(summarizer.exchanges) { exchange in
        VStack(alignment: .leading, spacing: 4) {
          Text(exchange.question)
            .font(.subheadline.weight(.semibold))
          Group {
            switch exchange.state {
            case .waiting:
              Text("Reading the page\u{2026}").foregroundStyle(.tertiary)
            case .answering where exchange.answer.isEmpty:
              Text("Reading the page\u{2026}").foregroundStyle(.tertiary)
            case .failed(let failure):
              Text(failure.message).foregroundStyle(.secondary)
            case .stopped where exchange.answer.isEmpty:
              Text("Stopped").foregroundStyle(.tertiary)
            default:
              Text(exchange.answer).foregroundStyle(.secondary)
            }
          }
          .font(.subheadline)
          .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
      }
      if summarizer.isEnabled {
        questionField
      } else {
        VStack(alignment: .leading, spacing: 8) {
          Text(SummaryFailure.featureOff.message)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
          Button("Open Settings", action: onOpenExperiments)
            .buttonStyle(.bordered)
            .tint(IntelligencePalette.ink)
        }
      }
    }
    .padding(.top, 8)
  }

  private var questionField: some View {
    HStack(spacing: 8) {
      TextField("Ask About This Page", text: $question)
        .font(.subheadline)
        .focused($focused)
        .submitLabel(.send)
        .onSubmit(send)
      if !question.isEmpty {
        Button(action: send) {
          Image(systemName: "arrow.up.circle.fill")
            .font(.title2)
            .foregroundStyle(IntelligencePalette.ink)
            .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ask")
        .transition(.opacity.combined(with: .scale(scale: 0.8)))
      }
    }
    .padding(.leading, 16)
    .padding(.trailing, 2)
    .frame(minHeight: 44)
    .background(IntelligencePalette.askField, in: .capsule)
    .animation(.spring(duration: 0.2, bounce: 0), value: question.isEmpty)
  }

  private func send() {
    let text = question
    question = ""
    summarizer.ask(question: text)
  }
}

#Preview("Summary") {
  let summarizer = Intelligence.demo().summarizer(
    for: PageText(
      url: URL(string: "https://www.nps.gov/jotr"), title: "Joshua Tree National Park", siteName: "NPS",
      paragraphs: Array(repeating: "Joshua Tree National Park is where two deserts meet, with rock formations and dark skies to explore.", count: 8)))
  SummaryContent(summarizer: summarizer, unreadable: false, onRetry: {}, onClose: {})
    .background(IntelligencePalette.pageBackground)
    .task { summarizer.summarize() }
}

#Preview("Unreadable") {
  SummaryContent(summarizer: nil, unreadable: true, onRetry: {}, onClose: {})
}
