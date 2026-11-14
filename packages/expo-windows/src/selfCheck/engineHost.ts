import type { DomainModule } from "@ardia/ardiacore";
import type { AppNative, SystemNative, WindowsNative } from "@ardia/shell";
import { TurboModuleRegistry } from "react-native";
import type { AppWindowsModule, EngineHostModule } from "../nativeModuleTypes";
import { engineAvailable, engineCallJson, hostCall, onEngineTopic, profileDataFolder, removeProfileFolder } from "../engine/host";
import { pngImage } from "../engine/domains/favicons";
import { profileFolder } from "../engine/domains/profiles";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type TabEvent = { key?: unknown; name?: unknown; data?: { title?: unknown; isLoading?: unknown } };
type ListedTab = { key: string; title: string; shown: boolean; windowVisible: boolean; width: number; height: number; session?: number };

const PAGE_KEY = "self-check-page";
const PAGE_TITLE = "ardia self check";
const PAGE_URL = `data:text/html,<title>${PAGE_TITLE}</title><p>the engine loaded this page</p>`;
const PAGE_PLACE = { x: 40, y: 60, width: 320, height: 240 };
const LOAD_MS = 20000;
const PAINT_MS = 500;
const JPEG_BASE64 = "/9j/";

const engineHost = () => {
  const found = TurboModuleRegistry.get<EngineHostModule>("ArdiaEngineHost");
  expectTrue(found, "ArdiaEngineHost has no native module");
  return found;
};

const windows = () => requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows");
const system = () => requireNativeModule<Pick<SystemNative, "fileExists">>("ArdiaSystem");
const launchData = () => requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().dataDirectory;
const domain = (name: string) => requireNativeModule<Pick<DomainModule, "call">>(name);

const SECOND_PAGE_KEY = "self-check-second-page";
const PRIVATE_FIRST = "incognito:self-check-first@";
const PRIVATE_SECOND = "incognito:self-check-second@";
const PRIVATE_NEXT = "incognito:self-check-next@";
const NEVER_LOADED = "self-check-never-loaded";
const LOADED = "self-check-loaded";
const STUCK = "self-check-stuck";
const SEEDED_ZOOM_HOST = "selfcheck.example";

const comparable = (path: unknown) => String(path).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

