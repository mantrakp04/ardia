import AppKit
import CoreImage
import ExpoModulesCore
import LocalAuthentication
import LocalAuthenticationEmbeddedUI

final class VaultTouchIDView: ExpoView {
  let onStatus = EventDispatcher()

  var armed = false {
    didSet {
      guard armed != oldValue else { return }
      if armed { beginArming() } else { arming += 1 }
      sync()
    }
  }

  private enum Status: String {
    case ready, retry, granted, unavailable, lockout
  }

  private enum Phase {
    case idle, listening, waiting, granted, ended
  }

  private static let retryDelay: TimeInterval = 0.6
  private static let cancelDelay: TimeInterval = 0.3
  private static let backoffDelay: TimeInterval = 2
  private static let burstCount = 5
  private static let burstWindow: TimeInterval = 3
  private static let steadyListening: TimeInterval = 2
  private static let failureDelay: TimeInterval = 0.6
  private static let longestFailureDelay: TimeInterval = 8
  private static let simulatedTouchDelay: TimeInterval = 0.8
  private static let simulatedMissDelay: TimeInterval = 0.5

  private let host = NSView()
  nonisolated(unsafe) private var context: LAContext?
  nonisolated(unsafe) private var observers: [NSObjectProtocol] = []
  private var glyph: LAAuthenticationView?
  private var phase = Phase.idle
  private var generation = 0
  private var rearmToken = 0
  private var arming = 0
  private var wasFocused = false
  private var cancels: [TimeInterval] = []
  private var backingOff = false
  private var failureStreak = 0
  private var listeningSince: TimeInterval = 0
  private var simulatedAttempts = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    host.wantsLayer = true
    host.layerUsesCoreImageFilters = true
    host.layer?.masksToBounds = true
    addSubview(host)
  }

  deinit {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    context?.invalidate()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    host.frame = bounds
    fitGlyph()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    removeObservers()
    if window != nil { addObservers() }
    wasFocused = false
    sync()
  }

  private func addObservers() {
    let center = NotificationCenter.default
    let names = [
      NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
      NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
    ]
    observers = names.map { name in
      center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self else { return }
          self.sync()
        }
      }
    }
  }

  private func removeObservers() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
  }

  private var focused: Bool {
    guard let window else { return false }
    if LaunchConfig.shared.background { return true }
    guard NSApp.isActive else { return false }
    if window.isKeyWindow { return true }
    return NSApp.keyWindow?.parent === window
  }

  private func beginArming() {
    arming += 1
    phase = .idle
    cancels = []
    backingOff = false
    failureStreak = 0
    simulatedAttempts = 0
  }

  private func sync() {
    guard armed, window != nil else {
      stop()
      phase = .idle
      wasFocused = false
      return
    }
    let focusedNow = focused
    let regained = focusedNow && !wasFocused
    wasFocused = focusedNow
    guard focusedNow else {
      if phase == .listening {
        stop()
        phase = .waiting
      }
      return
    }
    switch phase {
    case .listening, .ended: return
    case .granted: if regained { start() }
    case .idle, .waiting: start()
    }
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
    stop()
    let mine = generation
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
    phase = .listening
    listeningSince = ProcessInfo.processInfo.systemUptime
    let config = LaunchConfig.shared
    if config.background { return simulate(mine, scenario: config.testValue("touchID")) }
    var problem: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &problem) else {
      let code = problem.flatMap { LAError.Code(rawValue: $0.code) }
      NSLog("[vaults] touch id can't be used (code %ld)", code?.rawValue ?? 0)
      return end(code == .biometryLockout ? .lockout : .unavailable)
    }
    emit(.ready)
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "fill your password") { [weak self] granted, error in
      let code = (error as? LAError)?.code
      Task { @MainActor [weak self] in self?.finish(mine, granted: granted, code: code) }
    }
  }

  private func simulate(_ mine: Int, scenario: String?) {
    simulatedAttempts += 1
    switch scenario {
    case "granted":
      emit(.ready)
      after(Self.simulatedTouchDelay) { $0.finish(mine, granted: true, code: nil) }
    case "retryThenGranted":
      emit(.ready)
      if simulatedAttempts == 1 {
        after(Self.simulatedMissDelay) { $0.finish(mine, granted: false, code: .authenticationFailed) }
      } else {
        after(Self.simulatedTouchDelay) { $0.finish(mine, granted: true, code: nil) }
      }
    case "lockout":
      end(.lockout)
    case "unavailable":
      end(.unavailable)
    default:
      emit(.ready)
    }
  }

  private func finish(_ mine: Int, granted: Bool, code: LAError.Code?) {
    guard mine == generation, phase == .listening else { return }
    if granted {
      stop()
      phase = .granted
      failureStreak = 0
      VaultOwnerCheck.grant()
      NSLog("[vaults] touch id granted")
      emit(.granted)
      return
    }
    switch code {
    case .authenticationFailed?:
      stop()
      failureStreak = 0
      emit(.retry)
      scheduleRearm(after: Self.retryDelay)
    case .biometryLockout?:
      NSLog("[vaults] touch id locked out")
      end(.lockout)
    case .biometryNotAvailable?, .biometryNotEnrolled?, .passcodeNotSet?:
      NSLog("[vaults] touch id unavailable (code %ld)", code?.rawValue ?? 0)
      end(.unavailable)
    case .systemCancel?, .appCancel?, .userCancel?, .notInteractive?, .userFallback?:
      let listened = ProcessInfo.processInfo.systemUptime - listeningSince
      stop()
      if focused {
        scheduleRearm(after: cancelDelay(listened: listened))
      } else {
        phase = .waiting
      }
    default:
      stop()
      failureStreak += 1
      let delay = min(Self.failureDelay * pow(2, Double(failureStreak - 1)), Self.longestFailureDelay)
      NSLog("[vaults] touch id stopped (code %ld), trying again in %.1f s", code?.rawValue ?? 0, delay)
      scheduleRearm(after: delay)
    }
  }

  private func cancelDelay(listened: TimeInterval) -> TimeInterval {
    let now = ProcessInfo.processInfo.systemUptime
    if listened >= Self.steadyListening {
      backingOff = false
      cancels = []
    }
    cancels = cancels.filter { now - $0 < Self.burstWindow } + [now]
    if !backingOff, cancels.count >= Self.burstCount {
      backingOff = true
      NSLog("[vaults] touch id keeps being cancelled, slowing down")
    }
    return backingOff ? Self.backoffDelay : Self.cancelDelay
  }

  private func scheduleRearm(after delay: TimeInterval) {
    rearmToken += 1
    let token = rearmToken
    phase = .waiting
    after(delay) { view in
      guard token == view.rearmToken, view.phase == .waiting else { return }
      view.sync()
    }
  }

  private func after(_ delay: TimeInterval, _ work: @escaping @MainActor @Sendable (VaultTouchIDView) -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      MainActor.assumeIsolated {
        guard let self else { return }
        work(self)
      }
    }
  }

  private func end(_ status: Status) {
    stop()
    phase = .ended
    emit(status)
  }

  private func emit(_ status: Status) {
    let token = arming
    DispatchQueue.main.async { [weak self] in
      MainActor.assumeIsolated {
        guard let self, self.arming == token else { return }
        self.onStatus(["status": status.rawValue])
      }
    }
  }

  private func stop() {
    generation += 1
    rearmToken += 1
    context?.invalidate()
    context = nil
    glyph?.removeFromSuperview()
    glyph = nil
  }
}
