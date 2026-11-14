import SwiftUI

enum DuoCanvas {
  enum Mode: String {
    case open
    case half
  }

  static let openSize = CGSize(width: 669, height: 951)
  static let foldBand: CGFloat = 20

  static let mode: Mode? = {
    #if DEBUG
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-ArdiaDuoCanvas"), arguments.indices.contains(index + 1) else { return nil }
    return Mode(rawValue: arguments[index + 1])
    #else
    return nil
    #endif
  }()

  static func forcedLayout(for space: ScreenSpace) -> ScreenLayout? {
    switch mode {
    case nil: nil
    case .open: .wide
    case .half:
      .split(ScreenLayout.Fold(top: (space.size.height - foldBand) / 2, bottom: (space.size.height + foldBand) / 2))
    }
  }
}

struct DuoCanvasFrame: ViewModifier {
  func body(content: Content) -> some View {
    if DuoCanvas.mode != nil {
      content
        .frame(width: DuoCanvas.openSize.width, height: DuoCanvas.openSize.height)
        .clipShape(.rect(cornerRadius: 40, style: .continuous))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
        .ignoresSafeArea()
    } else {
      content
    }
  }
}
