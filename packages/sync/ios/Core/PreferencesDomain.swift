import Foundation

struct PreferencesDomain {
  let id: String

  func all() -> [String: Any] {
    guard let keys = CFPreferencesCopyKeyList(id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) as? [String],
      !keys.isEmpty else { return [:] }
    return (CFPreferencesCopyMultiple(keys as CFArray, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
      as? [String: Any]) ?? [:]
  }

  func has(_ key: String) -> Bool {
    CFPreferencesCopyValue(key as CFString, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost) != nil
  }

  @discardableResult
  func set(_ values: [String: Any]) -> Bool {
    guard !values.isEmpty else { return true }
    CFPreferencesSetMultiple(values as CFDictionary, nil, id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
    return CFPreferencesSynchronize(id as CFString, kCFPreferencesCurrentUser, kCFPreferencesAnyHost)
  }
}
