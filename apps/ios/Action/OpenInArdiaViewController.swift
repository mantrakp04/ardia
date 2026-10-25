import ArdiaDesign
import SwiftUI
import UIKit

final class OpenInArdiaViewController: UIViewController {
  private var didStart = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didStart else { return }
    didStart = true
    Task { await openPage() }
  }

  private func openPage() async {
    let page = await SharedPage.read(from: extensionContext)
    guard let url = page.url else {
      show(OpenFallbackView(message: String(localized: "There’s no web page to open."), done: finish))
      return
    }
    if ContainingApp.open(SystemLink.open(url).url, from: self) {
      finish()
      return
    }
    SystemStore.shared?.enqueue(SystemInboxItem(action: .open, url: url.absoluteString, title: page.title))
    show(OpenFallbackView(message: String(localized: "This page opens the next time you open Ardia."), done: finish))
  }

  private func show(_ content: OpenFallbackView) {
    let host = UIHostingController(rootView: content)
    host.view.backgroundColor = .clear
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}

struct OpenFallbackView: View {
  let message: String
  let done: () -> Void

  var body: some View {
    ZStack(alignment: .bottom) {
      Color.black.opacity(0.32)
        .ignoresSafeArea()
        .onTapGesture(perform: done)
        .accessibilityHidden(true)
      card
    }
  }

  private var card: some View {
    VStack(spacing: Spacing.medium) {
      ArdiaLogoMark()
        .frame(width: 64, height: 52)
      Text(message)
        .font(.headline)
        .multilineTextAlignment(.center)
        .foregroundStyle(BrowsePalette.foregroundPrimary)
      Button(action: done) {
        Text("Done")
          .font(.headline)
          .frame(maxWidth: .infinity, minHeight: 50)
      }
      .buttonStyle(.glassProminent)
      .tint(Palette.indigo)
    }
    .padding(Spacing.large)
    .frame(maxWidth: .infinity)
    .background {
      UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous)
        .fill(BrowsePalette.popover)
        .ignoresSafeArea(edges: .bottom)
    }
  }
}

#Preview("Fallback") {
  OpenFallbackView(message: "This page opens the next time you open Ardia.", done: {})
}
