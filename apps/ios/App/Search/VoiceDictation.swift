import AVFoundation
import ArdiaBrowser
import Foundation
import Speech

extension DictationSession {
  static func live() -> DictationSession {
    DictationSession(
      requestAccess: {
        let speech = await DictationSession.requestSpeech()
        let microphone = await AVAudioApplication.requestRecordPermission()
        guard speech == .authorized, microphone else { return .denied }
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
          return .unavailable(String(localized: "Dictation is unavailable in your language."))
        }
        return .granted
      },
      startRecorder: { events in
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { throw SpeechRecorder.Unavailable() }
        let recorder = SpeechRecorder(recognizer: recognizer)
        try recorder.start(events)
        return recorder
      }
    )
  }

  private static func requestSpeech() async -> SFSpeechRecognizerAuthorizationStatus {
    await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { @Sendable status in continuation.resume(returning: status) }
    }
  }
}

nonisolated final class SpeechRecorder: DictationRecorder, @unchecked Sendable {
  struct Unavailable: Error {}

  private let recognizer: SFSpeechRecognizer
  private let engine = AVAudioEngine()
  private let request = SFSpeechAudioBufferRecognitionRequest()
  private var task: SFSpeechRecognitionTask?

  init(recognizer: SFSpeechRecognizer) {
    self.recognizer = recognizer
  }

  func start(_ events: DictationEvents) throws {
    do {
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
        events.level(Self.level(of: buffer))
      }
      engine.prepare()
      try engine.start()
    } catch {
      stop()
      throw error
    }
    task = recognizer.recognitionTask(with: request) { result, error in
      if let result {
        events.text(result.bestTranscription.formattedString, result.isFinal)
      } else if error != nil {
        events.failure()
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
