import type { SharedListingLevel } from "../../platform/sharedFolders";
import { parseWebloc, weblocLinkId } from "../../lib/webloc";
import { manifestIsNewer, parseManifest, type RemoteEntry, type RemoteLevel } from "./tree";

export function isShareableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function remoteLevel(level: SharedListingLevel): RemoteLevel {
  if (level.error) throw new Error(level.error);
  return {
    entries: level.entries.map((e): RemoteEntry => {
      if (e.kind === "dir") return { kind: "dir", file: e.file, level: remoteLevel(e.level) };
      if (e.kind === "pending") return { kind: "held", file: e.file, waiting: e.reason === "download" };
      const url = parseWebloc(e.text);
      return url && isShareableUrl(url) ? { kind: "link", file: e.file, url, id: weblocLinkId(e.text) } : { kind: "held", file: e.file, waiting: false };
    }),
    manifest: parseManifest(level.manifest),
    manifestPending: level.manifestPending || manifestIsNewer(level.manifest),
  };
}
