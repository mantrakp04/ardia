import type { WindowsNative } from "@ardia/shell";
import { TurboModuleRegistry, type TurboModule } from "react-native";
import { engineAvailable, engineCallJson, hostCall, onEngineTopic, removeProfileFolder } from "../engine/host";
import { pngImage } from "../engine/domains/favicons";
import { profileFolder } from "../engine/domains/profiles";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type EngineHost = TurboModule & {
  available(): boolean;
  removeProfileFolder(userDataDir: string, folder: string): Promise<string>;
  hostCall(verb: string, argsJson: string, windowId: string): Promise<string>;
  engineCall(name: string, profileDir: string, argsJson: string): Promise<string>;
};

type DomainModule = { call(verb: string, profile: string, argsJson: string): Promise<string> };
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
const system = () => requireNativeModule<{ fileExists(path: string): boolean }>("ArdiaSystem");
const domain = (name: string) => requireNativeModule<DomainModule>(name);

const NEVER_LOADED = "selfCheckNeverLoaded";
const LOADED = "selfCheckLoaded";
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const userDataDir = async () => {
  const { userDataDir: folder } = await hostCall<{ userDataDir?: unknown }>("host.info");
  expectTrue(typeof folder === "string" && folder.length > 0, "host.info has no user data folder");
  return folder;
};

const deleteData = async (profile: string) => JSON.parse(await domain("ArdiaProfiles").call("deleteData", profile, JSON.stringify({ profile }))) as { remaining?: unknown };

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
  {
    name: "engine host: removing a folder that is not a profile's is refused",
    async run() {
      expectEqual(await engineHost().removeProfileFolder("C:\\Windows", "Ardia x"), "refused", "a folder outside Chromium's data");
      expectEqual(await engineHost().removeProfileFolder("C:\\Windows", "..\\System32"), "refused", "a name that leaves the folder");
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
    name: "engine: clearing browsing data reaches the engine",
    async run() {
      const profiles = requireNativeModule<DomainModule>("ArdiaProfiles");
      expectEqual(await profiles.call("clearBrowsingData", "", JSON.stringify({ types: ["cache"], since: Date.now() - 60000 })), "null", "the reply to clearing a minute of cache");
      const refused = await profiles.call("clearBrowsingData", "", JSON.stringify({ types: ["no such data"], since: 0 })).then(
        () => false,
        () => true,
      );
      expectTrue(refused, "a data type the engine does not know was not refused");
    },
  },
  {
    name: "engine: engine.info answers from the host with its Chromium version and data folder",
    async run() {
      const host = await hostCall<{ chromium?: unknown; userDataDir?: unknown }>("host.info");
      const info = JSON.parse(await domain("ArdiaEngine").call("info", "", "{}")) as { chromiumVersion?: unknown; dataDirectory?: unknown; engine?: unknown };
      expectEqual({ chromiumVersion: info.chromiumVersion, dataDirectory: info.dataDirectory, engine: info.engine }, { chromiumVersion: host.chromium, dataDirectory: host.userDataDir, engine: "ardiacore" }, "engine.info");
    },
  },
  {
    name: "engine: deleting a profile the engine never loaded leaves no folder behind",
    async run() {
      const folder = `${await userDataDir()}\\${profileFolder(NEVER_LOADED)}`;
      expectEqual(await deleteData(NEVER_LOADED), { remaining: [] }, "deleteData of a profile never loaded");
      expectEqual(system().fileExists(folder), false, `${folder} exists`);
    },
  },
  {
    name: "engine: deleting a loaded profile clears its data and keeps the folder until the engine lets go",
    async run() {
      const loaded = JSON.parse(await engineCallJson("ac_bookmarks_tree", LOADED, "{}")) as { error?: unknown };
      expectEqual(loaded.error, undefined, "loading the profile");
      const folder = `${await userDataDir()}\\${profileFolder(LOADED)}`;
      expectTrue(system().fileExists(folder), `${folder} was not made`);
      const { remaining } = await deleteData(LOADED);
      expectTrue(Array.isArray(remaining) && remaining.length === 1, `deleteData of a loaded profile left ${JSON.stringify(remaining)}`);
      expectTrue(system().fileExists(folder), `${folder} went away while the engine held it`);
      expectEqual(await removeProfileFolder(await userDataDir(), profileFolder(LOADED)), "inUse", "removing the held folder");
    },
  },
  {
    name: "engine: deleting a private or the original profile's data answers as on the Mac",
    async run() {
      expectEqual(await deleteData(`incognito1@${LOADED}`), { remaining: [] }, "a private profile");
      expectEqual(await deleteData(""), { remaining: ["data"] }, "the original profile");
    },
  },
  {
    name: "engine: favicons.fetch answers a PNG with its size",
    async run() {
      const favicons = domain("ArdiaFavicons");
      const image = JSON.parse(await favicons.call("fetch", "", JSON.stringify({ url: `data:image/png;base64,${ONE_PIXEL_PNG}` })));
      expectEqual(image, pngImage(ONE_PIXEL_PNG), "a PNG data address");
      expectEqual(image?.width, 1, "its width");
      expectEqual(JSON.parse(await favicons.call("fetch", "", JSON.stringify({ url: "file:///C:/icon.png" }))), null, "a file address");
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
