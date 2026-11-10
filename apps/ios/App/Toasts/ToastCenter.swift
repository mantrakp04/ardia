import Observation
import SwiftUI
import UIKit

@MainActor
@Observable
final class ToastCenter {
  private(set) var current: Toast?
  private(set) var isKeyboardVisible = false
  @ObservationIgnored private var dismissal: Task<Void, Never>?
  @ObservationIgnored private var isHeld = false
  @ObservationIgnored private var keyboardWatchers: [Task<Void, Never>] = []

  init() {
    keyboardWatchers = [
      Task { [weak self] in
        for await _ in NotificationCenter.default.notifications(named: UIResponder.keyboardWillShowNotification) {
          self?.keyboardChanged(visible: true)
        }
      },
      Task { [weak self] in
        for await _ in NotificationCenter.default.notifications(named: UIResponder.keyboardWillHideNotification) {
          self?.keyboardChanged(visible: false)
        }
      },
    ]
  }

  isolated deinit {
    keyboardWatchers.forEach { $0.cancel() }
  }

  func show(_ toast: Toast) {
    if let current, current.message == toast.message {
      scheduleDismissal(of: current.id, after: toast.duration)
      return
    }
    current = toast
    AccessibilityNotification.Announcement(toast.message).post()
    scheduleDismissal(of: toast.id, after: toast.duration)
  }

  func show(_ message: String, symbol: String) {
    show(Toast(message, symbol: symbol))
  }

  private func keyboardChanged(visible: Bool) {
    guard isKeyboardVisible != visible else { return }
    isKeyboardVisible = visible
  }

  func dismiss() {
    dismissal?.cancel()
    dismissal = nil
    isHeld = false
    current = nil
  }

  func hold(_ held: Bool) {
    guard let current else { return }
    isHeld = held
    if held {
      dismissal?.cancel()
    } else {
      scheduleDismissal(of: current.id, after: .seconds(1.2))
    }
  }

  func activate() {
    let action = current?.onTap
    dismiss()
    action?()
  }

  private func scheduleDismissal(of id: UUID, after duration: Duration) {
    dismissal?.cancel()
    guard !isHeld else { return }
    dismissal = Task { [weak self] in
      try? await Task.sleep(for: duration)
      guard !Task.isCancelled, let self, self.current?.id == id else { return }
      self.current = nil
    }
  }
}
