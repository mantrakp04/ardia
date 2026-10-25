import Foundation
import Observation

public enum MediaCaptureKind: Sendable, Equatable {
  case camera
  case microphone
  case cameraAndMicrophone
}

@MainActor
@Observable
public final class PageRequest: Identifiable {
  public enum Kind: Equatable {
    case alert(message: String)
    case confirm(message: String)
    case prompt(message: String, defaultText: String)
    case openExternal(URL, app: ExternalApp)
    case httpAuthentication(realm: String?, isProxy: Bool, failedBefore: Bool)
    case mediaCapture(MediaCaptureKind)
    case location
  }

  public enum Answer: Sendable {
    case dismissed
    case accepted
    case text(String)
    case credential(user: String, password: String)
  }

  public let id = UUID()
  public let kind: Kind
  public let host: String
  public private(set) var isAnswered = false
  @ObservationIgnored private var completion: ((Answer) -> Void)?

  init(kind: Kind, host: String, completion: @escaping (Answer) -> Void) {
    self.kind = kind
    self.host = host
    self.completion = completion
  }

  public var title: String {
    switch kind {
    case .alert, .confirm, .prompt:
      host.isEmpty ? String(localized: "This Page Says") : host
    case .openExternal(_, let app):
      String(localized: "Open in “\(app.name)”?")
    case .httpAuthentication(_, let isProxy, _):
      isProxy ? String(localized: "Proxy Sign In") : String(localized: "Sign In to “\(host)”")
    case .mediaCapture(.camera):
      String(localized: "“\(host)” Would Like to Access the Camera")
    case .mediaCapture(.microphone):
      String(localized: "“\(host)” Would Like to Access the Microphone")
    case .mediaCapture(.cameraAndMicrophone):
      String(localized: "“\(host)” Would Like to Access the Camera and Microphone")
    case .location:
      String(localized: "“\(host)” Would Like to Use Your Current Location")
    }
  }

  public var message: String? {
    switch kind {
    case .alert(let message), .confirm(let message), .prompt(let message, _):
      message
    case .openExternal(let url, _):
      url.scheme == "tel" || url.scheme == "telprompt" ? url.absoluteString.replacingOccurrences(of: "telprompt:", with: "").replacingOccurrences(of: "tel:", with: "") : nil
    case .httpAuthentication(let realm, _, let failedBefore):
      failedBefore ? String(localized: "The user name or password you entered isn’t correct. Try again.") : realm.map { String(localized: "Your login information will be sent securely to “\($0)”.") }
    case .mediaCapture, .location:
      nil
    }
  }

  public func answer(_ answer: Answer) {
    guard let completion else { return }
    self.completion = nil
    isAnswered = true
    completion(answer)
  }

  public func dismiss() {
    answer(.dismissed)
  }

  isolated deinit {
    completion?(.dismissed)
  }
}
