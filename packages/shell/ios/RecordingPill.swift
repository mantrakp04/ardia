import AppKit
import SwiftUI

final class RecordingPill {
  private final class Model: ObservableObject {
    @Published var seconds = 0
  }

  private final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
  }

  private struct Pill: View {
    @ObservedObject var model: Model
    let onStop: () -> Void

    var body: some View {
      HStack(spacing: 10) {
        Circle().fill(Color(nsColor: .systemRed)).frame(width: 8, height: 8)
        HStack(spacing: 6) {
          Text("Recording")
          Text("\(model.seconds / 60):\(String(format: "%02d", model.seconds % 60))").monospacedDigit().foregroundStyle(.white.opacity(0.7))
        }
        Button(action: onStop) {
          HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 1.5).frame(width: 8, height: 8)
            Text("Stop").fontWeight(.semibold)
          }
          .padding(.horizontal, 10)
          .frame(height: 24)
          .background(Capsule().fill(Color.white.opacity(0.16)))
          .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Stop recording")
      }
      .font(.system(size: 13, weight: .medium))
      .foregroundStyle(.white)
      .fixedSize()
      .padding(.leading, 14)
      .padding(.trailing, 4)
      .frame(height: 32)
      .background(Capsule().fill(Color.black.opacity(0.82)))
      .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5))
      .padding(8)
    }
  }

  private static let topInset: CGFloat = 10

  private let model = Model()
  private let panel: Panel
  private weak var parent: NSWindow?
  private var moveObserver: NSObjectProtocol?
  private var resizeObserver: NSObjectProtocol?

  init(over window: NSWindow, onStop: @escaping () -> Void) {
    parent = window
    panel = Panel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
    panel.appearance = window.effectiveAppearance
    panel.contentView = NSHostingView(rootView: Pill(model: model, onStop: onStop))
    let center = NotificationCenter.default
    moveObserver = center.addObserver(forName: NSWindow.didMoveNotification, object: window, queue: .main) { [weak self] _ in self?.place() }
    resizeObserver = center.addObserver(forName: NSWindow.didResizeNotification, object: window, queue: .main) { [weak self] _ in self?.place() }
  }

  deinit {
    for token in [moveObserver, resizeObserver].compactMap({ $0 }) { NotificationCenter.default.removeObserver(token) }
  }

  var frame: NSRect { panel.frame }
  var window: NSWindow { panel }

  func show() {
    place()
    parent?.addChildWindow(panel, ordered: .above)
    panel.orderFront(nil)
  }

  func update(seconds: Double) {
    let whole = Int(seconds.rounded(.down))
    guard whole != model.seconds else { return }
    model.seconds = whole
    place()
  }

  func snapshot(to path: String) -> [String: Double]? {
    guard let view = panel.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
    view.cacheDisplay(in: view.bounds, to: rep)
    guard let png = rep.representation(using: .png, properties: [:]), (try? png.write(to: URL(fileURLWithPath: path))) != nil else { return nil }
    let fitting = view.fittingSize
    return ["width": panel.frame.width, "height": panel.frame.height, "fittingWidth": fitting.width, "fittingHeight": fitting.height,
      "x": panel.frame.minX - (parent?.frame.minX ?? 0), "top": (parent?.frame.maxY ?? 0) - panel.frame.maxY]
  }

  func close() {
    parent?.removeChildWindow(panel)
    panel.orderOut(nil)
  }

  private func place() {
    guard let parent, let content = panel.contentView else { return }
    let size = content.fittingSize
    let x = (parent.frame.midX - size.width / 2).rounded()
    let y = (parent.frame.maxY - Self.topInset - size.height).rounded()
    panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
  }
}
