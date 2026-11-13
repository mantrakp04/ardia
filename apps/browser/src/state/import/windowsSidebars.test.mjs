import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseArcSidebar } from "../../../../../packages/expo-windows/src/import/arcSidebar.ts";
import { importProfile, Unlocks } from "../../../../../packages/expo-windows/src/import/importer.ts";
import { ARC_SIDEBAR_FILE } from "../../../../../packages/expo-windows/src/import/sidebars.ts";
import { loadZenSidebar } from "../../../../../packages/expo-windows/src/import/zenSidebar.ts";
import { fakeHost, fixtures, ROAMING } from "./fixtures/windowsHost.mjs";

const quiet = { progress() {}, cancelled: () => false };
const links = (node) => (node.type === "url" ? 1 : (node.children ?? []).reduce((n, c) => n + links(c), 0));
const titles = (nodes) => nodes.map((n) => (n.type === "url" ? n.title : `${n.title}[${titles(n.children ?? []).join(", ")}]`));
const ZEN_MAIN = "Profiles/zen12345.Default (release)";
const zenDir = (id) => `${ROAMING}\\zen\\${id.replaceAll("/", "\\")}`;
const arcSidebar = () => parseArcSidebar(readFileSync(join(fixtures, "arc-sidebar/StorableSidebar.json"), "utf8"));
const space = (name) => arcSidebar().spaces.find((s) => s.name === name);

test("Arc for Windows keeps its sidebar beside User Data in the package's LocalCache", () => {
  assert.equal(ARC_SIDEBAR_FILE, "Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache\\Local\\Arc\\StorableSidebar.json");
});

test("Arc's pinned tabs and folders keep their place, and splits keep every pane", () => {
  const home = space("Home");
  assert.deepEqual(home.pinned.map((n) => n.type), ["url", "folder", "folder", "url", "url"]);
  assert.deepEqual(home.pinned.map((n) => n.title), ["Mail", "Docs pair", "Projects", "Cal", "Pinned, missing from childrenIds"]);
  assert.equal(home.pinned[3].pageTitle, "Calendar");
  assert.equal(home.pinned.reduce((n, node) => n + links(node), 0), 8);
  assert.equal(home.pinned[1].role, "split");
  assert.deepEqual(home.pinned[1].children.map((c) => c.url), ["https://docs.example/a", "https://mail.example/"]);
  assert.equal(home.pinned[2].role, undefined);
  assert.deepEqual(home.pinned[2].children.at(-1).children.map((c) => c.url), ["https://spec.example/", "https://figma.example/"]);
});

test("Arc's unpinned splits mark their tabs, every space is read, and favourites keep every pane", () => {
  const home = space("Home");
  assert.deepEqual(home.tabs.map((t) => t.url), ["https://news.example/", "https://one.example/", "https://two.example/", "https://three.example/"]);
  assert.deepEqual(home.tabs.map((t) => t.splitId), [undefined, "H-USV", "H-USV", "H-USV"]);
  assert.ok(home.tabs.every((t) => !t.pinned));
  assert.deepEqual(arcSidebar().spaces.map((s) => s.name), ["Home", "Work"]);
  const work = space("Work");
  assert.deepEqual(work.pinned.map((n) => n.title), ["Board", "", "Wiki"]);
  assert.equal(work.pinned[1].children.length, 4);
  const favorites = arcSidebar().favorites.Default;
  assert.deepEqual(favorites.map((t) => t.url), ["https://music.example/", "https://chat.example/", "https://video.example/"]);
  assert.ok(favorites.every((t) => t.splitId === undefined && t.pinned));
});

test("An Arc import brings the profile's spaces, pinned tabs, today tabs and favourites, and honours the picked spaces", async () => {
  const all = await importProfile(fakeHost(), new Unlocks(), "arc", "Default", ["tabs", "spaces", "pinnedTabs", "favorites"], {}, quiet);
  assert.deepEqual(all.failed, []);
  assert.deepEqual(all.spaces.map((s) => s.name), ["Personal", "Space 1"]);
  assert.ok(all.spaces.every((s) => s.profileId === "Default"));
  assert.equal(all.tabs.length, 2);
  assert.ok(all.favorites.length > 0);
  const picked = await importProfile(fakeHost(), new Unlocks(), "arc", "Default", ["spaces", "pinnedTabs"], { spaceIds: [all.spaces[1].id] }, quiet);
  assert.deepEqual(picked.spaces.map((s) => s.name), ["Space 1"]);
  assert.deepEqual(picked.spaces[0].tabs, []);
  const other = await importProfile(fakeHost(), new Unlocks(), "arc", "Profile 1", ["spaces"], {}, quiet);
  assert.deepEqual(other.spaces.map((s) => s.name), ["Work"]);
  assert.deepEqual(other.spaces[0].pinned, []);
});

