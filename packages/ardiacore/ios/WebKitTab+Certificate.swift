import CryptoKit
import Foundation
import Security

extension WebKitTab {
  static func certificate(_ trust: SecTrust) -> [String: Any]? {
    guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else { return nil }
    let keys = [kSecOIDX509V1SubjectName, kSecOIDX509V1IssuerName, kSecOIDX509V1ValidityNotBefore, kSecOIDX509V1ValidityNotAfter] as CFArray
    let values = SecCertificateCopyValues(leaf, keys, nil) as? [String: [String: Any]] ?? [:]
    func principal(_ oid: CFString) -> [String: Any] {
      let entries = values[oid as String]?[kSecPropertyKeyValue as String] as? [[String: Any]] ?? []
      func field(_ name: CFString) -> [String] {
        entries.filter { ($0[kSecPropertyKeyLabel as String] as? String) == name as String }.compactMap { $0[kSecPropertyKeyValue as String] as? String }
      }
      let common = field(kSecOIDCommonName).first ?? ""
      return ["commonName": common, "displayName": common, "organizations": field(kSecOIDOrganizationName), "country": field(kSecOIDCountryName).first ?? ""]
    }
    func date(_ oid: CFString) -> Double {
      guard let value = values[oid as String]?[kSecPropertyKeyValue as String] as? NSNumber else { return 0 }
      return (value.doubleValue + Date.timeIntervalBetween1970AndReferenceDate) * 1000
    }
    let der = SecCertificateCopyData(leaf) as Data
    let sha = SHA256.hash(data: der).map { String(format: "%02X", $0) }.joined(separator: " ")
    return [
      "subject": principal(kSecOIDX509V1SubjectName), "issuer": principal(kSecOIDX509V1IssuerName),
      "validFrom": date(kSecOIDX509V1ValidityNotBefore), "validUntil": date(kSecOIDX509V1ValidityNotAfter),
      "sha256": sha, "chainLength": chain.count,
    ]
  }
}
