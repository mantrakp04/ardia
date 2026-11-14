import ArdiaDesign
import Foundation

struct DemoLaunch: Equatable {
  let canvas: CGSize?
  let hinge: HingeState?
  let glassGallery: InterfaceStyle?

  static let current = DemoLaunch(arguments: ProcessInfo.processInfo.arguments)

  init(arguments: [String]) {
    func value(_ key: String) -> String? {
      guard let index = arguments.firstIndex(of: key), arguments.indices.contains(index + 1) else { return nil }
      return arguments[index + 1]
    }
    let demo = arguments.contains("-ArdiaDemo") || UserDefaults.standard.bool(forKey: "ArdiaDemo")
    canvas = demo ? value("-ArdiaCanvas").flatMap(CanvasArgument.size) : nil
    hinge = demo ? value("-ArdiaHinge").flatMap(HingeState.init(rawValue:)) : nil
    glassGallery = demo && arguments.contains("-ArdiaGlassGallery")
      ? value("-ArdiaGlassGallery").flatMap(InterfaceStyle.init(rawValue:)) ?? .glass
      : nil
  }
}
