import type { WindowsNative } from "@ardia/shell";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import { engineAvailable, engineCallJson, hostCall, onEngineTopic } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type EngineHost = TurboModule & {
  available(): boolean;
  hostCall(verb: string, argsJson: string, windowId: string): Promise<string>;
  engineCall(name: string, profileDir: string, argsJson: string): Promise<string>;
};

type TabEvent = { key?: unknown; name?: unknown; data?: { title?: unknown; isLoading?: unknown } };
type ListedTab = { key: string; title: string; shown: boolean; windowVisible: boolean; width: number; height: number };

const PAGE_KEY = "self-check-page";
const PAGE_TITLE = "ardia self check";
const PAGE_URL = `data:text/html,<title>${PAGE_TITLE}</title><p>the engine loaded this page</p>`;
const LOAD_MS = 20000;

const engineHost = () => {
  const found = TurboModuleRegistry.get<EngineHost>("ArdiaEngineHost");
  expectTrue(found, "ArdiaEngineHost has no native module");
  return found;
};

const windows = () => requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows");

const expectNoEngine = (reply: unknown, what: string) => {
  expectEqual(typeof reply, "string", `the type of ${what}'s reply`);
  expectTrue(String(reply).includes("no engine"), `${what} answered ${JSON.stringify(reply)}`);
};

const firstWindow = async () => {
  const ids = await windows().windowIds();
  expectTrue(ids.length > 0, "no window is open to host a page");
  return ids[0]!;
};

const pageTitled = (title: string) =>
  new Promise<void>((resolve, reject) => {
    const watching = onEngineTopic("tab", (event: TabEvent) => {
      if (event.key !== PAGE_KEY || event.name !== "navigation") return;
      if (event.data?.title !== title || event.data.isLoading !== false) return;
      clearTimeout(deadline);
      watching.remove();
      resolve();
    });
    const deadline = setTimeout(() => {
      watching.remove();
      reject(new Error(`no navigation event with the title "${title}" within ${LOAD_MS} ms`));
    }, LOAD_MS);
  });

const withoutEngine: Check[] = [
  {
    name: "engine host: a standalone launch has no engine",
    run() {
      expectEqual(engineHost().available(), false, "available()");
    },
  },
  {
    name: "engine host: a host call with no engine answers that there is none",
    async run() {
      expectNoEngine(await engineHost().hostCall("ping", "{}", ""), "hostCall");
    },
  },
  {
    name: "engine host: an engine call with no engine answers that there is none",
    async run() {
      expectNoEngine(await engineHost().engineCall("ping", "", "{}"), "engineCall");
    },
  },
];

const withEngine: Check[] = [
  {
    name: "engine: the host answers with its Chromium version",
    async run() {
      const info = await hostCall<{ chromium?: unknown; userDataDir?: unknown }>("host.info");
      expectTrue(typeof info.chromium === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(info.chromium), `host.info said ${JSON.stringify(info)}`);
      expectTrue(typeof info.userDataDir === "string" && info.userDataDir.length > 0, "host.info has no user data folder");
    },
  },
  {
    name: "engine: an unknown host verb is refused",
    async run() {
      const refused = await hostCall("no.such.verb").then(
        () => false,
        (error: unknown) => String((error as Error).message).includes("unknown verb"),
      );
      expectTrue(refused, "an unknown verb was not refused");
    },
  },
  {
    name: "engine: a tab loads a page and reports its title",
    async run() {
      const windowId = await firstWindow();
      const loaded = pageTitled(PAGE_TITLE);
      const made = await hostCall<{ tab?: unknown }>("tab.create", { key: PAGE_KEY, url: PAGE_URL, profile: "" }, windowId);
      expectTrue(typeof made.tab === "number" && made.tab > 0, `tab.create said ${JSON.stringify(made)}`);
      await loaded;
    },
  },
  {
    name: "engine: the page shows inside the window where it is placed",
    async run() {
      const windowId = await firstWindow();
      await hostCall("tab.show", { key: PAGE_KEY, visible: true, unit: "px", x: 40, y: 60, width: 320, height: 240 }, windowId);
      const listed = await hostCall<{ tabs: ListedTab[] }>("tabs.list");
      const page = listed.tabs.find((tab) => tab.key === PAGE_KEY);
      expectTrue(page, "the page is not listed");
      expectEqual({ shown: page.shown, width: page.width, height: page.height, title: page.title }, { shown: true, width: 320, height: 240, title: PAGE_TITLE }, "the shown page");
      await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
      const hidden = (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs.find((tab) => tab.key === PAGE_KEY);
      expectEqual(hidden?.shown, false, "shown after hiding");
    },
  },
  {
    name: "engine: the bookmarks call answers for the default profile",
    async run() {
      const tree = JSON.parse(await engineCallJson("ac_bookmarks_tree", "", "{}")) as { bar?: { k?: unknown }; error?: unknown };
      expectEqual(tree.error, undefined, "ac_bookmarks_tree's error");
      expectEqual(tree.bar?.k, "f", "the bookmarks bar's kind");
    },
  },
  {
    name: "engine: an unknown engine call is refused",
    async run() {
      const reply = JSON.parse(await engineCallJson("ac_no_such_call", "", "{}")) as { error?: unknown };
      expectEqual(reply.error, "unknown call", "the reply's error");
    },
  },
  {
    name: "engine: the tab closes",
    async run() {
      await hostCall("tab.close", { key: PAGE_KEY });
      const listed = await hostCall<{ tabs: ListedTab[] }>("tabs.list");
      expectTrue(!listed.tabs.some((tab) => tab.key === PAGE_KEY), "the closed page is still listed");
    },
  },
];

export const checks: Check[] = engineAvailable() ? withEngine : withoutEngine;
