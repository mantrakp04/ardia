import AppKit
import ExpoModulesCore

final class GlassGroup: ExpoView {
  private let container: NSView?
  private let content = GlassGroupContent()

  required init(appContext: AppContext? = nil) {
    if #available(macOS 26.0, *) {
      let group = NSGlassEffectContainerView()
      group.contentView = content
      container = group
    } else {
      container = nil
    }
    super.init(appContext: appContext)
    if let container { addSubview(container) }
  }

  override func didUpdateReactSubviews() {
    guard container != nil else { return super.didUpdateReactSubviews() }
    let wanted: [NSView] = reactSubviews() ?? []
    if content.subviews != wanted { content.subviews = wanted }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    container?.frame = bounds
    content.frame = bounds
  }
}

private final class GlassGroupContent: NSView {
  override var isFlipped: Bool { true }
}
