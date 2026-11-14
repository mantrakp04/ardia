import { formatUrl, urlParts } from "../../lib/urlParts";
import type { LinkSource } from "../../lib/linkSource";
import { useBrowser } from "../browser/store";
import { externalLinkOpen } from "../littleArdia/externalLinkOpen";
import { lastActiveProfile } from "../windows/small";
import { traceLink, type LinkTrace } from "../automation/decisions";
import type { OpenAs } from "./rules";

export type LinkPreview =
  | { ok: false }
  | { ok: true; url: string; trace: LinkTrace; dropped: boolean; profileName: string; usedLast: boolean; open: OpenAs };

export function previewUrl(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const parts = urlParts(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  return parts ? formatUrl(parts) : null;
}

export function previewLink(typed: string, source: LinkSource): LinkPreview {
  const url = previewUrl(typed);
  if (!url) return { ok: false };
  const trace = traceLink(url, source);
  const s = useBrowser.getState();
  const settled = trace.by === "program" ? trace.otherwise : trace;
  const decided = settled.by === "usual" ? null : settled.verdict;
  if (decided && "drop" in decided) return { ok: true, url, trace, dropped: true, profileName: "", usedLast: false, open: "tab" };
  const profileId = decided?.profileId ?? lastActiveProfile(s);
  const open = externalLinkOpen(s.settings.openLinksInLittleArdia, [url], decided?.open ?? null);
  return { ok: true, url, trace, dropped: false, profileName: s.profiles[profileId]?.name ?? "", usedLast: !decided?.profileId, open };
}
