import { isWebPageUrl } from "../../lib/url";

export type ExternalLinkOpen = "tab" | "littleArdia" | "window";

export function externalLinkOpen(littleArdiaOn: boolean, urls: readonly string[], ruled: ExternalLinkOpen | null = null): ExternalLinkOpen {
  if (ruled) return ruled;
  const [url] = urls;
  return littleArdiaOn && urls.length === 1 && !!url && isWebPageUrl(url) ? "littleArdia" : "tab";
}