const folderOf = (profile: string) => {
  const folder = profileFolder(profile);
  expectTrue(folder, `${profile} has no folder name`);
  return folder;
};
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
    name: "engine host: profiles live in the instance's own Chromium folder, and nothing is removed while it has none",
    async run() {
      expectEqual(comparable(engineHost().profileDataFolder()), comparable(`${String(launchData())}\\Chromium`), "profileDataFolder()");
      expectEqual(await engineHost().removeProfileFolder("Ardia x"), "refused", "a profile folder with no Chromium data beside it");
      expectEqual(await engineHost().removeProfileFolder("..\\System32"), "refused", "a name that leaves the folder");
      expectEqual(await engineHost().removeProfileFolder("Ardia x (removing)"), "refused", "a name the engine never makes");
      expectEqual(await engineHost().removeProfileFolder("Ardia Work"), "refused", "a name Ardia never makes");
      expectEqual(await engineHost().removeProfileFolder(`Ardia ${"a".repeat(239)}`), "refused", "a name with no room for the removal suffix");
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
      await hostCall("tab.show", { key: PAGE_KEY, visible: true, ...PAGE_PLACE }, windowId);
      const listed = await hostCall<{ tabs: ListedTab[] }>("tabs.list");
      const page = listed.tabs.find((tab) => tab.key === PAGE_KEY);
      expectTrue(page, "the page is not listed");
      expectEqual({ shown: page.shown, title: page.title }, { shown: true, title: PAGE_TITLE }, "the shown page");
      const displayScale = page.width / PAGE_PLACE.width;
      expectTrue(displayScale >= 1 && Math.abs(page.height - PAGE_PLACE.height * displayScale) <= 1, `the page placed at ${PAGE_PLACE.width}×${PAGE_PLACE.height} is ${page.width}×${page.height} pixels`);
      await new Promise<void>((resolve) => setTimeout(resolve, PAINT_MS));
      const picture = await requireNativeModule<Pick<AppWindowsModule, "capturePage">>("ArdiaAppWindows").capturePage(windowId, PAGE_PLACE.x, PAGE_PLACE.y, PAGE_PLACE.width, PAGE_PLACE.height, 1);
      expectTrue(picture.startsWith(JPEG_BASE64), `the shown page's picture is ${picture.slice(0, 16) || "empty"}`);
      await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
      const hidden = (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs.find((tab) => tab.key === PAGE_KEY);
      expectEqual(hidden?.shown, false, "shown after hiding");
    },
  },
  {
    name: "engine: two pages of one window show at once, each in its own page window",
    async run() {
      const windowId = await firstWindow();
      const made = await hostCall<{ tab?: unknown }>("tab.create", { key: SECOND_PAGE_KEY, url: PAGE_URL, profile: "" }, windowId);
      expectTrue(typeof made.tab === "number" && made.tab > 0, `tab.create said ${JSON.stringify(made)}`);
      await hostCall("tab.show", { key: PAGE_KEY, visible: true, unit: "px", x: 40, y: 60, width: 300, height: 240 }, windowId);
      await hostCall("tab.show", { key: SECOND_PAGE_KEY, visible: true, unit: "px", x: 360, y: 60, width: 280, height: 220 }, windowId);
      const both = (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs;
      const first = both.find((tab) => tab.key === PAGE_KEY);
      const second = both.find((tab) => tab.key === SECOND_PAGE_KEY);
      expectEqual({ shown: first?.shown, width: first?.width, height: first?.height }, { shown: true, width: 300, height: 240 }, "the first page while the second shows");
      expectEqual({ shown: second?.shown, width: second?.width, height: second?.height }, { shown: true, width: 280, height: 220 }, "the second page");
      await hostCall("tab.show", { key: SECOND_PAGE_KEY, visible: false }, windowId);
      const after = (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs;
      expectEqual(after.find((tab) => tab.key === PAGE_KEY)?.shown, true, "the first page after the second hid");
      expectEqual(after.find((tab) => tab.key === SECOND_PAGE_KEY)?.shown, false, "the second page after it hid");
      await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
      await hostCall("tab.close", { key: SECOND_PAGE_KEY });
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
      const profiles = requireNativeModule<Pick<DomainModule, "call">>("ArdiaProfiles");
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
    name: "engine: native and the engine agree where Chromium keeps profiles",
    async run() {
      expectEqual(comparable(profileDataFolder()), comparable(await userDataDir()), "profileDataFolder() against host.info");
    },
  },
  {
    name: "engine: deleting a profile the engine never loaded leaves no folder behind",
    async run() {
      const folder = `${await userDataDir()}\\${folderOf(NEVER_LOADED)}`;
      expectEqual(await deleteData(NEVER_LOADED), { remaining: [] }, "deleteData of a profile never loaded");
      expectEqual(system().fileExists(folder), false, `${folder} exists`);
    },
  },
  {
    name: "engine: deleting a loaded profile clears its data and keeps the folder until the engine lets go",
    async run() {
      const loaded = JSON.parse(await engineCallJson("ac_bookmarks_tree", LOADED, "{}")) as { error?: unknown };
      expectEqual(loaded.error, undefined, "loading the profile");
      const folder = `${await userDataDir()}\\${folderOf(LOADED)}`;
      expectTrue(system().fileExists(folder), `${folder} was not made`);
      const { remaining } = await deleteData(LOADED);
      expectTrue(Array.isArray(remaining) && remaining.length === 1, `deleteData of a loaded profile left ${JSON.stringify(remaining)}`);
      expectTrue(system().fileExists(folder), `${folder} went away while the engine held it`);
      expectEqual(await removeProfileFolder(folderOf(LOADED)), "inUse", "removing the held folder");
    },
  },
  {
    name: "engine: an earlier removal that is still left is reported, not taken as done",
    async run() {
      const leftover = `${await userDataDir()}\\${folderOf(STUCK)} (removing)`;
      expectTrue(system().fileExists(leftover), `the launch left no held ${leftover}`);
      expectEqual(await removeProfileFolder(folderOf(STUCK)), "partial", "removing a profile whose earlier removal is held open");
      expectEqual((await deleteData(STUCK)).remaining, ["files (partial)"], "what deleteData reports");
    },
  },
  {
    name: "engine: deleting a private profile's data answers as on the Mac",
    async run() {
      expectEqual(await deleteData(`incognito1@${LOADED}`), { remaining: [] }, "a private profile");
    },
  },
  {
    name: "engine: deleting the original profile's data clears it step by step",
    async run() {
      const seeded = JSON.parse(await engineCallJson("ac_zoom_set", "", JSON.stringify({ host: SEEDED_ZOOM_HOST, level: 1 }))) as { error?: unknown };
      expectEqual(seeded.error, undefined, "seeding a zoom level");
      expectEqual(await deleteData(""), { remaining: [] }, "deleting the original profile's data");
      const zooms = JSON.parse(await engineCallJson("ac_zoom_list", "", "{}")) as { levels?: Record<string, unknown> };
      expectEqual(Object.keys(zooms.levels ?? {}), [], "zoom levels left");
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
    name: "engine: private windows of a profile share one session until the last is released, then the next gets a new one",
    async run() {
      const windowId = await firstWindow();
      const profiles = domain("ArdiaProfiles");
      const sessionOf = async (key: string) => (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs.find((tab) => tab.key === key)?.session;
      const open = async (key: string, profile: string) => {
        const made = await hostCall<{ tab?: unknown }>("tab.create", { key, url: PAGE_URL, profile }, windowId);
        expectTrue(typeof made.tab === "number" && made.tab > 0, `tab.create in ${profile} said ${JSON.stringify(made)}`);
        return sessionOf(key);
      };
      const first = await open(PRIVATE_FIRST, PRIVATE_FIRST);
      expectTrue(typeof first === "number" && first > 0, `the first private tab's session is ${String(first)}`);
      expectEqual(await open(PRIVATE_SECOND, PRIVATE_SECOND), first, "the second private window's session while the first is open");
      expectEqual(await sessionOf(PAGE_KEY), 0, "the normal tab's session");
      for (const name of [PRIVATE_FIRST, PRIVATE_SECOND]) {
        await hostCall("tab.close", { key: name });
        expectEqual(await profiles.call("release", name, "{}"), "null", `releasing ${name}`);
      }
      const next = await open(PRIVATE_NEXT, PRIVATE_NEXT);
      expectTrue(typeof next === "number" && next > 0 && next !== first, `the private window after both closed is in session ${String(next)}, the old one was ${String(first)}`);
      const reopened = await hostCall("tab.create", { key: PRIVATE_FIRST, url: PAGE_URL, profile: PRIVATE_FIRST }, windowId).then(
        () => true,
        () => false,
      );
      expectEqual(reopened, false, "a released private window opening a tab again");
      await hostCall("tab.close", { key: PRIVATE_NEXT });
      expectEqual(await profiles.call("release", PRIVATE_NEXT, "{}"), "null", `releasing ${PRIVATE_NEXT}`);
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
