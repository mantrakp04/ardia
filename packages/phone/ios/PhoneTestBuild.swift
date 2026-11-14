import Foundation

public enum PhoneTestBuild {
  public static let isOn = (Bundle.main.object(forInfoDictionaryKey: "ArdiaTestBuild") as? String)?.uppercased() == "YES"

  public static func flag(_ key: String) -> Bool {
    isOn && UserDefaults.standard.bool(forKey: key)
  }
}

func onMain(_ work: @escaping @MainActor () -> Void) {
  if Thread.isMainThread {
    MainActor.assumeIsolated(work)
  } else {
    DispatchQueue.main.async { MainActor.assumeIsolated(work) }
  }
}
