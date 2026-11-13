import SwiftUI

public enum BarInk {
  public static func scheme(pageIsDark: Bool?, systemIsDark: Bool) -> ColorScheme {
    (pageIsDark ?? systemIsDark) ? .dark : .light
  }
}
