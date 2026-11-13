import ArdiaDesign
import SwiftUI
import UIKit

@MainActor
final class TrayShellController: UIViewController {
  enum Phase: Equatable {
    case idle
    case opening
    case open
    case dragging(releasedKeyboard: Bool)
    case settling
    case closing
  }

  private struct HostedContent {
    let host: UIHostingController<AnyView>
    let height: NSLayoutConstraint

    var view: UIView { host.view }
  }

  var onDismissRequest: () -> Void = {}
  var onClosed: () -> Void = {}
  var onPresented: () -> Void = {}
  var onKeyboardHeight: (CGFloat) -> Void = { _ in }
  var wantedKind: TrayKind?
  let progress = TrayProgress()
  private(set) var phase = Phase.idle

  private let dimView = UIView()
  private let trayView = UIView()
  private let shadowView = UIView()
  private let barGlass = UIVisualEffectView(effect: nil)
  private let surfaceView = UIView()
  private let panelFillView = UIView()
  private let pill = DockedPill()
  private let chevron = TrayChevron()
  private let contentStage = UIView()
  private let contentMask = UIView()
  private let fieldMask = UIView()
  private let bodyMask = UIView()
  private var content: HostedContent?
  private var leavingContent: HostedContent?
  private var sidesHost: UIHostingController<AnyView>?

  private var trayHeight: NSLayoutConstraint!
  private var surfaceLeading: NSLayoutConstraint!
  private var surfaceTrailing: NSLayoutConstraint!
  private var surfaceBottom: NSLayoutConstraint!
  private var keyboardPin: NSLayoutConstraint!
  private var heldPin: NSLayoutConstraint!

  private var launch: TrayLaunch?
  private var look = TrayLook(panel: .systemBackground, style: .unspecified, barStyle: .unspecified)
  private var restHeight: CGFloat = BrowseLayout.barHeight
  private var pillAtRest = CGRect.zero
  private var capsuleAtRest: CGRect?
  private var chevronAtRest: CGRect?
  private var fieldFrame = CGRect.zero
  private var contentTop: CGFloat = 0
  private var keyboardOverlap: CGFloat = 0
  private var fallbackOpen: DispatchWorkItem?
  private var animationToken = 0
  private var morph: CGFloat = 0
  private var didWarmUpKeyboard = false

  static let aboveKeyboardPreferred = BrowseLayout.sheetAboveKeyboard
  static let keyboardThreshold: CGFloat = 120
  static let pillTopInBar = BrowseLayout.barHeight - BrowseLayout.barCenterFromBottom - BrowseLayout.plusCapsule.height / 2
  static let fieldReportTolerance: CGFloat = 0.5
  static let keyboardWarmUpDelay: TimeInterval = 0.6
  static let keyboardWait: TimeInterval = 0.35
  static let surfaceBelowScreen = BrowseLayout.sheetTopRadius * 10

