import * as shell from "@ardia/shell";
import { readDocument, writeDocument } from "@ardia/shell";
import { omniboxDrivers } from "../components/omnibox/devDriver";
import { pagesDrivers } from "../components/pages/devDrivers";
import { usePages } from "../components/layout/pageState";
import { openSettings } from "../components/settings/windows";
import { useSidebarUi } from "../components/sidebar/state";
import { useBrowser } from "../store/browser";
import * as actions from "./actions";
import { runCommand } from "./commands";
import * as favicons from "./favicons";
import { probeStore } from "./perfProbe";
import { useLifecycle } from "./tabLifecycle";
import { webviews } from "./webviews";

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
    store: useBrowser, actions, runCommand, webviews, shell, omnibox: omniboxDrivers, pages: pagesDrivers,
    pageState: usePages,
    openSettings,
    favicons,
    get onboarding(): typeof import("../components/onboarding/state") {
      return require("../components/onboarding/state");
    },
    get checkIn(): typeof import("./defaultBrowserCheckIn") {
      return require("./defaultBrowserCheckIn");
    },
    get media(): typeof import("../components/media/state").useMedia {
      return require("../components/media/state").useMedia;
    },
    get permissions(): typeof import("../components/site/permissions") {
      return require("../components/site/permissions");
    },
    get translate(): typeof import("../components/site/translate") {
      return require("../components/site/translate");
    },
    get peek(): typeof import("../components/peek/actions") {
      return require("../components/peek/actions");
    },
    get toasts(): typeof import("../components/layout/splitActions").useToasts {
      return require("../components/layout/splitActions").useToasts;
    },
    get extensions(): typeof import("../components/extensions/state") {
      return require("../components/extensions/state");
    },
    get themes(): typeof import("../components/import/apply") & typeof import("../components/settings/ThemeEditor") {
      return { ...require("../components/import/apply"), ...require("../components/settings/ThemeEditor") };
    },
    get bangs(): typeof import("../components/omnibox/bangs") {
      return require("../components/omnibox/bangs");
    },
    get switcher(): typeof import("../components/sidebar/switcher") {
      return require("../components/sidebar/switcher");
    },
    get sidebarRows(): typeof import("../components/sidebar/state") {
      return require("../components/sidebar/state");
    },
    get sidebarHover(): typeof import("../components/sidebar/hover") & typeof import("../components/sidebar/hoverMotion") {
      return { ...require("../components/sidebar/hover"), ...require("../components/sidebar/hoverMotion") };
    },
    get toolbarAutoHide(): typeof import("../components/layout/toolbarAutoHide") {
      return require("../components/layout/toolbarAutoHide");
    },
    get hoverShift(): typeof import("./hoverShift") {
      return require("./hoverShift");
    },
    get settingsSearch(): typeof import("../components/settings/searchState") & typeof import("../components/settings/SettingsSearch") {
      return { ...require("../components/settings/searchState"), ...require("../components/settings/SettingsSearch") };
    },
    get settingsNav(): typeof import("../components/settings/windows").useSettingsNav {
      return require("../components/settings/windows").useSettingsNav;
    },
    get preload(): typeof import("./preload") {
      return require("./preload");
    },
    get live(): { store: typeof import("../live/store"); engine: typeof import("../live/engine") } {
      return { store: require("../live/store"), engine: require("../live/engine") };
    },
  };
  (globalThis as { ac?: typeof ac }).ac = ac;
  const scriptId = (source: string | null) => source?.match(/^\/\/ *(\S+)/)?.[1];
  let lastId = scriptId(readDocument("dev-eval.js")) ?? "";
  setInterval(function pollDevEval() {
    const source = readDocument("dev-eval.js");
    const id = scriptId(source);
    if (!source || !id || id === lastId) return;
    lastId = id;
    const evalLog = ((globalThis as { __devEvalLog?: string[] }).__devEvalLog ??= []);
    const took = Date.now();
    evalLog.push(`${id} taken ${took}`);
    if (evalLog.length > 12) evalLog.shift();
    const done = (body: object) => {
      evalLog.push(`${id} settled +${Date.now() - took} ms`);
      writeDocument("dev-eval-result.json", JSON.stringify({ id, ...body }));
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
  }, __DEV__ ? 50 : 250);
}
