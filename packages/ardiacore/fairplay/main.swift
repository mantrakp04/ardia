import AVFoundation
import AppKit
import MediaPlayer

let environment = ProcessInfo.processInfo.environment
let silent = environment["ARDIA_FAIRPLAY_SILENT"] == "1"
let systemControls = environment["ARDIA_FAIRPLAY_SYSTEM_CONTROLS"] != "0"
let playlistScheme = "ardia-fairplay"
let licenseTimeout: TimeInterval = 30
let maxArtworkBytes = 4 << 20
let artworkHosts = [".scdn.co", ".spotifycdn.com"]

func send(_ message: [String: Any]) {
  guard var data = try? JSONSerialization.data(withJSONObject: message) else { return }
  data.append(0x0A)
  FileHandle.standardOutput.write(data)
}

final class Track: NSObject, AVContentKeySessionDelegate, AVAssetResourceLoaderDelegate {
  let generation: Int
  let certificate: Data
  let playlist: Data
  let session = AVContentKeySession(keySystem: .fairPlayStreaming)
  let asset: AVURLAsset
  lazy var item = AVPlayerItem(asset: asset)
  var pendingSeek: (time: Double, sequence: Int)?
  var exchanging = false
  var cancelled = false
  var announcedReady = false
  var announcedFailure = false
  var awaitingLicense: AVContentKeyRequest?
  var licenseDeadline: Timer?

  init(generation: Int, certificate: Data, playlist: Data) {
    self.generation = generation
    self.certificate = certificate
    self.playlist = playlist
    asset = AVURLAsset(url: URL(string: "\(playlistScheme)://track/\(generation).m3u8")!)
    super.init()
    asset.resourceLoader.setDelegate(self, queue: DispatchQueue(label: "ardia.fairplay.playlist.\(generation)"))
    session.setDelegate(self, queue: .main)
    session.addContentKeyRecipient(asset)
  }

  func resourceLoader(_ loader: AVAssetResourceLoader, shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
    guard request.request.url?.scheme == playlistScheme else { return false }
    request.contentInformationRequest?.contentType = "public.m3u-playlist"
    request.contentInformationRequest?.contentLength = Int64(playlist.count)
    request.contentInformationRequest?.isByteRangeAccessSupported = false
    request.dataRequest?.respond(with: playlist)
    request.finishLoading()
    return true
  }

  func contentKeySession(_ session: AVContentKeySession, didProvide request: AVContentKeyRequest) { requestLicense(request) }

  func contentKeySession(_ session: AVContentKeySession, didProvideRenewingContentKeyRequest request: AVContentKeyRequest) {
    requestLicense(request)
  }

  func contentKeySession(_ session: AVContentKeySession, contentKeyRequest request: AVContentKeyRequest, didFailWithError error: Error) {
    fail("license")
  }

  func requestLicense(_ request: AVContentKeyRequest) {
    if exchanging || cancelled { return }
    exchanging = true
    let identifier = (request.identifier as? String) ?? ""
    let contentIdentifier = Data(identifier.replacingOccurrences(of: "skd://", with: "").utf8)
    request.makeStreamingContentKeyRequestData(forApp: certificate, contentIdentifier: contentIdentifier, options: nil) { spc, _ in
      DispatchQueue.main.async {
        guard !self.cancelled else { return }
        guard let spc else {
          self.exchanging = false
          return self.fail("license")
        }
        self.awaitingLicense = request
        self.licenseDeadline?.invalidate()
        self.licenseDeadline = Timer.scheduledTimer(withTimeInterval: licenseTimeout, repeats: false) { _ in
          if self.awaitingLicense != nil { self.fail("license") }
        }
        send(["event": "request", "gen": self.generation, "spc": spc.base64EncodedString()])
      }
    }
  }

  func license(_ ckc: Data) {
    guard let request = awaitingLicense, !cancelled else { return }
    awaitingLicense = nil
    exchanging = false
    licenseDeadline?.invalidate()
    request.processContentKeyResponse(AVContentKeyResponse(fairPlayStreamingKeyResponseData: ckc))
  }