  override func loadView() {
    view = TrayPassthroughView()
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    view.keyboardLayoutGuide.usesBottomSafeArea = false

    dimView.alpha = 0
    dimView.isAccessibilityElement = true
    dimView.accessibilityTraits = .button
    dimView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(dismissTapped)))

    trayView.isHidden = true

    shadowView.layer.shadowColor = UIColor.black.cgColor
    shadowView.layer.shadowOpacity = 0.14
    shadowView.layer.shadowRadius = 24
    shadowView.layer.shadowOffset = CGSize(width: 0, height: -4)
    shadowView.layer.cornerRadius = BrowseLayout.sheetTopRadius
    shadowView.layer.cornerCurve = .continuous
    shadowView.alpha = 0

    surfaceView.clipsToBounds = true
    surfaceView.layer.cornerCurve = .continuous
    barGlass.isUserInteractionEnabled = false

    fieldMask.backgroundColor = .black
    fieldMask.layer.cornerCurve = .continuous
    bodyMask.backgroundColor = .black
    contentMask.addSubview(fieldMask)
    contentMask.addSubview(bodyMask)

    chevron.alpha = 0
    chevron.addTarget(self, action: #selector(dismissTapped), for: .touchUpInside)

    for subview in [dimView, trayView, shadowView, barGlass, surfaceView, panelFillView, contentStage] {
      subview.translatesAutoresizingMaskIntoConstraints = false
    }
    view.addSubview(dimView)
    view.addSubview(trayView)
    trayView.addSubview(shadowView)
    trayView.addSubview(barGlass)
    trayView.addSubview(surfaceView)
    surfaceView.addSubview(panelFillView)
    trayView.addSubview(pill)
    trayView.addSubview(contentStage)
    trayView.addSubview(chevron)

    trayHeight = trayView.heightAnchor.constraint(equalToConstant: restHeight)
    keyboardPin = trayView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
    heldPin = trayView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
    surfaceLeading = surfaceView.leadingAnchor.constraint(equalTo: trayView.leadingAnchor)
    surfaceTrailing = surfaceView.trailingAnchor.constraint(equalTo: trayView.trailingAnchor)
    surfaceBottom = surfaceView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: Self.surfaceBelowScreen)
    NSLayoutConstraint.activate([
      dimView.topAnchor.constraint(equalTo: view.topAnchor),
      dimView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      dimView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      dimView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      trayView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      trayView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      keyboardPin,
      trayHeight,
      surfaceView.topAnchor.constraint(equalTo: trayView.topAnchor),
      surfaceLeading,
      surfaceTrailing,
      surfaceBottom,
      barGlass.topAnchor.constraint(equalTo: surfaceView.topAnchor),
      barGlass.leadingAnchor.constraint(equalTo: surfaceView.leadingAnchor),
      barGlass.trailingAnchor.constraint(equalTo: surfaceView.trailingAnchor),
      barGlass.bottomAnchor.constraint(equalTo: surfaceView.bottomAnchor),
      shadowView.topAnchor.constraint(equalTo: surfaceView.topAnchor),
      shadowView.leadingAnchor.constraint(equalTo: surfaceView.leadingAnchor),
      shadowView.trailingAnchor.constraint(equalTo: surfaceView.trailingAnchor),
      shadowView.bottomAnchor.constraint(equalTo: surfaceView.bottomAnchor),
      panelFillView.topAnchor.constraint(equalTo: surfaceView.topAnchor),
      panelFillView.leadingAnchor.constraint(equalTo: surfaceView.leadingAnchor),
      panelFillView.trailingAnchor.constraint(equalTo: surfaceView.trailingAnchor),
      panelFillView.bottomAnchor.constraint(equalTo: surfaceView.bottomAnchor),
      contentStage.topAnchor.constraint(equalTo: trayView.topAnchor),
      contentStage.leadingAnchor.constraint(equalTo: trayView.leadingAnchor),
      contentStage.trailingAnchor.constraint(equalTo: trayView.trailingAnchor),
      contentStage.bottomAnchor.constraint(equalTo: trayView.bottomAnchor),
    ])

    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
    center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didWarmUpKeyboard else { return }
    didWarmUpKeyboard = true
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.keyboardWarmUpDelay) { [weak self] in
      self?.warmUpKeyboard()
    }
  }

  private func warmUpKeyboard() {
    guard phase == .idle, keyboardOverlap <= Self.keyboardThreshold, let window = view.window else { return }
    let field = UITextField(frame: CGRect(x: -100, y: -100, width: 10, height: 10))
    field.keyboardType = .webSearch
    field.returnKeyType = .go
    field.autocorrectionType = .no
    field.autocapitalizationType = .none
    field.spellCheckingType = .no
    window.addSubview(field)
    UIView.performWithoutAnimation {
      field.becomeFirstResponder()
      field.resignFirstResponder()
    }
    field.removeFromSuperview()
  }

  var isPresenting: Bool { phase != .idle && phase != .closing }

  var presentedKind: TrayKind? { isPresenting ? launch?.kind : nil }

  func apply(_ look: TrayLook) {
    self.look = look
    panelFillView.backgroundColor = look.panel
    shadowView.backgroundColor = look.panel
    trayView.overrideUserInterfaceStyle = look.style
    barGlass.overrideUserInterfaceStyle = look.barStyle
    if phase != .idle, phase != .closing, phase != .opening {
      styleControls(look.style)
    }
  }

  private func styleControls(_ style: UIUserInterfaceStyle) {
    pill.overrideUserInterfaceStyle = style
    chevron.overrideUserInterfaceStyle = style
  }

  private var restingStyle: UIUserInterfaceStyle {
    launch?.rest == .pageBar ? look.barStyle : look.style
  }

  func present(_ launch: TrayLaunch, expectedKeyboard: CGFloat) {
    fallbackOpen?.cancel()
    if phase != .idle, let current = self.launch {
      if current.kind == launch.kind {
        if phase == .closing { reopen() }
        return
      }
      if phase != .closing, current.rest == launch.rest, current.morphs == launch.morphs {
        handOver(to: launch, expectedKeyboard: expectedKeyboard)
        return
      }
      animationToken += 1
      phase = .idle
      onClosed()
      reset()
    }
    guard phase == .idle else { return }
    self.launch = launch
    phase = .opening
    animationToken += 1
    view.layoutIfNeeded()

    let bounds = view.bounds
    let pillInView = view.convert(launch.pill, from: nil)
    let capsuleInView = launch.capsule.map { view.convert($0, from: nil) }
    capsuleAtRest = launch.morphs ? capsuleInView : nil
    if let capsuleInView {
      restHeight = max(bounds.maxY - capsuleInView.minY, BrowseLayout.barPillHeight)
    } else {
      restHeight = max(bounds.maxY - pillInView.minY + Self.pillTopInBar, BrowseLayout.barHeight)
    }
    let restTop = bounds.maxY - restHeight
    pillAtRest = launch.morphs ? pillInView.offsetBy(dx: 0, dy: -restTop) : .zero
    chevronAtRest = launch.chevron.map { view.convert($0, from: nil).offsetBy(dx: 0, dy: -restTop) }

    dimView.backgroundColor = UIColor.black.withAlphaComponent(launch.dims ? BrowseLayout.trayDim : 0)
    dimView.accessibilityLabel = launch.kind.dismissLabel
    install(launch)
    estimateField(for: launch.kind, width: bounds.width)

    view.accessibilityViewIsModal = true
    UIView.performWithoutAnimation {
      trayView.isHidden = false
      trayView.alpha = launch.morphs ? 1 : 0
      trayView.transform = .identity
      heldPin.isActive = false
      keyboardPin.isActive = true
      content?.view.layoutIfNeeded()
      let open = openLayout(forKeyboard: max(expectedKeyboard, keyboardOverlap))
      content?.height.constant = open.content
      view.layoutIfNeeded()
      content?.view.layoutIfNeeded()
      morph = launch.morphs ? 0 : 1
      progress.value = morph
      StagedFade(view: bodyMask, share: .results, rises: true).show(at: 1)
      for fade in stagedFades { fade.show(at: morph) }
      pill.plusGlyph.isHidden = !launch.morphs
      pill.style(for: launch.rest)
      showsBarMaterial(capsuleAtRest != nil)
      surfaceView.layer.removeAnimation(forKey: StagedFade.animationKey)
      surfaceView.alpha = 1
      panelFillView.alpha = 1
      pill.barFill.alpha = 0
      for fade in stagedFades { fade.show(at: morph) }
      if launch.morphs {
        styleControls(restingStyle)
        applyRest()
      } else {
        styleControls(look.style)
        applyOpen(trayHeight: open.tray)
        dimView.alpha = 0
      }
      view.layoutIfNeeded()
    }

    onPresented()
    focusFieldAndOpen(launch)
  }

  private func focusFieldAndOpen(_ launch: TrayLaunch) {
    if launch.focusesField, let field = textField, field.window != nil {
      field.becomeFirstResponder()
    }
    guard phase == .opening else { return }
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.phase == .opening else { return }
      self.animateOpen(launch.kind.openTiming, keyboard: self.keyboardOverlap)
    }
    fallbackOpen = work
    DispatchQueue.main.asyncAfter(deadline: .now() + (launch.focusesField ? Self.keyboardWait : 0), execute: work)
  }

  private func handOver(to next: TrayLaunch, expectedKeyboard: CGFloat) {
    guard let leaving = content else { return }
    launch = next
    phase = .opening
    animationToken += 1
    dimView.backgroundColor = UIColor.black.withAlphaComponent(next.dims ? BrowseLayout.trayDim : 0)
    dimView.accessibilityLabel = next.kind.dismissLabel

    chevronAtRest = nil
    removeLeavingContent()
    leavingContent = leaving
    content = nil
    leaving.view.isUserInteractionEnabled = false
    removeSides()
    installSides(next)
    installContent(next)
    estimateField(for: next.kind, width: view.bounds.width)

    UIView.performWithoutAnimation {
      content?.view.alpha = 0
      let open = openLayout(forKeyboard: max(expectedKeyboard, keyboardOverlap))
      content?.height.constant = open.content
      contentStage.layoutIfNeeded()
      content?.view.layoutIfNeeded()
      for fade in stagedFades { fade.show(at: morph) }
    }
    let arriving = content
    TrayTiming.contentSwap.animate({
      leaving.view.alpha = 0
      arriving?.view.alpha = 1
    }, completion: { [weak self] _ in
      guard let self, self.leavingContent?.host === leaving.host else { return }
      self.removeLeavingContent()
    })

    onPresented()
    focusFieldAndOpen(next)
  }

  func close() {
    fallbackOpen?.cancel()
    guard phase != .idle, phase != .closing, let launch else { return }
    phase = .closing
    let before = animationToken
    if let field = textField, field.isFirstResponder {
      field.resignFirstResponder()
    }
    guard animationToken == before else { return }
    animateClose(launch.kind.closeTiming)
  }

  private func reopen() {
    guard let launch else { return }
    phase = .opening
    if launch.focusesField, let field = textField {
      field.becomeFirstResponder()
    }
    if phase == .opening {
      animateOpen(launch.kind.openTiming, keyboard: keyboardOverlap)
    }
  }

  private func install(_ launch: TrayLaunch) {
    removeHosts()
    installContent(launch)
    contentStage.mask = launch.morphs ? contentMask : nil
    installSides(launch)
  }

  private func installContent(_ launch: TrayLaunch) {
    let host = makeHost(launch.content)
    let hosted = host.view!
    hosted.translatesAutoresizingMaskIntoConstraints = false
    contentStage.addSubview(hosted)
    let height = hosted.heightAnchor.constraint(equalToConstant: Self.aboveKeyboardPreferred)
    NSLayoutConstraint.activate([
      hosted.topAnchor.constraint(equalTo: contentStage.topAnchor),
      hosted.leadingAnchor.constraint(equalTo: contentStage.leadingAnchor),
      hosted.trailingAnchor.constraint(equalTo: contentStage.trailingAnchor),
      height,
    ])
    content = HostedContent(host: host, height: height)
  }

  private func installSides(_ launch: TrayLaunch) {
    guard launch.morphs, let sides = launch.sides, let capsule = capsuleAtRest else { return }
    let sidesHost = makeHost(AnyView(sides.frame(maxHeight: .infinity, alignment: .top)))
    let sidesView = sidesHost.view!
    sidesView.translatesAutoresizingMaskIntoConstraints = false
    sidesView.isUserInteractionEnabled = false
    sidesView.accessibilityElementsHidden = true
    trayView.insertSubview(sidesView, belowSubview: pill)
    NSLayoutConstraint.activate([
      sidesView.topAnchor.constraint(equalTo: trayView.topAnchor),
      sidesView.leadingAnchor.constraint(equalTo: trayView.leadingAnchor, constant: capsule.minX),
      sidesView.widthAnchor.constraint(equalToConstant: capsule.width),
      sidesView.heightAnchor.constraint(equalToConstant: capsule.height),
    ])
    self.sidesHost = sidesHost
  }

  private func makeHost(_ root: AnyView) -> UIHostingController<AnyView> {
    let host = UIHostingController(rootView: root)
    host.safeAreaRegions = []
    host.view.backgroundColor = .clear
    addChild(host)
    host.didMove(toParent: self)
    return host
  }

  private func detach(_ host: UIHostingController<AnyView>?) {
    guard let host else { return }
    host.willMove(toParent: nil)
    host.view.removeFromSuperview()
    host.removeFromParent()
  }

  private func removeSides() {
    detach(sidesHost)
    sidesHost = nil
  }

  private func removeLeavingContent() {
    detach(leavingContent?.host)
    leavingContent = nil
  }

  private func removeHosts() {
    detach(content?.host)
    content = nil
    removeSides()
    removeLeavingContent()
  }

  func reportContent(_ kind: TrayKind, fieldFrame: CGRect, contentTop: CGFloat) {
    guard fieldFrame.width > 0, kind == launch?.kind else { return }
    let moved = abs(fieldFrame.minX - self.fieldFrame.minX) > Self.fieldReportTolerance
      || abs(fieldFrame.minY - self.fieldFrame.minY) > Self.fieldReportTolerance
      || abs(fieldFrame.width - self.fieldFrame.width) > Self.fieldReportTolerance
      || abs(fieldFrame.height - self.fieldFrame.height) > Self.fieldReportTolerance
      || abs(contentTop - self.contentTop) > Self.fieldReportTolerance
    guard moved else { return }
    self.fieldFrame = fieldFrame
    self.contentTop = contentTop
    guard phase == .open else { return }
    UIView.performWithoutAnimation {
      layoutOpenControls()
      bodyMask.frame = bodyFrame
    }
  }

  private func estimateField(for kind: TrayKind, width: CGFloat) {
    let height = UIFontMetrics(forTextStyle: .title3).scaledValue(for: BrowseLayout.searchFieldHeight)
    let inset = BrowseLayout.searchFieldInset
    fieldFrame = CGRect(x: inset, y: BrowseLayout.trayFieldTop, width: width - inset - kind.fieldTrailingInset, height: height)
    contentTop = fieldFrame.maxY + Spacing.tight
  }

  private var bodyFrame: CGRect {
    CGRect(x: 0, y: contentTop, width: view.bounds.width, height: max((content?.height.constant ?? 0) - contentTop, 0) + 400)
  }

  private func openLayout(forKeyboard keyboard: CGFloat) -> (tray: CGFloat, content: CGFloat) {
    let safeTop = view.safeAreaInsets.top
    switch launch?.kind.height ?? .aboveKeyboard {
    case .aboveKeyboard:
      let scale = UIFontMetrics(forTextStyle: .title3).scaledValue(for: BrowseLayout.searchFieldHeight) - BrowseLayout.searchFieldHeight
      let preferred = Self.aboveKeyboardPreferred + scale
      let available = view.bounds.height - keyboard - safeTop - Spacing.tight
      let height = max(min(preferred, available), BrowseLayout.barHeight)
      return (height, height)
    case .fitsContent:
      let safeBottom = view.safeAreaInsets.bottom
      let available = view.bounds.height - safeTop - safeBottom - Spacing.tight
      let fitted = content?.host.sizeThatFits(in: CGSize(width: view.bounds.width, height: available)).height ?? available
      let height = max(min(fitted, available), BrowseLayout.barHeight)
      return (height + safeBottom, height)
    }
  }

  private func applyRest() {
    trayHeight.constant = restHeight
    if let capsule = capsuleAtRest {
      surfaceLeading.constant = capsule.minX
      surfaceTrailing.constant = capsule.maxX - view.bounds.maxX
      surfaceBottom.constant = capsule.maxY - view.bounds.maxY
      shapeSurface(radius: capsule.height / 2)
    } else {
      spanSurface()
      shapeSurface(radius: 0)
      shadowView.alpha = 0
    }
    dimView.alpha = 0
    pill.rest(at: pillAtRest)
    fieldMask.frame = pillAtRest
    fieldMask.layer.cornerRadius = pillAtRest.height / 2
    bodyMask.frame = bodyFrame
    if let chevronAtRest {
      chevron.alpha = 1
      chevron.place(at: CGPoint(x: chevronAtRest.midX, y: chevronAtRest.midY), pointsDown: false)
    }
  }

  private func applyOpen(trayHeight openHeight: CGFloat) {
    trayHeight.constant = openHeight
    spanSurface()
    shapeSurface(radius: BrowseLayout.sheetTopRadius)
    if capsuleAtRest == nil { shadowView.alpha = 1 }
    dimView.alpha = 1
    layoutOpenControls()
    bodyMask.frame = bodyFrame
  }

  private func spanSurface() {
    surfaceLeading.constant = 0
    surfaceTrailing.constant = 0
    surfaceBottom.constant = Self.surfaceBelowScreen
  }

  private func shapeSurface(radius: CGFloat) {
    surfaceView.layer.cornerRadius = radius
    shadowView.layer.cornerRadius = radius
    barGlass.cornerConfiguration = .uniformCorners(radius: .fixed(radius))
  }

  private func showsBarMaterial(_ shows: Bool) {
    barGlass.effect = shows ? UIGlassEffect(style: .regular) : nil
    pill.showsGlass(!shows)
    chevron.showsGlass(!shows)
  }

  private func layoutOpenControls() {
    pill.dock(in: fieldFrame)
    fieldMask.frame = fieldFrame
    fieldMask.layer.cornerRadius = fieldFrame.height / 2
    if let launch, launch.chevron != nil {
      let openX = view.bounds.width - (BrowseLayout.barSideInset - 4) - BrowseLayout.hitTarget / 2
      chevron.alpha = 1
      chevron.place(at: CGPoint(x: openX, y: fieldFrame.midY), pointsDown: true)
    } else {
      chevron.alpha = 0
    }
  }

  private var stagedFades: [StagedFade] {
    var fades = [
      StagedFade(view: pill.plusGlyph, share: .plusGlyph, rises: false),
      StagedFade(view: fieldMask, share: launch?.kind.fieldFade ?? .field, rises: true),
    ]
    if let bodyFade = launch?.kind.bodyFade {
      fades.append(StagedFade(view: bodyMask, share: bodyFade, rises: true))
    }
    if let sides = sidesHost?.view {
      fades.append(StagedFade(view: sides, share: .sides, rises: false))
    }
    if launch?.rest == .floating {
      fades.append(StagedFade(view: surfaceView, share: .surface, rises: true))
    }
    if capsuleAtRest != nil {
      fades.append(StagedFade(view: panelFillView, share: .material, rises: true))
      fades.append(StagedFade(view: shadowView, share: .material, rises: true))
      fades.append(StagedFade(view: pill.barFill, share: .pillMaterial, rises: false))
    }
    return fades
  }

  private var presentedMorph: CGFloat {
    let restWidth = pillAtRest.width
    let openWidth = fieldFrame.width
    guard abs(openWidth - restWidth) > 1 else { return morph }
    return min(max((pill.morphWidth - restWidth) / (openWidth - restWidth), 0), 1)
  }

  private func stageFades(from start: CGFloat, to end: CGFloat) {
    let template = pill.widthAnimation
    for fade in stagedFades {
      fade.stage(from: start, to: end, following: template)
    }
  }

  private func animateOpen(_ timing: TrayTiming, keyboard: CGFloat) {
    fallbackOpen?.cancel()
    guard let launch, let content else { return }
    phase = .open
    animationToken += 1
    let open = openLayout(forKeyboard: keyboard)
    content.height.constant = open.content
    if !launch.morphs {
      progress.value = 1
      TrayTiming.fade.animate {
        self.trayView.alpha = 1
        content.view.alpha = 1
        self.applyOpen(trayHeight: open.tray)
        self.view.layoutIfNeeded()
      }
      return
    }
    let start = presentedMorph
    morph = 1
    let token = animationToken
    timing.animate({
      self.heldPin.isActive = false
      self.keyboardPin.isActive = true
      self.trayView.transform = .identity
      self.styleControls(self.look.style)
      content.view.alpha = 1
      self.applyOpen(trayHeight: open.tray)
      self.view.layoutIfNeeded()
    }, completion: { [weak self] _ in
      guard let self, self.animationToken == token, self.phase == .open else { return }
      UIView.performWithoutAnimation { self.barGlass.effect = nil }
    })
    withAnimation(timing.swiftUI) { progress.value = 1 }
    stageFades(from: start, to: 1)
    if capsuleAtRest != nil {
      TrayTiming.pillGlass.animate {
        self.pill.showsGlass(true)
        self.chevron.showsGlass(true)
      }
    }
  }

  private func animateClose(_ timing: TrayTiming) {
    guard let launch else { return finish() }
    animationToken += 1
    let token = animationToken
    let completion: (Bool) -> Void = { [weak self] _ in
      guard let self, self.animationToken == token, self.phase == .closing else { return }
      self.finish()
    }
    if !launch.morphs {
      TrayTiming.fade.animate({
        self.trayView.alpha = 0
        self.dimView.alpha = 0
      }, completion: completion)
      return
    }
    let start = presentedMorph
    morph = 0
    if capsuleAtRest != nil {
      UIView.performWithoutAnimation { barGlass.effect = UIGlassEffect(style: .regular) }
      TrayTiming.pillGlass.animate {
        self.pill.showsGlass(false)
        self.chevron.showsGlass(false)
      }
    }
    timing.animate({
      self.heldPin.constant = 0
      self.trayView.transform = .identity
      self.styleControls(self.restingStyle)
      self.applyRest()
      self.view.layoutIfNeeded()
    }, completion: completion)
    withAnimation(timing.swiftUI) { progress.value = 0 }
    stageFades(from: start, to: 0)
  }

  private func finish() {
    phase = .idle
    view.accessibilityViewIsModal = false
    onClosed()
    let token = animationToken
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
      guard let self, self.phase == .idle, self.animationToken == token else { return }
      self.reset()
    }
  }

  private func reset() {
    view.accessibilityViewIsModal = false
    trayView.isHidden = true
    dimView.alpha = 0
    chevron.alpha = 0
    heldPin.isActive = false
    keyboardPin.isActive = true
    heldPin.constant = 0
    removeHosts()
    launch = nil
    chevronAtRest = nil
  }

  @objc private func dismissTapped() {
    guard isPresenting else { return }
    onDismissRequest()
  }

  @objc private func keyboardWillChange(_ notification: Notification) {
    guard let endFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect, let window = view.window else { return }
    let local = view.convert(endFrame, from: window.screen.coordinateSpace)
    let hides = notification.name == UIResponder.keyboardWillHideNotification
    let overlap = hides ? 0 : max(view.bounds.maxY - local.minY, 0)
    let previous = keyboardOverlap
    keyboardOverlap = overlap
    if overlap > Self.keyboardThreshold, abs(overlap - previous) > 1 { onKeyboardHeight(overlap) }
    guard let launch else { return }
    let timing = TrayTiming(keyboard: notification)
    switch phase {
    case .opening, .settling:
      guard overlap > Self.keyboardThreshold else { return }
      animateOpen(timing ?? launch.kind.openTiming, keyboard: overlap)
    case .open:
      if heldPin.isActive, overlap > Self.keyboardThreshold {
        animateOpen(timing ?? launch.kind.openTiming, keyboard: overlap)
        return
      }
      guard abs(overlap - previous) > 1, launch.kind.height == .aboveKeyboard, let content else { return }
      let open = openLayout(forKeyboard: overlap)
      content.height.constant = open.content
      (timing ?? launch.kind.openTiming).animate {
        self.trayHeight.constant = open.tray
        self.bodyMask.frame = self.bodyFrame
        self.view.layoutIfNeeded()
      }
    case .closing:
      guard previous > Self.keyboardThreshold, overlap <= Self.keyboardThreshold, keyboardPin.isActive else { return }
      animateClose(timing ?? launch.kind.closeTiming)
    case .idle, .dragging:
      return
    }
  }

  private var textField: CompletingTextField? {
    content?.view.firstSubview(of: CompletingTextField.self)
  }

  func dragChanged(translation: CGFloat) {
    switch phase {
    case .open, .settling, .dragging: break
    default: return
    }
    var released = false
    if case .dragging(let wasReleased) = phase { released = wasReleased }
    if !released, TrayDrag.releasesKeyboard(translation: translation), let field = textField, field.isFirstResponder {
      let lift = view.bounds.maxY - trayView.frame.maxY
      heldPin.constant = -lift
      keyboardPin.isActive = false
      heldPin.isActive = true
      view.layoutIfNeeded()
      released = true
      phase = .dragging(releasedKeyboard: true)
      field.resignFirstResponder()
    }
    phase = .dragging(releasedKeyboard: released)
    let offset = TrayDrag.offset(for: translation)
    let travel = max(view.bounds.maxY - trayView.frame.minY, 1)
    let share = TrayDrag.progress(offset: offset, travel: travel)
    UIView.performWithoutAnimation {
      trayView.transform = CGAffineTransform(translationX: 0, y: offset)
      dimView.alpha = 1 - share
    }
  }

  func dragEnded(translation: CGFloat, velocity: CGFloat) {
    guard case .dragging(let released) = phase else { return }
    if TrayDrag.shouldDismiss(translation: translation, velocity: velocity, trayHeight: trayHeight.constant) {
      onDismissRequest()
      return
    }
    phase = .settling
    guard released, let field = textField else { return settleWithoutKeyboard() }
    field.becomeFirstResponder()
    guard phase == .settling else { return }
    if keyboardOverlap > Self.keyboardThreshold, let launch {
      animateOpen(launch.kind.openTiming, keyboard: keyboardOverlap)
    } else {
      holdForKeyboard()
    }
  }

  private func holdForKeyboard() {
    UIView.animate(springDuration: 0.34, bounce: 0.14, initialSpringVelocity: 0, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      self.trayView.transform = .identity
      self.dimView.alpha = 1
    }
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.phase == .settling else { return }
      self.settleWithoutKeyboard()
    }
    fallbackOpen = work
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.keyboardWait, execute: work)
  }

  private func settleWithoutKeyboard() {
    phase = .open
    UIView.animate(springDuration: 0.34, bounce: 0.14, initialSpringVelocity: 0, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
      self.trayView.transform = .identity
      self.heldPin.constant = 0
      self.dimView.alpha = 1
      self.view.layoutIfNeeded()
    }
  }
}

final class TrayPassthroughView: UIView {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }
}

extension UIView {
  func firstSubview<View: UIView>(of type: View.Type) -> View? {
    for subview in subviews {
      if let match = subview as? View { return match }
      if let match = subview.firstSubview(of: type) { return match }
    }
    return nil
  }
}
