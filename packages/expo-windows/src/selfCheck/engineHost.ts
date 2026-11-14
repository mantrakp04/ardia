import type { DomainModule } from "@ardia/ardiacore";
import type { AppNative, WindowsNative } from "@ardia/shell";
import { TurboModuleRegistry } from "react-native";
import type { AppWindowsModule, EngineHostModule } from "../nativeModuleTypes";
import { engineAvailable, engineCallJson, hostCall, onEngineTopic, removeProfileFolder } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";
import { comparable } from "./engineCalls";
import { fieldFocusedIn } from "../appKeyboard";
import { textFocusForCheck } from "../textFocus";

type TabEvent = { key?: unknown; name?: unknown; data?: { title?: unknown; isLoading?: unknown } };
type ListedTab = { key: string; tab?: number; title: string; shown: boolean; windowVisible: boolean; width: number; height: number; session?: number };

const PAGE_KEY = "self-check-page";
const OTHER_WINDOW = "self-check-other-window";
const SHOWN_AT = { unit: "px", x: 40, y: 60, width: 300, height: 240 };
type KeyboardInfo = { keyboardPage?: unknown; keyboardMayMove?: unknown; keyboardWanted?: unknown };
const keyboardInfo = () => hostCall<KeyboardInfo>("host.info");
const focusAsked = async () => ((await keyboardInfo()).keyboardMayMove === true ? {} : { background: true });
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
const launchData = () => requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().dataDirectory;
const domain = (name: string) => requireNativeModule<Pick<DomainModule, "call">>(name);

