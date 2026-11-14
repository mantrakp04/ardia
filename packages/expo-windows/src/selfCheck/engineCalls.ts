import type { DomainModule } from "@ardia/ardiacore";
import type { AppNative, SystemNative } from "@ardia/shell";
import { engineAvailable, engineCallJson, hostCall, profileDataFolder, removeProfileFolder } from "../engine/host";
import { pngImage } from "../engine/domains/favicons";
import { profileFolder } from "../engine/domains/profiles";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const system = () => requireNativeModule<Pick<SystemNative, "fileExists">>("ArdiaSystem");
const domain = (name: string) => requireNativeModule<Pick<DomainModule, "call">>(name);

const NEVER_LOADED = "self-check-never-loaded";
const LOADED = "self-check-loaded";
const STUCK = "self-check-stuck";
const SEEDED_ZOOM_HOST = "selfcheck.example";
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const comparable = (path: unknown) => String(path).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

const folderOf = (profile: string) => {
  const folder = profileFolder(profile);
  expectTrue(folder, `${profile} has no folder name`);
  return folder;
};

const userDataDir = async () => {
  const { userDataDir: folder } = await hostCall<{ userDataDir?: unknown }>("host.info");
  expectTrue(typeof folder === "string" && folder.length > 0, "host.info has no user data folder");
  return folder;
};

const deleteData = async (profile: string) => JSON.parse(await domain("ArdiaProfiles").call("deleteData", profile, JSON.stringify({ profile }))) as { remaining?: unknown };

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
    name: "engine: engine.info answers from the host with its Chromium version and data folder",
    async run() {
      const host = await hostCall<{ chromium?: unknown; userDataDir?: unknown }>("host.info");
      const info = JSON.parse(await domain("ArdiaEngine").call("info", "", "{}")) as { chromiumVersion?: unknown; dataDirectory?: unknown; engine?: unknown };
      expectEqual({ chromiumVersion: info.chromiumVersion, dataDirectory: info.dataDirectory, engine: info.engine }, { chromiumVersion: host.chromium, dataDirectory: host.userDataDir, engine: "ardiacore" }, "engine.info");
    },
  },
  {
    name: "engine: the engine decided this is a test instance and the app took the same decision",
    async run() {
      const host = await hostCall<{ testInstance?: unknown }>("host.info");
      const config = requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig();
      expectEqual({ engine: host.testInstance, app: config.testInstance }, { engine: true, app: true }, "the test-instance decision");
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
];

export const checks: Check[] = engineAvailable() ? withEngine : [];