  func fail(_ step: String) {
    if cancelled || announcedFailure { return }
    announcedFailure = true
    send(["event": "failed", "gen": generation, "step": step])
  }

  func cancel() {
    cancelled = true
    licenseDeadline?.invalidate()
    awaitingLicense = nil
    session.expire()
  }
}

let player = AVPlayer()
player.automaticallyWaitsToMinimizeStalling = true
player.isMuted = silent
var current: Track?
var endObserver: NSObjectProtocol?
var failObserver: NSObjectProtocol?
var lastPosition: (time: Double, playing: Bool, sequence: Int)?
var completedSeek = 0
var pageMuted = false
var nowPlaying: [String: Any] = [MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue]
var artworkURL = ""
var publishedStatus = -1

func publishNowPlaying() {
  guard systemControls else { return }
  let center = MPNowPlayingInfoCenter.default()
  guard let track = current else {
    center.nowPlayingInfo = nil
    center.playbackState = .stopped
    return
  }
  let elapsed = CMTimeGetSeconds(player.currentTime())
  let duration = CMTimeGetSeconds(track.item.duration)
  let playing = player.timeControlStatus == .playing
  nowPlaying[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed.isFinite ? elapsed : 0
  nowPlaying[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
  if duration.isFinite && duration > 0 { nowPlaying[MPMediaItemPropertyPlaybackDuration] = duration }
  center.nowPlayingInfo = nowPlaying
  center.playbackState = playing ? .playing : .paused
}

func setMetadata(_ message: [String: Any]) {
  let text = { (key: String) in String(((message[key] as? String) ?? "").prefix(1024)) }
  nowPlaying[MPMediaItemPropertyTitle] = text("title")
  nowPlaying[MPMediaItemPropertyArtist] = text("artist")
  nowPlaying[MPMediaItemPropertyAlbumTitle] = text("album")
  let artwork = (message["artwork"] as? String) ?? ""
  if artwork != artworkURL {
    artworkURL = artwork
    nowPlaying.removeValue(forKey: MPMediaItemPropertyArtwork)
    if systemControls, let url = URL(string: artwork), url.scheme == "https",
      let host = url.host?.lowercased(), artworkHosts.contains(where: { host.hasSuffix($0) })
    {
      URLSession.shared.dataTask(with: url) { data, _, _ in
        guard let data, data.count <= maxArtworkBytes, let image = NSImage(data: data) else { return }
        DispatchQueue.main.async {
          guard artworkURL == artwork else { return }
          nowPlaying[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
          publishNowPlaying()
        }
      }.resume()
    }
  }
  publishNowPlaying()
}

func load(_ message: [String: Any]) {
  guard let generation = message["gen"] as? Int else { return }
  stop()
  guard let certificate = (message["cert"] as? String).flatMap({ Data(base64Encoded: $0) }), !certificate.isEmpty,
    let playlist = (message["playlist"] as? String).map({ Data($0.utf8) })
  else { return send(["event": "failed", "gen": generation, "step": "player"]) }
  let track = Track(generation: generation, certificate: certificate, playlist: playlist)
  current = track
  completedSeek = 0
  publishedStatus = -1
  if let volume = message["volume"] as? Double { player.volume = Float(min(max(volume, 0), 1)) }
  pageMuted = (message["muted"] as? Bool) ?? false
  player.isMuted = silent || pageMuted
  player.replaceCurrentItem(with: track.item)
  endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: track.item, queue: .main) { _ in
    if current === track { send(["event": "ended", "gen": generation]) }
  }
  failObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: track.item, queue: .main) { _ in
    if current === track { track.fail("playback") }
  }
  publishNowPlaying()
}

func stop() {
  current?.cancel()
  current = nil
  player.pause()
  player.replaceCurrentItem(with: nil)
  for observer in [endObserver, failObserver].compactMap({ $0 }) { NotificationCenter.default.removeObserver(observer) }
  endObserver = nil
  failObserver = nil
  lastPosition = nil
}

func seek(_ message: [String: Any]) {
  guard let track = current, let time = message["time"] as? Double, time.isFinite, time >= 0 else { return }
  let sequence = (message["seq"] as? Int) ?? 0
  if track.item.status != .readyToPlay {
    track.pendingSeek = (time, sequence)
    return
  }
  seek(track, to: time, sequence: sequence)
}

func seek(_ track: Track, to time: Double, sequence: Int) {
  let duration = CMTimeGetSeconds(track.item.duration)
  let target = duration.isFinite && duration > 0 ? min(time, duration) : time
  player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
    DispatchQueue.main.async {
      if current === track { completedSeek = max(completedSeek, sequence) }
      publishNowPlaying()
    }
  }
}

