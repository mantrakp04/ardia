import AppKit
import AVKit
import ExpoModulesCore

final class ReportVideoView: ExpoView {
  private let player = AVPlayerView()
  private var loadedPath: String?

  var path: String? {
    didSet { load() }
  }

  var playing = false {
    didSet { applyPlaying() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    player.controlsStyle = .inline
    player.showsFullScreenToggleButton = false
    player.videoGravity = .resizeAspect
    addSubview(player)
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    player.frame = bounds
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil { player.player?.pause() }
  }

  private func load() {
    guard path != loadedPath else { return }
    loadedPath = path
    player.player?.pause()
    player.player = path.map { AVPlayer(url: URL(fileURLWithPath: $0)) }
    applyPlaying()
  }

  private func applyPlaying() {
    guard let item = player.player else { return }
    if playing {
      if let current = item.currentItem, current.currentTime() >= current.duration { item.seek(to: .zero) }
      item.play()
    } else {
      item.pause()
    }
  }
}
