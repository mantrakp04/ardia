import ArdiaBrowser
import ArdiaDesign
import SwiftUI

struct PageRequestAlert: ViewModifier {
  let page: WebTab?

  @State private var text = ""
  @State private var user = ""
  @State private var password = ""

  func body(content: Content) -> some View {
    let request = page?.request.flatMap { $0.isAnswered ? nil : $0 }
    content
      .alert(
        request?.title ?? "",
        isPresented: Binding(
          get: { request != nil },
          set: { if !$0, let request, !request.isAnswered { request.dismiss() } }
        ),
        presenting: request
      ) { request in
        actions(for: request)
      } message: { request in
        if let message = request.message { Text(message) }
      }
      .onChange(of: request?.id) { _, _ in
        text = ""
        user = ""
        password = ""
        if case .prompt(_, let defaultText)? = request?.kind { text = defaultText }
      }
  }

  @ViewBuilder
  private func actions(for request: PageRequest) -> some View {
    switch request.kind {
    case .alert:
      Button("OK") { request.answer(.accepted) }
    case .confirm:
      Button("Cancel", role: .cancel) { request.answer(.dismissed) }
      Button("OK") { request.answer(.accepted) }
    case .prompt:
      TextField("", text: $text)
      Button("Cancel", role: .cancel) { request.answer(.dismissed) }
      Button("OK") { request.answer(.text(text)) }
    case .openExternal:
      Button("Cancel", role: .cancel) { request.answer(.dismissed) }
      Button("Open") { request.answer(.accepted) }
    case .httpAuthentication:
      TextField("User Name", text: $user)
        .textContentType(.username)
        .textInputAutocapitalization(.never)
      SecureField("Password", text: $password)
        .textContentType(.password)
      Button("Cancel", role: .cancel) { request.answer(.dismissed) }
      Button("Sign In") { request.answer(.credential(user: user, password: password)) }
    case .mediaCapture, .location:
      Button("Don’t Allow", role: .cancel) { request.answer(.dismissed) }
      Button("Allow") { request.answer(.accepted) }
    }
  }
}

struct PageFailureView: View {
  let failure: PageLoadFailure
  var onRetry: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: symbol)
    } description: {
      Text(message)
    } actions: {
      Button("Try Again", action: onRetry)
        .buttonStyle(.borderedProminent)
        .tint(.accentColor)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.background)
  }

  private var title: String {
    switch failure {
    case .crashed: String(localized: "This Webpage Couldn’t Load")
    case .network(let title, _): title
    }
  }

  private var message: String {
    switch failure {
    case .crashed: String(localized: "A problem repeatedly occurred on this page. Try again, or come back to it later.")
    case .network(_, let message): message
    }
  }

  private var symbol: String {
    switch failure {
    case .crashed: "exclamationmark.triangle"
    case .network(_, let message) where message.contains("internet"): "wifi.slash"
    case .network: "globe"
    }
  }
}

struct LoadingLine: View {
  let progress: Double
  let isLoading: Bool

  var body: some View {
    GeometryReader { proxy in
      Capsule()
        .fill(BrowsePalette.loadingBorder)
        .frame(width: proxy.size.width * max(progress, 0.08))
        .opacity(isLoading ? 1 : 0)
        .animation(.easeOut(duration: 0.25), value: progress)
        .animation(.easeOut(duration: 0.3).delay(isLoading ? 0 : 0.15), value: isLoading)
    }
    .frame(height: 2.5)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