test("Zen's workspaces, folders, essentials and favicons read as on the Mac", async () => {
  const sidebar = await loadZenSidebar(fakeHost(), zenDir(ZEN_MAIN), ZEN_MAIN);
  const [work, play] = sidebar.spaces;
  assert.deepEqual(work.colors, ["#FF0080", "#0A141E"]);
  assert.deepEqual(titles(work.pinned), ["Team chat", "Docs[Nested[Nested page], Left, Right, Doc A]"]);
  assert.equal(work.pinned[0].pageTitle, "Chat");
  assert.deepEqual(work.tabs.map((t) => t.url), ["https://news.example/", "https://orphan.example/"]);
  assert.equal(work.tabs[0].lastActive, 1788220800 * 1000);
  assert.deepEqual(titles(play.pinned), ["Play", "Empty[]", "Loop A[Loop, Loop B[]]"]);
  assert.equal(play.pinned[0].url, "https://play.example/");
  assert.deepEqual(play.tabs.map((t) => t.customTitle), ["Fun"]);
  assert.deepEqual(sidebar.essentials, [{ url: "https://mail.example/", title: "Mail", pinned: true, windowIndex: 0, active: false }]);
  assert.deepEqual(sidebar.favicons.map((f) => f.page), ["https://chat.example/room", "https://play.example/"]);
  assert.equal(sidebar.favicons[0].icon, "https://chat.example/favicon.ico");
  assert.ok(Buffer.from(sidebar.favicons[1].png, "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
});

test("Zen's containers, older sessions, backups and places workspaces read as on the Mac", async () => {
  const boxes = await loadZenSidebar(fakeHost(), zenDir("Profiles/cnt00000.Containers"), "boxes");
  assert.deepEqual(boxes.spaces.map((s) => s.container), [undefined, 2, 3, undefined]);
  assert.deepEqual(boxes.spaces.map((s) => titles(s.pinned)), [["Home pin"], ["Work pin", "Projects[Project]"], ["Bank pin", "Lost pin"], ["Side pin"]]);
  assert.deepEqual(boxes.essentials.map((t) => t.container), [undefined, 2, 2, 3]);
  assert.equal(boxes.separateEssentials, true);
  const places = await loadZenSidebar(fakeHost(), zenDir("Profiles/plc00000.Places"), "places");
  assert.deepEqual(places.spaces.map((s) => [s.name, s.container, s.emoji]), [["Home", undefined, "\u{1F3E0}"], ["Lab", 1, undefined]]);
  assert.equal(places.spaces[0].color, "#0080FF");
  assert.deepEqual(places.spaces.map((s) => titles(s.pinned)), [["Home pin", "Reading[Read]"], ["Lab pin"]]);
  assert.equal(places.separateEssentials, false);
  const legacy = await loadZenSidebar(fakeHost(), zenDir("Profiles/old00000.Legacy"), "legacy");
  assert.deepEqual([legacy.spaces.map((s) => s.name), legacy.spaces[0].tabs.map((t) => t.url)], [["Old"], ["https://old-open.example/"]]);
  const recovered = await loadZenSidebar(fakeHost(), zenDir("Profiles/bak00000.Recovered"), "recovered");
  assert.deepEqual(recovered.spaces[0].tabs.map((t) => t.url), ["https://backup.example/"]);
  assert.deepEqual((await loadZenSidebar(fakeHost(), zenDir("Profiles/pln00000.Plain"), "plain")).spaces, []);
});

test("A Zen import maps spaces, tabs and essentials, and a plain profile falls back to its session", async () => {
  const all = await importProfile(fakeHost(), new Unlocks(), "zen", ZEN_MAIN, ["tabs", "spaces", "pinnedTabs", "favorites"], {}, quiet);
  assert.deepEqual(all.failed, []);
  assert.deepEqual(all.spaces.map((s) => s.id), ["{work-space}", "{play-space}"]);
  assert.equal(all.tabs.length, 3);
  assert.ok(!all.tabs.some((t) => t.url === "https://firefox-only.example/"));
  assert.deepEqual(all.favorites.map((t) => t.url), ["https://mail.example/"]);
  assert.deepEqual(all.favicons.map((f) => f.page), ["https://chat.example/room", "https://play.example/"]);
  assert.equal(all.separateEssentials, true);
  const play = await importProfile(fakeHost(), new Unlocks(), "zen", ZEN_MAIN, ["tabs", "spaces", "pinnedTabs"], { spaceIds: ["{play-space}"] }, quiet);
  assert.deepEqual(play.spaces.map((s) => s.name), ["Space 2"]);
  assert.deepEqual(play.tabs.map((t) => t.url), ["https://games.example/"]);
  assert.deepEqual(play.favicons.map((f) => f.page), ["https://play.example/"]);
  const tabsOnly = await importProfile(fakeHost(), new Unlocks(), "zen", ZEN_MAIN, ["tabs"], {}, quiet);
  assert.ok(tabsOnly.spaces.every((s) => s.pinned.length === 0));
  const plain = await importProfile(fakeHost(), new Unlocks(), "zen", "Profiles/pln00000.Plain", ["tabs", "spaces", "pinnedTabs"], {}, quiet);
  assert.deepEqual(plain.failed, []);
  assert.deepEqual(plain.spaces, []);
  assert.deepEqual(plain.tabs.map((t) => t.url), ["https://plain.example/", "https://pinned-plain.example/"]);
  assert.ok(plain.warnings.some((w) => w.kind === "spaces" && w.code === "empty"));
});

test("Firefox passwords come from the native NSS reader, and a primary password is the Mac's locked kind", async () => {
  const items = [{ url: "https://accounts.mozilla.example", username: "fox@example.com", password: "fire & fox", realm: "https://accounts.mozilla.example" }];
  const host = fakeHost({ firefoxLogins: { items, undecryptable: 1, appBound: 0 } });
  const read = await importProfile(host, new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["passwords"], {}, quiet);
  assert.deepEqual(read.failed, []);
  assert.deepEqual(read.credentials, items);
  assert.deepEqual(read.warnings.map((w) => [w.code, w.message]), [["undecryptable", "1 password couldn't be decrypted"]]);
  assert.deepEqual(host.calls.filter(([c]) => c === "firefoxLogins" || c === "unlock"), [["firefoxLogins", `${ROAMING}\\Mozilla\\Firefox\\Profiles\\abcd1234.default-release`]]);
  const locked = await importProfile(
    fakeHost({ firefoxLogins: { items: [], undecryptable: 0, appBound: 0, error: { code: "locked", message: "Wrong Firefox primary password" } } }),
    new Unlocks(),
    "firefox",
    "Profiles/zzzz9999.work",
    ["passwords"],
    {},
    quiet,
  );
  assert.deepEqual(locked.failed, ["passwords"]);
  assert.deepEqual(locked.warnings.map((w) => [w.code, w.message]), [["locked", "Wrong Firefox primary password"]]);
  const held = await importProfile(fakeHost({ firefoxLogins: { items: [], undecryptable: 0, appBound: 0, failure: "inUse" } }), new Unlocks(), "zen", ZEN_MAIN, ["passwords"], {}, quiet);
  assert.equal(held.warnings[0].code, "locked");
});

test("Firefox cookies come back as a count and a token, with container and private cookies counted out", async () => {
  const host = fakeHost({ firefoxCookies: { count: 6, undecryptable: 0, appBound: 0, dropped: 0, skipped: 3, token: "t0k" } });
  const result = await importProfile(host, new Unlocks(), "zen", ZEN_MAIN, ["cookies"], {}, quiet);
  assert.deepEqual(result.failed, []);
  assert.equal(result.cookieCount, 6);
  assert.equal(result.vaultToken, "t0k");
  assert.deepEqual(result.warnings.map((w) => [w.code, w.message]), [["skipped", "3 cookies from containers or private windows weren't imported"]]);
  assert.deepEqual(host.calls.find(([c]) => c === "firefoxCookies"), ["firefoxCookies", `${zenDir(ZEN_MAIN)}\\cookies.sqlite`]);
  const held = await importProfile(fakeHost({ firefoxCookies: { failure: "inUse", count: 0, undecryptable: 0, appBound: 0, dropped: 0 } }), new Unlocks(), "firefox", "Profiles/abcd1234.default-release", ["cookies"], {}, quiet);
  assert.deepEqual(held.failed, ["cookies"]);
  assert.match(held.warnings[0].message, /Firefox is holding cookies.sqlite/);
});
