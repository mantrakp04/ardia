import Foundation
import Security

protocol AccessGroupMover {
  func entitled(to groups: [String]) -> Bool
  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?)
}

struct KeychainAccessGroups: AccessGroupMover {
  static let suffixes = ["webauthn", "unexportable-keys", "secure-payment-confirmation"]

  func entitled(to groups: [String]) -> Bool {
    guard let task = SecTaskCreateFromSelf(nil),
      let value = SecTaskCopyValueForEntitlement(task, "keychain-access-groups" as CFString, nil) as? [String] else { return false }
    return groups.allSatisfy(value.contains)
  }

  func move(from old: String, to new: String) -> (moved: Int, failure: OSStatus?) {
    var moved = 0
    var failure: OSStatus?
    for itemClass in [kSecClassKey, kSecClassGenericPassword] {
      let query: [String: Any] = [
        kSecClass as String: itemClass, kSecAttrAccessGroup as String: old, kSecUseDataProtectionKeychain as String: true,
      ]
      var count = query
      count[kSecMatchLimit as String] = kSecMatchLimitAll
      count[kSecReturnAttributes as String] = true
      var found: CFTypeRef?
      let status = SecItemCopyMatching(count as CFDictionary, &found)
      if status == errSecItemNotFound { continue }
      guard status == errSecSuccess else {
        failure = status
        continue
      }
      let items = ((found as? [[String: Any]]) ?? []).filter { $0[kSecAttrAccessGroup as String] as? String == old }
      guard !items.isEmpty else { continue }
      let updated = SecItemUpdate(query as CFDictionary, [kSecAttrAccessGroup as String: new] as CFDictionary)
      if updated == errSecSuccess { moved += items.count } else { failure = updated }
    }
    return (moved, failure)
  }
}
