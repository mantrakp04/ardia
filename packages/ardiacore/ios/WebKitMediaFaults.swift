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
    "eme_widevine_legacy_supported",
    "eme_widevine_legacy_unsupported",
    "eme_playready_legacy_supported",
    "eme_playready_legacy_unsupported",
    "eme_fairplay_legacy_supported",
    "eme_fairplay_legacy_unsupported",
    "eme_other_legacy_supported",
    "eme_other_legacy_unsupported",
    "eme_legacy_key_error_unknown",
    "eme_legacy_key_error_client",
    "eme_legacy_key_error_service",
    "eme_legacy_key_error_output",
    "eme_legacy_key_error_hardware_change",
    "eme_legacy_key_error_domain",
    "media_error_aborted",
    "media_error_network",
    "media_error_decode",
    "media_error_src_not_supported",
    "play_rejected_not_allowed",
    "play_rejected_not_supported",
    "play_rejected_abort",
    "play_rejected_other",
  ]

  static let pageScript = #"""
  const getter = (proto, name) => {
    const d = proto && Object.getOwnPropertyDescriptor(proto, name);
    return d && d.get;
  };
  const read = (get, target) => (typeof get === "function" ? apply(get, target, []) : undefined);
  const nameOf = getter(DOMException.prototype, "name");
  const targetOf = getter(Event.prototype, "target");
  const mediaErrorOf = getter(HTMLMediaElement.prototype, "error");
  const mediaErrorCodeOf = getter(MediaError.prototype, "code");
  const errorName = (error) => (error instanceof DOMException ? read(nameOf, error) : "");
  const refusal = (error) => {
    switch (errorName(error)) {
      case "NotSupportedError":
        return "not_supported";
      case "SecurityError":
        return "security";
      case "NotAllowedError":
        return "not_allowed";
      default:
        return "other";
    }
  };
  const playRejection = (error) => {
    switch (errorName(error)) {
      case "NotAllowedError":
        return "not_allowed";
      case "NotSupportedError":
        return "not_supported";
      case "AbortError":
        return "abort";
      default:
        return "other";
    }
  };
  const keySystem = (name) => {
    if (typeof name !== "string") return "other";
    if (name.startsWith("com.widevine.alpha")) return "widevine";
    if (name.startsWith("com.microsoft.playready")) return "playready";
    if (name.startsWith("com.apple.fps")) return "fairplay";
    return "other";
  };
  const mediaError = (code) => {
    switch (code) {
      case 1:
        return "media_error_aborted";
      case 2:
        return "media_error_network";
      case 3:
        return "media_error_decode";
      case 4:
        return "media_error_src_not_supported";
      default:
        return null;
    }
  };
  const requestAccess = Navigator.prototype.requestMediaKeySystemAccess;
  if (watched && typeof requestAccess === "function") {
    Navigator.prototype.requestMediaKeySystemAccess = function (name, configurations) {
      const result = apply(requestAccess, this, arguments);
      if (!(result instanceof NativePromise)) return result;
      const system = keySystem(name);
      return observe(
        result,
        () => fault("eme_" + system + "_granted"),
        (error) => fault("eme_" + system + "_refused_" + refusal(error)),
      );
    };
  }
  const LegacyKeys = window.WebKitMediaKeys;
  const legacySessionErrorOf = getter(window.WebKitMediaKeySession && WebKitMediaKeySession.prototype, "error");
  const legacyErrorCodeOf = getter(window.WebKitMediaKeyError && WebKitMediaKeyError.prototype, "code");
  const legacyKeyErrors = [null, "unknown", "client", "service", "output", "hardware_change", "domain"];
  const reportLegacyKeyError = (e) => {
    try {
      const error = read(legacySessionErrorOf, read(targetOf, e));
      const name = error && legacyKeyErrors[read(legacyErrorCodeOf, error)];
      if (name) fault("eme_legacy_key_error_" + name);
    } catch (err) {}
  };
  if (watched && typeof LegacyKeys === "function") {
    const isTypeSupported = LegacyKeys.isTypeSupported;
    if (typeof isTypeSupported === "function") {
      LegacyKeys.isTypeSupported = function (name) {
        const supported = apply(isTypeSupported, this, arguments);
        try {
          const reason = "eme_" + keySystem(name) + "_legacy_" + (supported ? "supported" : "unsupported");
          if (!reported[reason]) fault(reason);
        } catch (e) {}
        return supported;
      };
    }
    const createSession = LegacyKeys.prototype && LegacyKeys.prototype.createSession;
    if (typeof createSession === "function") {
      LegacyKeys.prototype.createSession = function () {
        const session = apply(createSession, this, arguments);
        try {
          if (session) apply(listen, session, ["webkitkeyerror", reportLegacyKeyError]);
        } catch (e) {}
        return session;
      };
    }
  }
  function reportMediaError(e) {
    try {
      if (errorEventsCounted.has(e)) return;
      errorEventsCounted.add(e);
      const target = read(targetOf, e);
      if (!(target instanceof HTMLMediaElement)) return;
      const error = read(mediaErrorOf, target);
      const reason = error && mediaError(read(mediaErrorCodeOf, error));
      if (reason) fault(reason);
    } catch (err) {}
  }
  if (watched) apply(listen, doc, ["error", reportMediaError, true]);
"""#

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
