import { findBrowser, isChromiumBased, type Browser } from "./browsers";
import { chromiumBookmarks, faviconPages, readFavicons, readHistory } from "./chromium";
import { dataDirectory, profileDirectory } from "./discovery";
import { firefoxBookmarks, loadFirefoxSession } from "./firefox";
import { entries, join, type ImportHost, type Secrets } from "./host";
import { checkCancelled, ImportFailure, KIND_ORDER, linkCount, plural, warningCode, type ImportKind, type Observer, type Options, type Result } from "./model";
import { loadSession } from "./sessions";
import { Sidebars, takeSpaces } from "./sidebars";
import { snapshotFailure } from "./sqlite";
import { zenFavicons } from "./zenSidebar";

export class Unlocks {
  private unlocked = new Set<string>();

  async ensure(host: ImportHost, browser: Browser): Promise<boolean> {
    if (!isChromiumBased(browser) || this.unlocked.has(browser.id)) return true;
    const answer = await host.unlock(browser.id, join(dataDirectory(host, browser), "Local State")).catch(() => ({ unlocked: false }));
    if (answer.unlocked) this.unlocked.add(browser.id);
    return answer.unlocked;
  }

  forget(host: ImportHost) {
    this.unlocked.clear();
    host.forget();
  }
}

function secretWarnings(result: Result, kind: ImportKind, outcome: Secrets, noun: string, browser: Browser) {
  if (outcome.undecryptable > 0) result.warnings.push({ kind, code: "undecryptable", message: `${plural(outcome.undecryptable, noun)} couldn't be decrypted` });
  if (outcome.appBound > 0)
    result.warnings.push({ kind, code: "undecryptable", message: `${plural(outcome.appBound, noun)} use ${browser.name}'s app-bound encryption, which only ${browser.name} can read` });
}

async function cookieFile(host: ImportHost, dir: string): Promise<string> {
  const network = join(dir, "Network");
  if ((await entries(host, network)).some((e) => e.name === "Cookies")) return join(network, "Cookies");
  if ((await entries(host, dir)).some((e) => e.name === "Cookies")) return join(dir, "Cookies");
  throw new ImportFailure("notFound", "No cookies in this profile");
}

async function loginFiles(host: ImportHost, dir: string): Promise<string[]> {
  const names = new Set((await entries(host, dir)).map((e) => e.name));
  const files = ["Login Data", "Login Data For Account"].filter((n) => names.has(n)).map((n) => join(dir, n));
  if (!files.length) throw new ImportFailure("notFound", "No saved passwords in this profile");
  return files;
}

