import ArdiaBrowser
import ArdiaDesign
import SwiftUI
import UniformTypeIdentifiers

struct DownloadRow: View {
  let item: DownloadItem
  let fileExists: Bool
  let open: () -> Void
  let cancel: () -> Void
  let retry: () -> Void
  @ScaledMetric(relativeTo: .body) private var iconSize = 28
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    HStack(alignment: .center, spacing: Tokens.Space.l) {
      if canOpen {
        Button(action: open) { summary }
          .buttonStyle(.plain)
          .accessibilityHint("Opens the file.")
      } else {
        summary
      }
      trailingAction
    }
    .padding(.vertical, Tokens.Space.xs)
    .accessibilityElement(children: .contain)
  }

  private var canOpen: Bool { item.state == .finished && fileExists }

  private var summary: some View {
    HStack(alignment: .center, spacing: Tokens.Space.l) {
      Image(systemName: DownloadWords.symbol(for: item.fileName))
        .font(.system(size: iconSize * 0.75))
        .foregroundStyle(canOpen || item.isRunning ? Tokens.Role.icon : Tokens.Role.iconDisabled)
        .frame(width: iconSize, height: iconSize)
      VStack(alignment: .leading, spacing: Tokens.Space.xs) {
        Text(item.fileName.isEmpty ? String(localized: "Download") : item.fileName)
          .typography(.body)
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
          .truncationMode(.middle)
        if item.isRunning {
          ProgressView(value: item.fraction ?? 0)
            .progressViewStyle(.linear)
            .opacity(item.fraction == nil ? 0.4 : 1)
        }
        status
      }
      Spacer(minLength: 0)
    }
    .contentShape(.rect)
  }

  @ViewBuilder private var status: some View {
    HStack(spacing: Tokens.Space.xs) {
      if case .failed = item.state {
        Image(systemName: "exclamationmark.circle.fill")
          .foregroundStyle(Tokens.Role.warning)
          .imageScale(.small)
      }
      Text(DownloadWords.status(of: item, fileExists: fileExists))
        .lineLimit(2)
        .monospacedDigit()
    }
    .typography(.caption)
    .foregroundStyle(Tokens.Role.textSecondary)
  }

  @ViewBuilder private var trailingAction: some View {
    if item.isRunning {
      Button(action: cancel) {
        Image(systemName: "xmark.circle.fill")
          .font(.title2)
          .symbolRenderingMode(.hierarchical)
          .foregroundStyle(Tokens.Role.icon)
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Cancel Download")
    } else if item.canRetry {
      Button(action: retry) {
        Image(systemName: "arrow.clockwise.circle.fill")
          .font(.title2)
          .symbolRenderingMode(.hierarchical)
          .foregroundStyle(Tokens.Role.icon)
      }
      .buttonStyle(.borderless)
      .accessibilityLabel("Try Again")
    }
  }
}

enum DownloadWords {
  static func status(of item: DownloadItem, fileExists: Bool) -> String {
    switch item.state {
    case .downloading:
      let received = item.receivedBytes.formatted(.byteCount(style: .file))
      guard let expected = item.expectedBytes else { return received }
      return String(localized: "\(received) of \(expected.formatted(.byteCount(style: .file)))")
    case .finished:
      guard fileExists else { return String(localized: "Moved or deleted") }
      return [item.receivedBytes.formatted(.byteCount(style: .file)), item.sourceHost, time(of: item)]
        .compactMap { $0 }
        .joined(separator: " · ")
    case .failed(let failure):
      return String(localized: "Failed. \(failure.message)")
    case .cancelled:
      return String(localized: "Cancelled")
    }
  }

  static func time(of item: DownloadItem) -> String {
    (item.finishedAt ?? item.startedAt).formatted(date: .omitted, time: .shortened)
  }

  static func symbol(for fileName: String) -> String {
    let ext = (fileName as NSString).pathExtension
    guard !ext.isEmpty, let type = UTType(filenameExtension: ext) else { return "doc" }
    if type.conforms(to: .pdf) { return "doc.richtext" }
    if type.conforms(to: .image) { return "photo" }
    if type.conforms(to: .movie) || type.conforms(to: .video) { return "film" }
    if type.conforms(to: .audio) { return "waveform" }
    if type.conforms(to: .archive) { return "doc.zipper" }
    if type.conforms(to: .text) || type.conforms(to: .sourceCode) { return "doc.text" }
    return "doc"
  }
}
