import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { ExternalAppsModule } from "../nativeModuleTypes";
import { expectEqual, type Check } from "./check";

const apps = () => TurboModuleRegistry.getEnforcing<TurboModule & ExternalAppsModule>("ArdiaExternalApps");

const UNHANDLED = "ardia-self-check-unhandled";
const REFUSED_SCHEMES = ["http", "https", "file", "c", "MailTo", "", "a b", "txtfile", UNHANDLED];
const REFUSED_LINKS = ["http://example.com/", "file:///C:/Windows/notepad.exe", "c:\\Windows\\notepad.exe", "\\\\server\\share\\x.exe", "txtfile:x", `${UNHANDLED}:x`, "no scheme"];

export const checks: Check[] = [
  {
    name: "ArdiaExternalApps.describe names no handler for browser, drive-letter, file-type or unknown schemes",
    async run() {
      const described: Record<string, unknown> = {};
      for (const scheme of REFUSED_SCHEMES) described[scheme] = await apps().describe(scheme);
      expectEqual(described, Object.fromEntries(REFUSED_SCHEMES.map((scheme) => [scheme, null])), "handlers described");
    },
  },
  {
    name: "ArdiaExternalApps.open refuses browser, drive-letter, path, file-type and unknown links",
    async run() {
      const opened: Record<string, boolean> = {};
      for (const link of REFUSED_LINKS) opened[link] = await apps().open(link);
      expectEqual(opened, Object.fromEntries(REFUSED_LINKS.map((link) => [link, false])), "links opened");
    },
  },
];
