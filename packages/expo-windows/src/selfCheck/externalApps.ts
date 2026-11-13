import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { AppNative, DocumentsNative } from "@ardia/shell";
import { requireNativeModule } from "expo-modules-core";
import { windowsExternalApps } from "../engine/domains/externalApps";
import type { ExternalAppsModule } from "../nativeModuleTypes";
import { expectEqual, expectTrue, type Check } from "./check";

const apps = () => TurboModuleRegistry.getEnforcing<TurboModule & ExternalAppsModule>("ArdiaExternalApps");
const documents = () => TurboModuleRegistry.getEnforcing<TurboModule & DocumentsNative>("ArdiaDocuments");
const launchAsked = () => requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().test.externalAppLaunch === "1";

const LINKS_DOCUMENT = "external-app-links.txt";
const REFUSED_MARK = "! ";
const ORIGIN = "https://self-check.example";
const PROFILE = "self-check";
const PAGE = "self-check-page";

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
  {
    name: "with ARDIA_TEST=externalAppLaunch=1, each listed link asks with its handler, opens nothing on no and opens on yes",
    async run() {
      if (!launchAsked()) return;
      const lines = (documents().readDocument(LINKS_DOCUMENT) ?? "").split(/\r?\n/).filter(Boolean);
      expectTrue(lines.length > 0, `${LINKS_DOCUMENT} lists no links`);
      const gate = windowsExternalApps(apps, () => null, async () => true);
      let asked = 0;
      for (const line of lines) {
        const refused = line.startsWith(REFUSED_MARK);
        const url = refused ? line.slice(REFUSED_MARK.length) : line;
        const ask = (id: string) => gate.request({ id, url, origin: ORIGIN, userGesture: true, offTheRecord: false }, PROFILE, PAGE);
        const first = await ask(`no-${++asked}`);
        const scheme = first?.scheme ?? "(none)";
        console.info(`[ardia windows] self-check app link ${scheme}: ${first?.app ?? "no app"}, icon ${first?.icon ? "yes" : "no"}`);
        if (refused) {
          expectEqual(first?.app ?? null, null, `handler named for refused ${scheme}`);
          expectEqual(await gate.resolve(`no-${asked}`, true, false), false, `refused ${scheme} opened`);
          continue;
        }
        expectTrue(first?.app, `no handler named for ${scheme}`);
        expectEqual(await gate.resolve(`no-${asked}`, false, false), false, `${scheme} opened on no`);
        const second = await ask(`yes-${asked}`);
        expectEqual(await gate.resolve(second?.id ?? "", true, false), true, `${scheme} opened on yes`);
      }
    },
  },
];