func handle(_ message: [String: Any]) {
  switch message["op"] as? String {
  case "load": load(message)
  case "license":
    if let track = current, message["gen"] as? Int == track.generation,
      let ckc = (message["ckc"] as? String).flatMap({ Data(base64Encoded: $0) })
    {
      track.license(ckc)
    }
  case "play": if current != nil { player.play() }
  case "pause": player.pause()
  case "seek": seek(message)
  case "volume": if let volume = message["volume"] as? Double { player.volume = Float(min(max(volume, 0), 1)) }
  case "muted":
    pageMuted = (message["muted"] as? Bool) ?? false
    player.isMuted = silent || pageMuted
  case "metadata": setMetadata(message)
  case "stop":
    stop()
    publishNowPlaying()
  default: break
  }
}

func reportPosition() {
  guard let track = current else { return }
  if track.item.status == .failed {
    track.fail("playback")
    return
  }
  if !track.announcedReady && track.item.status == .readyToPlay {
    let duration = CMTimeGetSeconds(track.item.duration)
    if duration.isFinite && duration > 0 {
      track.announcedReady = true
      send(["event": "ready", "gen": track.generation, "duration": duration])
    }
  }
  if track.item.status == .readyToPlay, let pending = track.pendingSeek {
    track.pendingSeek = nil
    seek(track, to: pending.time, sequence: pending.sequence)
  }
  let status = player.timeControlStatus.rawValue
  if status != publishedStatus {
    publishedStatus = status
    publishNowPlaying()
  }
  let seconds = CMTimeGetSeconds(player.currentTime())
  let time = seconds.isFinite ? seconds : 0
  let playing = player.timeControlStatus == .playing
  if !playing, let last = lastPosition, last.playing == playing, last.sequence == completedSeek, abs(last.time - time) < 0.05 { return }
  lastPosition = (time, playing, completedSeek)
  send(["event": "position", "gen": track.generation, "time": time, "playing": playing, "seq": completedSeek])
}

func remote(_ command: MPRemoteCommand, _ name: String) {
  command.isEnabled = true
  command.addTarget { _ in
    guard current != nil else { return .noActionableNowPlayingItem }
    send(["event": "remote", "command": name])
    return .success
  }
}

_ = NSApplication.shared
if systemControls {
  let commands = MPRemoteCommandCenter.shared()
  remote(commands.playCommand, "play")
  remote(commands.pauseCommand, "pause")
  remote(commands.togglePlayPauseCommand, "toggle")
  remote(commands.nextTrackCommand, "nexttrack")
  remote(commands.previousTrackCommand, "previoustrack")
  commands.changePlaybackPositionCommand.isEnabled = true
  commands.changePlaybackPositionCommand.addTarget { event in
    guard current != nil, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
    send(["event": "remote", "command": "seekto", "time": event.positionTime])
    return .success
  }
}

var pending = Data()
FileHandle.standardInput.readabilityHandler = { input in
  let data = input.availableData
  DispatchQueue.main.async {
    if data.isEmpty { exit(0) }
    pending.append(data)
    while let newline = pending.firstIndex(of: 0x0A) {
      let line = pending.subdata(in: pending.startIndex..<newline)
      pending.removeSubrange(pending.startIndex...newline)
      if let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] { handle(message) }
    }
  }
}

Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in reportPosition() }
RunLoop.main.run()
