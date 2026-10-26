import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

@available(macOS 26.0, *)
@MainActor
enum DownloadPrompt {
  static func run(source: Locale.Language, target: Locale.Language) async throws {
    guard let content = (NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first { $0.isVisible })?.contentView else {
      throw TranslateError.noWindow
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      var host: NSView?
      var finished = false
      let view = DownloadPromptView(configuration: .init(source: source, target: target)) { result in
        guard !finished else { return }
        finished = true
        host?.removeFromSuperview()
        continuation.resume(with: result)
      }
      let hosting = NSHostingView(rootView: view)
      hosting.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
      host = hosting
      content.addSubview(hosting)
    }
  }
}

@available(macOS 26.0, *)
private struct DownloadPromptView: View {
  let configuration: TranslationSession.Configuration
  let done: (Result<Void, Error>) -> Void
  var body: some View {
    Color.clear.translationTask(configuration) { session in
      do {
        try await session.prepareTranslation()
        done(.success(()))
      } catch {
        done(.failure(error))
      }
    }
  }
}
