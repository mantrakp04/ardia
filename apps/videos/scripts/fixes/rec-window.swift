import AppKit
import ScreenCaptureKit

_ = NSApplication.shared
let usage = "usage: rec-window <pid> <max seconds> <out.mov> <title part> [--fps N]\n"
let argv = CommandLine.arguments
guard argv.count >= 5, let pid = Int32(argv[1]), let seconds = Double(argv[2]) else {
  FileHandle.standardError.write(usage.data(using: .utf8)!)
  exit(2)
}
let outURL = URL(fileURLWithPath: argv[3])
let titlePart = argv[4]
let fps = argv.firstIndex(of: "--fps").flatMap { argv.count > $0 + 1 ? Int(argv[$0 + 1]) : nil } ?? 60
try? FileManager.default.removeItem(at: outURL)

final class Session: NSObject, SCRecordingOutputDelegate, SCStreamOutput {
  var started = false
  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    started = true
    print("recording \(Int(Date().timeIntervalSince1970 * 1000))")
    fflush(stdout)
  }
  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    print("finished")
    fflush(stdout)
    exit(0)
  }
  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    print("error \(error)")
    fflush(stdout)
    exit(1)
  }
  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {}
}

let session = Session()
var stopRequested = false
for sig in [SIGINT, SIGTERM] {
  signal(sig, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
  source.setEventHandler { stopRequested = true }
  source.resume()
  objc_setAssociatedObject(session, "\(sig)", source, .OBJC_ASSOCIATION_RETAIN)
}

Task {
  do {
    let end = Date().addingTimeInterval(seconds)
    var found: SCWindow?
    while found == nil && Date() < end && !stopRequested {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      found = content.windows.first { $0.owningApplication?.processID == pid && ($0.title ?? "").contains(titlePart) && $0.frame.width > 1 }
      if found == nil { try await Task.sleep(nanoseconds: 20_000_000) }
    }
    guard let window = found else {
      print("no window")
      exit(1)
    }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let scale = CGFloat(filter.pointPixelScale)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width * scale)
    config.height = Int(window.frame.height * scale)
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    config.showsCursor = false
    config.captureResolution = .best
    config.queueDepth = 8
    config.ignoreShadowsSingleWindow = true
    config.colorSpaceName = CGColorSpace.sRGB
    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
    try stream.addStreamOutput(session, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames"))
    let recording = SCRecordingOutputConfiguration()
    recording.outputURL = outURL
    recording.outputFileType = .mov
    recording.videoCodecType = .h264
    let output = SCRecordingOutput(configuration: recording, delegate: session)
    try stream.addRecordingOutput(output)
    try await stream.startCapture()
    let r = window.frame
    print("rect \(Int(r.minX)),\(Int(r.minY)),\(Int(r.width)),\(Int(r.height)) scale \(scale) size \(config.width)x\(config.height)")
    fflush(stdout)
    while Date() < end && !stopRequested { try await Task.sleep(nanoseconds: 30_000_000) }
    try await stream.stopCapture()
    try? await Task.sleep(nanoseconds: 3_000_000_000)
    print("stopped without finish")
    exit(session.started ? 0 : 1)
  } catch {
    print("error \(error)")
    exit(1)
  }
}
RunLoop.main.run()
