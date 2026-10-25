import AVFoundation
import Foundation
import Observation
import Speech

@MainActor
@Observable
final class VoiceDictation {
  enum State: Equatable {
    case idle
    case requesting
    case listening
    case finished
    case denied
    case unavailable(String)
  }

  private(set) var state: State = .idle
  private(set) var transcript = ""
  private(set) var level: Double = 0

  @ObservationIgnored private var recorder: SpeechRecorder?
  @ObservationIgnored private var silenceTask: Task<Void, Never>?
  static let silenceTimeout: Duration = .seconds(1.6)

  func start() async {
    guard state != .listening else { return }
    state = .requesting
    let speech = await Self.requestSpeech()
    let microphone = await AVAudioApplication.requestRecordPermission()
    guard speech == .authorized, microphone else {
      state = .denied
      return
    }
    guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
      state = .unavailable(String(localized: "Dictation is unavailable in your language."))
      return
    }
    transcript = ""
    let recorder = SpeechRecorder(recognizer: recognizer)
    self.recorder = recorder
    do {
      try recorder.start(
        onText: { [weak self] text, isFinal in
          Task { @MainActor in self?.received(text, isFinal: isFinal) }
        },
        onLevel: { [weak self] level in
          Task { @MainActor in self?.level = level }
        },
        onError: { [weak self] in
          Task { @MainActor in self?.failed() }
        }
      )
      state = .listening
      scheduleSilence()
    } catch {
      self.recorder = nil
      state = .unavailable(String(localized: "Speech dictation is unavailable."))
    }
  }

  func stop() {
    silenceTask?.cancel()
    silenceTask = nil
    recorder?.stop()
    recorder = nil
    level = 0
    if state == .listening || state == .requesting { state = transcript.isEmpty ? .idle : .finished }
  }

  private func received(_ text: String, isFinal: Bool) {
    guard state == .listening else { return }
    transcript = text
    if isFinal {
      stop()
    } else {
      scheduleSilence()
    }
  }

  private func failed() {
    guard state == .listening else { return }
    stop()
    if transcript.isEmpty { state = .unavailable(String(localized: "Ardia couldn’t hear anything. Try again.")) }
  }

  private func scheduleSilence() {
    silenceTask?.cancel()
    silenceTask = Task { [weak self] in
      try? await Task.sleep(for: Self.silenceTimeout + (self?.transcript.isEmpty == true ? .seconds(4) : .zero))
      guard !Task.isCancelled else { return }
      self?.stop()
    }
  }

  private static func requestSpeech() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
  }
}

nonisolated final class SpeechRecorder: @unchecked Sendable {
  private let recognizer: SFSpeechRecognizer
  private let engine = AVAudioEngine()
  private let request = SFSpeechAudioBufferRecognitionRequest()
  private var task: SFSpeechRecognitionTask?

  init(recognizer: SFSpeechRecognizer) {
    self.recognizer = recognizer
  }

  func start(onText: @escaping @Sendable (String, Bool) -> Void, onLevel: @escaping @Sendable (Double) -> Void, onError: @escaping @Sendable () -> Void) throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
    try session.setActive(true, options: .notifyOthersOnDeactivation)
    request.shouldReportPartialResults = true
    request.addsPunctuation = false
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    let request = request
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
      onLevel(Self.level(of: buffer))
    }
    engine.prepare()
    try engine.start()
    task = recognizer.recognitionTask(with: request) { result, error in
      if let result {
        onText(result.bestTranscription.formattedString, result.isFinal)
      } else if error != nil {
        onError()
      }
    }
  }

  func stop() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    request.endAudio()
    task?.finish()
    task = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  static func level(of buffer: AVAudioPCMBuffer) -> Double {
    guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
    var sum: Float = 0
    for index in 0..<Int(buffer.frameLength) { sum += channel[index] * channel[index] }
    let rms = sqrt(sum / Float(buffer.frameLength))
    let decibels = 20 * log10(max(rms, 0.000_01))
    return Double(min(max((decibels + 50) / 45, 0), 1))
  }
}
