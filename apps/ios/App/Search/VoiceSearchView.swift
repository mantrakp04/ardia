import ArdiaDesign
import UIKit
import SwiftUI

struct VoiceSearchView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var dictation = VoiceDictation()
  @State private var levels: [Double] = Array(repeating: 0, count: 24)

  var body: some View {
    ZStack {
      LaunchGradient()
        .ignoresSafeArea()
      VStack(spacing: Spacing.section) {
        Spacer()
        LittleSmile(openness: reduceMotion ? 0.5 : 0.3 + dictation.level * 0.7)
          .frame(width: 128)
          .foregroundStyle(.white)
          .shadow(color: .black.opacity(0.15), radius: 12, y: 6)
          .animation(.easeOut(duration: 0.12), value: dictation.level)
        transcript
        Spacer()
        waveform
        controls
      }
      .padding(.horizontal, Spacing.medium)
      .padding(.bottom, Spacing.medium)
    }
    .overlay(alignment: .topTrailing) {
      Button("Cancel", systemImage: "xmark") { close() }
        .labelStyle(.iconOnly)
        .font(.body.weight(.semibold))
        .foregroundStyle(.white)
        .frame(width: 44, height: 44)
        .glassEffect(.regular.interactive(), in: .circle)
        .padding(.trailing, Spacing.page)
        .padding(.top, Spacing.tight)
    }
    .environment(\.colorScheme, .dark)
    .task { await dictation.start() }
    .onDisappear { dictation.stop() }
    .onChange(of: dictation.level) { _, level in
      levels.removeFirst()
      levels.append(level)
    }
  }

  @ViewBuilder
  private var transcript: some View {
    switch dictation.state {
    case .denied:
      VStack(spacing: Spacing.small) {
        Text("Speech and Mic permissions required.")
          .font(.title3.weight(.semibold))
        Text("Allow Microphone and Speech Recognition for Ardia in Settings to search with your voice.")
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.8))
        Button("Open Settings") {
          if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        }
        .buttonStyle(.glass)
        .padding(.top, Spacing.tight)
      }
      .multilineTextAlignment(.center)
      .foregroundStyle(.white)
    case .unavailable(let message):
      Text(message)
        .font(.title3.weight(.semibold))
        .multilineTextAlignment(.center)
        .foregroundStyle(.white)
    default:
      Text(dictation.transcript.isEmpty ? String(localized: "Listening…") : dictation.transcript)
        .font(.title2.weight(.semibold))
        .multilineTextAlignment(.center)
        .foregroundStyle(.white.opacity(dictation.transcript.isEmpty ? 0.7 : 1))
        .padding(.horizontal, Spacing.medium)
        .padding(.vertical, Spacing.small)
        .background(.black.opacity(0.18), in: .rect(cornerRadius: 22, style: .continuous))
        .contentTransition(.opacity)
        .animation(.easeOut(duration: 0.15), value: dictation.transcript)
        .accessibilityAddTraits(.updatesFrequently)
    }
  }

  private var waveform: some View {
    HStack(alignment: .center, spacing: 4) {
      ForEach(levels.indices, id: \.self) { index in
        Capsule()
          .fill(.white.opacity(0.85))
          .frame(width: 4, height: 6 + levels[index] * 38)
      }
    }
    .frame(height: 48)
    .opacity(dictation.state == .listening ? 1 : 0)
    .animation(.easeOut(duration: 0.1), value: levels)
    .accessibilityHidden(true)
  }

  @ViewBuilder
  private var controls: some View {
    let text = dictation.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    HStack(spacing: Spacing.small) {
      if dictation.state == .listening {
        Button {
          dictation.stop()
        } label: {
          Label("Done", systemImage: "stop.fill")
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.glass)
      } else if !text.isEmpty {
        Button {
          finish { app.openSearch(text) }
        } label: {
          Text("Search")
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.glass)
        if app.offersBrowseForMe {
        Button {
          finish { app.startBrowseForMe(text) }
        } label: {
          Text("Browse for Me")
            .fontWeight(.semibold)
            .foregroundStyle(Palette.indigo)
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.glassProminent)
        .tint(.white)
        }
      } else if dictation.state != .requesting {
        Button {
          Task { await dictation.start() }
        } label: {
          Label("Try Again", systemImage: "mic.fill")
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.glass)
      }
    }
    .font(.body.weight(.medium))
    .foregroundStyle(.white)
  }

  private func finish(_ action: () -> Void) {
    dictation.stop()
    action()
    dismiss()
  }

  private func close() {
    dictation.stop()
    dismiss()
  }
}
