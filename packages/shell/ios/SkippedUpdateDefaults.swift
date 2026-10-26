import AppKit
import Sparkle

enum SkippedUpdateDefaults {
  static let keys = ["SUSkippedVersion", "SUSkippedMajorVersion", "SUSkippedMajorSubreleaseVersion"]

  static func unchanged(by answer: () -> Void) {
    let saved = keys.map { UserDefaults.standard.object(forKey: $0) }
    answer()
    DispatchQueue.main.async {
      for (key, value) in zip(keys, saved) { UserDefaults.standard.set(value, forKey: key) }
    }
  }
}
