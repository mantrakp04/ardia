import type { PopupProtectedMedia } from "../../platform/performance";

// A page in a popup window (Audible's cloud player, issue #958) asked for protected media and was refused or stalled.
// The popup has no prompt to offer WebKit, so this only counts how often it happens, by key-system family and by whether
// the popup's host is on the streaming-site list. Never which page, host or title.
const FAMILIES = ["widevine", "playready", "fairplay", "other"] as const;
type Family = (typeof FAMILIES)[number];

const none = () => Object.fromEntries(FAMILIES.flatMap((family) => [[`${family}:listed`, 0], [`${family}:unlisted`, 0]])) as Record<string, number>;

let pending = none();

export function notePopupProtectedMedia(media: PopupProtectedMedia | undefined) {
  const family: Family = FAMILIES.find((candidate) => candidate === media?.family) ?? "other";
  pending[`${family}:${media?.listed === true ? "listed" : "unlisted"}`] += 1;
}

export function takePopupProtectedMediaCounts() {
  const taken = pending;
  pending = none();
  return {
    popup_protected_media_refused_widevine_listed: taken["widevine:listed"],
    popup_protected_media_refused_widevine_unlisted: taken["widevine:unlisted"],
    popup_protected_media_refused_playready_listed: taken["playready:listed"],
    popup_protected_media_refused_playready_unlisted: taken["playready:unlisted"],
    popup_protected_media_refused_fairplay_listed: taken["fairplay:listed"],
    popup_protected_media_refused_fairplay_unlisted: taken["fairplay:unlisted"],
    popup_protected_media_refused_other_listed: taken["other:listed"],
    popup_protected_media_refused_other_unlisted: taken["other:unlisted"],
  };
}
