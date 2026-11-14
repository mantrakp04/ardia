import ArdiaBrowser
import AVFoundation
import Foundation
import Observation
import UIKit

@MainActor
@Observable
final class ReadAloud: NSObject {
  private(set) var listening = EarListening()
  private(set) var spokenFraction: Double = 0

  @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
  @ObservationIgnored private let proximity = ProximityFeed()
  @ObservationIgnored private var text = ""
  @ObservationIgnored private var currentUtterance: AVSpeechUtterance?
  @ObservationIgnored private var isWatching = false

  override init() {
    super.init()
    synthesizer.delegate = self
    proximity.onChange = { [weak self] near in self?.proximityChanged(near) }
  }

  var isNear: Bool { listening.isNear }

  func watch() {
    guard !isWatching else { return }
    isWatching = true
    proximity.start()
  }

  func answerReady(_ spoken: String) {
    text = spoken
    guard !spoken.isEmpty else { return }
    perform(listening.answerReady())
  }

  func toggleSpeaker() {
    perform(listening.toggleSpeaker())
  }

  func reset() {
    synthesizer.stopSpeaking(at: .immediate)
    currentUtterance = nil
    spokenFraction = 0
    text = ""
    listening.reset()
  }

  func stop() {
    reset()
    proximity.stop()
    isWatching = false
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func proximityChanged(_ near: Bool) {
    perform(listening.proximity(isNear: near))
  }

  private func perform(_ command: EarListening.Command) {
    switch command {
    case .none:
      break
    case .start(let output):
      route(output)
      speakFromStart()
    case .resume(let output):
      route(output)
      if synthesizer.isPaused { synthesizer.continueSpeaking() } else { speakFromStart() }
    case .reroute(let output):
      synthesizer.pauseSpeaking(at: .immediate)
      route(output)
      synthesizer.continueSpeaking()
    case .pause:
      synthesizer.pauseSpeaking(at: .word)
    }
  }

  private func speakFromStart() {
    synthesizer.stopSpeaking(at: .immediate)
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = Self.bestVoice()
    utterance.prefersAssistiveTechnologySettings = true
    currentUtterance = utterance
    spokenFraction = 0
    synthesizer.speak(utterance)
  }

  private func route(_ output: ListeningOutput) {
    let session = AVAudioSession.sharedInstance()
    do {
      switch output {
      case .earpiece:
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP])
        try session.overrideOutputAudioPort(.none)
      case .speaker:
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      }
      try session.setActive(true)
    } catch {
      try? session.setCategory(.playback, mode: .spokenAudio)
      try? session.setActive(true)
    }
  }

  static func bestVoice() -> AVSpeechSynthesisVoice? {
    let language = AVSpeechSynthesisVoice.currentLanguageCode()
    let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == language }
    return voices.first { $0.quality == .premium } ?? voices.first { $0.quality == .enhanced } ?? AVSpeechSynthesisVoice(language: language)
  }

  private func utteranceEnded(_ utterance: AVSpeechUtterance) {
    guard utterance === currentUtterance else { return }
    currentUtterance = nil
    spokenFraction = 1
    listening.finished()
  }

  private func utteranceProgressed(_ utterance: AVSpeechUtterance, location: Int) {
    guard utterance === currentUtterance, !text.isEmpty else { return }
    spokenFraction = min(Double(location) / Double((text as NSString).length), 1)
  }
}

extension ReadAloud: AVSpeechSynthesizerDelegate {
  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    nonisolated(unsafe) let utterance = utterance
    Task { @MainActor in self.utteranceEnded(utterance) }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
    nonisolated(unsafe) let utterance = utterance
    let location = characterRange.location
    Task { @MainActor in self.utteranceProgressed(utterance, location: location) }
  }
}
