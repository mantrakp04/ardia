import WebKit

enum WebKitMediaFaults {
  static let sites = [
    "netflix.com",
    "disneyplus.com",
    "max.com",
    "hbomax.com",
    "primevideo.com",
    "hulu.com",
    "tv.apple.com",
    "music.apple.com",
    "open.spotify.com",
    "peacocktv.com",
    "paramountplus.com",
    "crunchyroll.com",
    "hotstar.com",
    "jiohotstar.com",
    "v.qq.com",
  ]

  static let reasons: Set<String> = [
    "eme_widevine_granted",
    "eme_widevine_refused_not_supported",
    "eme_widevine_refused_security",
    "eme_widevine_refused_not_allowed",
    "eme_widevine_refused_other",
    "eme_playready_granted",
    "eme_playready_refused_not_supported",
    "eme_playready_refused_security",
    "eme_playready_refused_not_allowed",
    "eme_playready_refused_other",
    "eme_fairplay_granted",
    "eme_fairplay_refused_not_supported",
    "eme_fairplay_refused_security",
    "eme_fairplay_refused_not_allowed",
    "eme_fairplay_refused_other",
    "eme_other_granted",
    "eme_other_refused_not_supported",
    "eme_other_refused_security",
    "eme_other_refused_not_allowed",
    "eme_other_refused_other",
    "media_error_aborted",
    "media_error_network",
    "media_error_decode",
    "media_error_src_not_supported",
    "play_rejected_not_allowed",
    "play_rejected_not_supported",
    "play_rejected_abort",
    "play_rejected_other",
  ]

  static let sitesJSON = "[" + sites.map { "\"\($0)\"" }.joined(separator: ",") + "]"

  static func isStreamingSite(host: String) -> Bool {
    sites.contains { host == $0 || host.hasSuffix(".\($0)") }
  }

  static func event(_ data: [String: Any]?, from frame: WKFrameInfo, muted: Bool, blockerActive: Bool) -> [String: Any]? {
    let origin = frame.securityOrigin
    guard let reason = data?["reason"] as? String, reasons.contains(reason),
      origin.protocol == "https", isStreamingSite(host: origin.host.lowercased()) else { return nil }
    return ["reason": reason, "muted": muted, "blockerActive": blockerActive]
  }
}
