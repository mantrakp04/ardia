import { createElement } from "react";
import { shell } from "../../platform/devShell";
import { readDocument, writeDocument } from "../../platform/documents";
import { DEV_EVAL_RESULT, watchDevEval } from "../../lib/devEval";
import { omniboxDrivers } from "../omnibox/devDriver";
import { pagesDrivers } from "../pages/devDrivers";
import { usePages } from "../../state/tabs/pageState";
import { openSettings } from "../../state/settings/settingsWindows";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { useBrowser } from "../../state/browser/store";
import * as actions from "../../state/browser/actions";
import { runCommand } from "../../state/commands/commands";
import * as favicons from "../../state/favicons/favicons";
import { probeStore } from "../../state/app/perfProbe";
import { useLifecycle } from "../../state/tabs/tabLifecycle";
import { webviews } from "../../platform/webviews";
import { call, on } from "../../platform/engine";

export function startDevHarness() {
  probeStore("pages", usePages);
  probeStore("sidebarUi", useSidebarUi);
  probeStore("favicons", favicons.useFavicons);
  probeStore("lifecycle", useLifecycle);
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        const line = `${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(" ")}\n`;
        writeDocument("dev-console.log", (readDocument("dev-console.log") ?? "").slice(-200_000) + line);
      } catch {}
    };
  }

  const ac = {
    store: useBrowser, actions, runCommand, webviews, shell, engine: { call, on }, omnibox: omniboxDrivers, pages: pagesDrivers,
    pageState: usePages,
    openSettings,
    favicons,
    get bookmarks(): typeof import("../../state/bookmarks/bookmarks") {
      return require("../../state/bookmarks/bookmarks");
    },
    get history(): typeof import("../../state/history/history") {
      return require("../../state/history/history");
    },
    get checkIn(): typeof import("../../state/onboarding/defaultBrowserCheckIn") {
      return require("../../state/onboarding/defaultBrowserCheckIn");
    },
    get media(): typeof import("../../state/media/media").useMedia {
      return require("../../state/media/media").useMedia;
    },
    get permissions(): typeof import("../../state/site/permissions") {
      return require("../../state/site/permissions");
    },
    get translate(): typeof import("../../state/site/translate") {
      return require("../../state/site/translate");
    },
    get peek(): typeof import("../../state/peek/actions") {
      return require("../../state/peek/actions");
    },
    get toasts(): typeof import("../../state/app/toasts").useToasts {
      return require("../../state/app/toasts").useToasts;
    },
    get extensions(): typeof import("../../state/extensions/actions") {
      return require("../../state/extensions/actions");
    },
    get themes(): typeof import("../../state/import/apply") & typeof import("../settings/ThemeEditor") {
      return { ...require("../../state/import/apply"), ...require("../settings/ThemeEditor") };
    },
    get bangs(): typeof import("../../state/omnibox/bangs") {
      return require("../../state/omnibox/bangs");
    },
    get switcher(): typeof import("../../state/sidebar/switcher") {
      return require("../../state/sidebar/switcher");
    },
    get sidebarRows(): typeof import("../../state/sidebar/sidebarUi") {
      return require("../../state/sidebar/sidebarUi");
    },
    get sidebarHover(): typeof import("../../state/sidebar/hover") & typeof import("../sidebar/hoverMotion") {
      return { ...require("../../state/sidebar/hover"), ...require("../sidebar/hoverMotion") };
    },
    get windowLayout(): typeof import("../../state/windows/layout") {
      return require("../../state/windows/layout");
    },
    get toolbarAutoHide(): typeof import("../../state/windows/toolbarAutoHide") {
      return require("../../state/windows/toolbarAutoHide");
    },
    get hoverShift(): typeof import("../ui/hoverShift") {
      return require("../ui/hoverShift");
    },
    get settingsSearch(): typeof import("../../state/settings/searchState") & typeof import("../settings/SettingsSearch") & typeof import("../settings/anchors") {
      return { ...require("../../state/settings/searchState"), ...require("../settings/SettingsSearch"), ...require("../settings/anchors") };
    },
    get settingsNav(): typeof import("../../state/settings/settingsWindows").useSettingsNav {
      return require("../../state/settings/settingsWindows").useSettingsNav;
    },
    get preload(): typeof import("../../state/tabs/prewarm") {
      return require("../../state/tabs/prewarm");
    },
    get syncSheets(): typeof import("../settings/panes/SyncSheets") {
      return require("../settings/panes/SyncSheets");
    },
    get menus(): typeof import("../../state/sidebar/menus") &
      typeof import("../../state/site/reloadMenu") &
      typeof import("../profiles/profileMenu") &
      typeof import("../../state/bookmarks/bookmarkMenus") &
      typeof import("../../state/bookmarks/barMenus") &
      typeof import("../../state/history/historyMenus") &
      typeof import("../../state/downloads/downloadMenu") &
      typeof import("../../platform/clipboard") & { useBookmarkDialog: typeof import("../../state/bookmarks/actions").useBookmarkDialog } {
      return {
        useBookmarkDialog: require("../../state/bookmarks/actions").useBookmarkDialog,
        ...require("../../state/sidebar/menus"),
        ...require("../../state/site/reloadMenu"),
        ...require("../profiles/profileMenu"),
        ...require("../../state/bookmarks/bookmarkMenus"),
        ...require("../../state/bookmarks/barMenus"),
        ...require("../../state/history/historyMenus"),
        ...require("../../state/downloads/downloadMenu"),
        ...require("../../platform/clipboard"),
      };
    },
    showWhatsSent: () => {
      const { showSettingsSheet } = require("../../state/settings/sheet") as typeof import("../../state/settings/sheet");
      const { WhatsSentSheet } = require("../settings/panes/ShareDiagnostics") as typeof import("../settings/panes/ShareDiagnostics");
      showSettingsSheet(createElement(WhatsSentSheet));
    },
    get live(): { store: typeof import("../../state/live/store"); engine: typeof import("../../state/live/engine") } {
      return { store: require("../../state/live/store"), engine: require("../../state/live/engine") };
    },
  };
  (globalThis as { ac?: typeof ac }).ac = ac;
  watchDevEval(readDocument, __DEV__ ? 50 : 250, (id, source) => {
    const evalLog = ((globalThis as { __devEvalLog?: string[] }).__devEvalLog ??= []);
    const took = Date.now();
    evalLog.push(`${id} taken ${took}`);
    if (evalLog.length > 12) evalLog.shift();
    const done = (body: object) => {
      evalLog.push(`${id} settled +${Date.now() - took} ms`);
      writeDocument(DEV_EVAL_RESULT, JSON.stringify({ id, ...body }));
    };
    try {
      const fn = new Function("ac", source) as (n: typeof ac) => unknown;
      Promise.resolve(fn(ac)).then(
        (result) => done({ result: result ?? null }),
        (error: unknown) => done({ error: String(error) }),
      );
    } catch (error) {
      done({ error: String(error) });
    }
  });
}
