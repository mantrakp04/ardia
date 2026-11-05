import { cancelDownload } from "../../platform/downloads";
import { endWebKitPrivateSession } from "../../platform/webkit";
import { useBrowser, type BrowserState } from "../browser/store";
import { privateSession } from "../browser/model";
import { downloadSession } from "../downloads/downloadsSlice";

function endClosedPrivateSessions(s: BrowserState, prev: BrowserState) {
  for (const w of Object.values(prev.windows)) {
    if (w.kind !== "private" || s.windows[w.id]) continue;
    const session = privateSession(s, w.profileId);
    if (Object.values(s.windows).some((o) => o.kind === "private" && privateSession(s, o.profileId) === session)) continue;
    for (const d of s.downloads) if (downloadSession(s, d) === session && d.state === "downloading") void cancelDownload(d.id);
    s.forgetDownloads(w.profileId);
    if (session !== null) void endWebKitPrivateSession(session);
  }
}

export const startPrivateSessions = () =>
  useBrowser.subscribe((s, prev) => {
    if (s.windows !== prev.windows) endClosedPrivateSessions(s, prev);
  });