const SECOND_PAGE_KEY = "self-check-second-page";
const PRIVATE_FIRST = "incognito:self-check-first@";
const PRIVATE_SECOND = "incognito:self-check-second@";
const PRIVATE_NEXT = "incognito:self-check-next@";


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
    name: "engine: a page that only shows never takes the keyboard, even right after the keyboard's page hid; a follow does",
    async run() {
      const windowId = await firstWindow();
      const made = await hostCall<{ tab?: unknown }>("tab.create", { key: SECOND_PAGE_KEY, url: PAGE_URL, profile: "" }, windowId);
      expectTrue(typeof made.tab === "number" && made.tab > 0, `tab.create said ${JSON.stringify(made)}`);
      await hostCall("tab.show", { key: PAGE_KEY, visible: true, ...SHOWN_AT }, windowId);
      const asked = await focusAsked();
      await hostCall("tab.call", { key: PAGE_KEY, method: "focus", ...asked });
      const before = await keyboardInfo();
      await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
      await hostCall("tab.show", { key: SECOND_PAGE_KEY, visible: true, ...SHOWN_AT }, windowId);
      const shown = await keyboardInfo();
      expectTrue(shown.keyboardPage !== SECOND_PAGE_KEY, "the second page took the keyboard by only showing");
      await hostCall("tab.call", { key: SECOND_PAGE_KEY, method: "focus", follow: true, ...asked });
      const followed = await keyboardInfo();
      if (before.keyboardMayMove === true) {
        expectEqual(before.keyboardPage, PAGE_KEY, "the keyboard after the first page was focused");
        expectEqual(shown.keyboardPage, "", "the keyboard after the first page hid and the second only showed");
        expectEqual(followed.keyboardPage, SECOND_PAGE_KEY, "the keyboard after the app asked it to follow the second page");
      } else {
        expectEqual(before.keyboardWanted, [PAGE_KEY], "the focus kept for when the app is in front");
        expectEqual(shown.keyboardWanted, [], "the kept focus after its page hid and the second only showed");
        expectEqual(followed.keyboardWanted, [SECOND_PAGE_KEY], "the kept focus after the app asked it to follow the second page");
      }
      await hostCall("tab.show", { key: SECOND_PAGE_KEY, visible: false }, windowId);
      await hostCall("tab.close", { key: SECOND_PAGE_KEY });
    },
  },
  {
    name: "engine: a field in another window doesn't hold this window's keyboard",
    async run() {
      const windowId = await firstWindow();
      const previous = textFocusForCheck.focused();
      const field = JSON.parse(`{"__internalInstanceHandle":{"return":null,"memoizedProps":{"windowId":"${OTHER_WINDOW}"}}}`);
      textFocusForCheck.register(field);
      textFocusForCheck.focus(field);
      try {
        expectEqual(fieldFocusedIn(OTHER_WINDOW), true, "the field's own window");
        expectEqual(fieldFocusedIn(windowId), false, "another window while that field is focused");
        await hostCall("tab.show", { key: PAGE_KEY, visible: true, ...SHOWN_AT }, windowId);
        await hostCall("tab.call", { key: PAGE_KEY, method: "focus", follow: true, ...(await focusAsked()) });
        const info = await keyboardInfo();
        if (info.keyboardMayMove === true) expectEqual(info.keyboardPage, PAGE_KEY, "the keyboard after a follow in this window");
        else expectEqual(info.keyboardWanted, [PAGE_KEY], "the focus kept for when the app is in front");
      } finally {
        textFocusForCheck.blur(field);
        textFocusForCheck.unregister(field);
        if (previous) textFocusForCheck.focus(previous);
        await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
      }
    },
  },
  {
    name: "engine: a focus kept while the app isn't in front is dropped when its page hides or the app says to forget it",
    async run() {
      const windowId = await firstWindow();
      await hostCall("tab.show", { key: PAGE_KEY, visible: true, ...SHOWN_AT }, windowId);
      await hostCall("tab.call", { key: PAGE_KEY, method: "focus", background: true });
      expectEqual((await keyboardInfo()).keyboardWanted, [PAGE_KEY], "the kept focus");
      await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
      expectEqual((await keyboardInfo()).keyboardWanted, [], "the kept focus after its page hid");
      await hostCall("tab.show", { key: PAGE_KEY, visible: true, ...SHOWN_AT }, windowId);
      await hostCall("tab.call", { key: PAGE_KEY, method: "focus", background: true });
      await hostCall("keyboard.forget", {}, windowId);
      expectEqual((await keyboardInfo()).keyboardWanted, [], "the kept focus after a field of its window took the keyboard");
      await hostCall("tab.show", { key: PAGE_KEY, visible: false }, windowId);
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
    name: "engine: a key closed while its page still runs its unload handlers can be used again at once",
    async run() {
      const windowId = await firstWindow();
      const key = "self-check-busy-unload";
      const busy = 'data:text/html,<title>busy unload</title><script>addEventListener("beforeunload", () => { const t = Date.now(); while (Date.now() - t < 3000) {} })</script>';
      const listed = async () => (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs.find((tab) => tab.key === key);
      await hostCall("tab.create", { key, url: busy, profile: "" }, windowId);
      const loadedBy = Date.now() + LOAD_MS;
      while ((await listed())?.title !== "busy unload" && Date.now() < loadedBy) await new Promise((resolve) => setTimeout(resolve, 200));
      expectEqual((await listed())?.title, "busy unload", "the busy page's title");
      await hostCall("tab.close", { key });
      const made = await hostCall<{ tab?: unknown }>("tab.create", { key, url: PAGE_URL, profile: "" }, windowId);
      expectTrue(typeof made.tab === "number" && made.tab > 0, `tab.create again said ${JSON.stringify(made)}`);
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const again = await listed();
      expectEqual(again?.tab, made.tab, "the tab listed under the reused key after the old page's deadlines");
      await hostCall("tab.call", { key, method: "navigationEntries" });
      await hostCall("tab.close", { key });
    },
  },
  {
    name: "engine: a tab closed while its page runs its unload handlers can't be adopted or discarded",
    async run() {
      const windowId = await firstWindow();
      const key = "self-check-closing-adopt";
      const busy = 'data:text/html,<title>busy close</title><script>addEventListener("beforeunload", () => { const t = Date.now(); while (Date.now() - t < 3000) {} })</script>';
      const listed = async (name: string) => (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs.find((tab) => tab.key === name);
      await hostCall("tab.create", { key, url: busy, profile: "" }, windowId);
      const loadedBy = Date.now() + LOAD_MS;
      while ((await listed(key))?.title !== "busy close" && Date.now() < loadedBy) await new Promise((resolve) => setTimeout(resolve, 200));
      const id = (await listed(key))?.tab;
      expectTrue(typeof id === "number" && id > 0, `the busy page's tab id is ${String(id)}`);
      await hostCall("tab.close", { key });
      const adopted = await hostCall("tab.create", { key: `${key}-adopted`, adopt: `ardiacore:${id}`, profile: "" }, windowId).then(
        () => true,
        () => false,
      );
      if (adopted) await hostCall("tab.close", { key: `${key}-adopted` });
      expectEqual(adopted, false, "adopting a tab that is closing");
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
