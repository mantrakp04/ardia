import ArdiaDesign
import SwiftUI

struct LoadingLine: View {
  let progress: Double
  let isLoading: Bool

  @State private var track = LoadProgress()
  @State private var revealTask: Task<Void, Never>?

  var body: some View {
    Rectangle()
      .fill(BrowsePalette.loadingBorder)
      .scaleEffect(x: track.fraction, y: 1, anchor: .leading)
      .opacity(track.isVisible ? 1 : 0)
      .frame(maxWidth: .infinity)
      .frame(height: BrowseLayout.progressHeight)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
      .onChange(of: isLoading, initial: true) { _, loading in
        if loading { begin() } else { end() }
      }
      .onChange(of: progress) { _, value in
        guard track.phase == .showing else {
          track.advance(to: value)
          return
        }
        withAnimation(Motion.progressAdvance) { track.advance(to: value) }
      }
      .onDisappear { revealTask?.cancel() }
  }

  private func begin() {
    track.start()
    track.advance(to: progress)
    scheduleReveal()
  }

  private func scheduleReveal() {
    guard track.phase == .waiting else { return }
    revealTask?.cancel()
    revealTask = Task { @MainActor in
      try? await Task.sleep(for: Motion.progressRevealDelay)
      guard !Task.isCancelled else { return }
      withAnimation(Motion.progressReveal) {
        track.reveal()
        track.advance(to: progress)
      }
    }
  }

  private func end() {
    revealTask?.cancel()
    guard track.phase == .showing else {
      track.finish()
      return
    }
    withAnimation(Motion.progressFill) {
      track.finish()
    } completion: {
      withAnimation(Motion.progressFade) {
        track.fade()
      } completion: {
        track.settle()
        if isLoading { track.advance(to: progress) }
        scheduleReveal()
      }
    }
  }
}
