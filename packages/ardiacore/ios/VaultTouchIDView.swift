import AppKit
import CoreImage
import ExpoModulesCore
import LocalAuthentication
import LocalAuthenticationEmbeddedUI

final class VaultTouchIDView: ExpoView {
  let onEnded = EventDispatcher()

  var armed = false {
    didSet { if armed != oldValue { refresh() } }
  }

  private static let retryDelay: TimeInterval = 0.6
  private static let simulatedTouchDelay: TimeInterval = 0.8
  private let host = NSView()
  private var context: LAContext?
  private var glyph: LAAuthenticationView?
  private var attempt = 0
  private var keyObserver: NSObjectProtocol?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    host.wantsLayer = true
    host.layerUsesCoreImageFilters = true
    host.layer?.masksToBounds = true
    addSubview(host)
  }

  deinit {
    if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
    context?.invalidate()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    host.frame = bounds
    fitGlyph()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
    keyObserver = nil
    if let window {
      keyObserver = NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main) {
        [weak self] _ in self?.refresh()
      }
    }
    refresh()
  }

  private func refresh() {
    if armed, window != nil { start() } else { stop() }
  }

  private func fitGlyph() {
    guard let glyph else { return }
    let natural = glyph.fittingSize
    let size = natural.width > 0 && natural.height > 0 ? natural : bounds.size
    glyph.frame = NSRect(x: 0, y: 0, width: size.width, height: size.height)
    let scale = min(bounds.width / max(size.width, 1), bounds.height / max(size.height, 1))
    let dx = (bounds.width - size.width * scale) / 2
    let dy = (bounds.height - size.height * scale) / 2
    host.layer?.sublayerTransform = CATransform3DConcat(CATransform3DMakeScale(scale, scale, 1), CATransform3DMakeTranslation(dx, dy, 0))
  }

  private func hideAppleGlyph() {
    guard let filter = CIFilter(name: "CIColorMatrix") else { return }
    filter.setDefaults()
    filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 0), forKey: "inputAVector")
    host.contentFilters = [filter]
  }

  private func start() {
    guard context == nil else { return }
    let context = LAContext()
    context.localizedFallbackTitle = ""
    let glyph = LAAuthenticationView(context: context, controlSize: .small)
    glyph.translatesAutoresizingMaskIntoConstraints = true
    host.addSubview(glyph)
    self.context = context
    self.glyph = glyph
    host.frame = bounds
    fitGlyph()
    hideAppleGlyph()
    attempt += 1
    let mine = attempt
    let config = LaunchConfig.shared
    if config.background {
      guard config.testValue("touchID") == "granted" else { return }
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.simulatedTouchDelay) { [weak self] in self?.finish(mine, granted: true, code: nil) }
      return
    }
    var problem: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &problem) else {
      return end(mine, reason: Self.reason(problem.flatMap { LAError.Code(rawValue: $0.code) }))
    }
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "fill your password") { [weak self] granted, error in
      let code = (error as? LAError)?.code
      DispatchQueue.main.async { self?.finish(mine, granted: granted, code: code) }
    }
  }

  private func finish(_ mine: Int, granted: Bool, code: LAError.Code?) {
    guard mine == attempt, context != nil else {
      NSLog("[vaults] touch id result for an old attempt ignored (granted %d)", granted ? 1 : 0)
      return
    }
    if granted {
      VaultOwnerCheck.grant()
      NSLog("[vaults] touch id granted, asking the menu to act")
      ArdiaEvents.emit("vaults.touchID", data: [:])
      return
    }
    NSLog("[vaults] touch id ended without a match (code %ld)", code?.rawValue ?? 0)
    switch code {
    case .appCancel?, .systemCancel?:
      stop()
    case .authenticationFailed?, .userCancel?:
      stop()
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in self?.refresh() }
    default:
      end(mine, reason: Self.reason(code))
    }
  }

  private func end(_ mine: Int, reason: String) {
    guard mine == attempt else { return }
    stop()
    onEnded(["reason": reason])
  }

  private func stop() {
    attempt += 1
    context?.invalidate()
    context = nil
    glyph?.removeFromSuperview()
    glyph = nil
  }

  private static func reason(_ code: LAError.Code?) -> String {
    switch code {
    case .biometryLockout?: return "lockout"
    case .biometryNotAvailable?, .biometryNotEnrolled?, .passcodeNotSet?: return "unavailable"
    default: return "failed"
    }
  }
}
