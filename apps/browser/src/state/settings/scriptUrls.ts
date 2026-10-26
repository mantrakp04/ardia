import { resolveInput } from "@ardia/core";
import { fromLegacyUrl } from "../../lib/legacy";
import { searchUrlPrefix, type Settings } from "./settings";

const asChromiumSeesIt = (url: string) => url.replace(/^[\u0000- ]+/, "").replace(/[\t\n\r]/g, "");

export function runsJavaScript(input: string, settings: Settings): boolean {
  const resolved = resolveInput(fromLegacyUrl(input.trim()), searchUrlPrefix(settings));
  return [input, resolved].some((url) => /^javascript:/i.test(asChromiumSeesIt(url)));
}

export const JAVASCRIPT_FROM_APPLE_EVENTS_REFUSED = { refused: "javaScriptFromAppleEvents" } as const;
