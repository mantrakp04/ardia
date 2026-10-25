import Foundation

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

enum SymbolCatalog {
  static func exists(_ name: String) -> Bool {
    #if canImport(UIKit)
      UIImage(systemName: name) != nil
    #elseif canImport(AppKit)
      NSImage(systemSymbolName: name, accessibilityDescription: nil) != nil
    #else
      true
    #endif
  }
}