export async function importProfile(
  host: ImportHost,
  unlocks: Unlocks,
  browserId: string,
  profileId: string,
  kinds: ImportKind[],
  options: Options,
  observer: Observer,
): Promise<Result> {
  const browser = findBrowser(browserId);
  if (!browser) throw new ImportFailure("notFound", `Unknown browser ${browserId}`);
  const { dir, profile } = await profileDirectory(host, browser, profileId);
  const result: Result = {
    browserId,
    profileId,
    profile: { name: profile.name, ...(profile.color ? { color: profile.color } : {}), ...(profile.avatarPath ? { avatarPath: profile.avatarPath } : {}) },
    history: [],
    historyCount: 0,
    tabs: [],
    tabGroups: [],
    credentials: [],
    cookieCount: 0,
    addressCount: 0,
    cardCount: 0,
    spaces: [],
    favorites: [],
    favicons: [],
    failed: [],
    warnings: [],
  };
  const chromium = isChromiumBased(browser);
  const sidebars = new Sidebars(host, dir, profileId, () => observer.cancelled());
  for (const kind of KIND_ORDER.filter((k) => kinds.includes(k))) {
    checkCancelled(observer);
    if (kind !== "history") observer.progress({ kind, phase: "start", processed: 0 });
    let count = 0;
    let succeeded = false;
    try {
      if (kind === "bookmarks") {
        result.bookmarks = chromium ? await chromiumBookmarks(host, dir) : await firefoxBookmarks(host, join(dir, "places.sqlite"));
        count = linkCount(result.bookmarks);
      } else if (kind === "history") {
        const file = join(dir, chromium ? "History" : "places.sqlite");
        const read = await readHistory(host, file, chromium ? "chromium" : "firefox", options, observer, browser.name);
        result.history = read.entries;
        result.historyCount = read.count;
        count = read.count;
      } else if (kind === "tabs" && browser.family === "chromium") {
        const session = await loadSession(host, dir);
        result.tabs = session.tabs;
        result.tabGroups = session.groups;
        count = session.tabs.length;
      } else if (kind === "tabs" && browser.family === "firefox" && !(await sidebars.spaces(browser.sidebar))) {
        const session = await loadFirefoxSession(host, dir);
        result.tabs = session.tabs;
        result.tabGroups = session.groups;
        count = session.tabs.length;
      } else if (kind === "spaces" || kind === "pinnedTabs" || kind === "tabs") {
        if (!browser.sidebar) throw new ImportFailure("unsupported", `${browser.name} has no ${kind} to import`);
        const spaces = await sidebars.spaces(browser.sidebar);
        if (!spaces) throw new ImportFailure("notFound", `No ${browser.name} spaces in this profile`);
        count = takeSpaces(result, spaces, kind, kinds, options.spaceIds);
      } else if (kind === "favorites" && browser.sidebar === "arc") {
        result.favorites = (await sidebars.arcSidebar()).favorites[profileId] ?? [];
        count = result.favorites.length;
      } else if (kind === "favorites" && browser.sidebar === "zen") {
        result.favorites = (await sidebars.zenSidebar()).essentials;
        count = result.favorites.length;
      } else if (kind === "passwords" && !chromium) {
        const outcome = await host.firefoxLogins(dir);
        if (outcome.error) throw new ImportFailure(outcome.error.code, outcome.error.message);
        if (outcome.failure && !outcome.items.length) throw snapshotFailure(outcome.failure, join(dir, "key4.db"), browser.name);
        result.credentials = outcome.items;
        count = outcome.items.length;
        secretWarnings(result, kind, outcome, "password", browser);
      } else if (kind === "cookies" && !chromium) {
        const file = join(dir, "cookies.sqlite");
        const outcome = await host.firefoxCookies(file);
        if (outcome.failure) throw snapshotFailure(outcome.failure, file, browser.name);
        result.cookieCount = outcome.count;
        if (outcome.token) result.vaultToken = outcome.token;
        count = outcome.count;
        if (outcome.skipped) result.warnings.push({ kind, code: "skipped", message: `${plural(outcome.skipped, "cookie")} from containers or private windows weren't imported` });
      } else if (kind === "passwords" && chromium) {
        const files = await loginFiles(host, dir);
        await unlocks.ensure(host, browser);
        const outcome = await host.logins(browser.id, files);
        if (outcome.failure && !outcome.items.length) throw snapshotFailure(outcome.failure, files[0]!, browser.name);
        if (outcome.failure) {
          const held = outcome.failure === "inUse";
          const message = held
            ? `${browser.name} is holding one of its password files, so some passwords stayed behind. Quit ${browser.name} and import again`
            : "Some saved passwords couldn't be read";
          result.warnings.push({ kind, code: held ? "locked" : "skipped", message });
        }
        result.credentials = outcome.items;
        count = outcome.items.length;
        secretWarnings(result, kind, outcome, "password", browser);
        if (!count && outcome.undecryptable > 0) throw new ImportFailure("locked", `The ${browser.name} key didn't decrypt any passwords`);
      } else if (kind === "cookies" && chromium) {
        const file = await cookieFile(host, dir);
        await unlocks.ensure(host, browser);
        const outcome = await host.cookies(browser.id, file);
        if (outcome.failure) throw snapshotFailure(outcome.failure, file, browser.name);
        result.cookieCount = outcome.count;
        if (outcome.token) result.vaultToken = outcome.token;
        count = outcome.count;
        secretWarnings(result, kind, outcome, "cookie", browser);
        if (!count && outcome.undecryptable > 0) throw new ImportFailure("locked", `The ${browser.name} key didn't decrypt any cookies`);
      } else {
        throw new ImportFailure("unsupported", `${browser.name} has no ${kind} to import on Windows`);
      }
      succeeded = true;
    } catch (error) {
      if (error instanceof ImportFailure && error.code === "cancelled") throw error;
      if (error instanceof ImportFailure && error.code === "notFound") result.warnings.push({ kind, code: "empty", message: error.message });
      else {
        result.failed.push(kind);
        const code = error instanceof ImportFailure ? warningCode(error.code) : "unreadable";
        result.warnings.push({ kind, code, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (kind !== "history" || !succeeded) observer.progress({ kind, phase: "end", processed: count, total: count });
  }
  if (chromium) {
    checkCancelled(observer);
    result.favicons = await readFavicons(host, [dir], faviconPages(result)).catch(() => []);
  }
  const zen = sidebars.loadedZen();
  if (zen) {
    result.favicons = zenFavicons(zen, faviconPages(result));
    result.separateEssentials = zen.separateEssentials;
  }
  return result;
}
