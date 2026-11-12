import { findBrowser, isChromiumBased, type Browser } from "./browsers";
import { chromiumBookmarks, faviconPages, readFavicons, readHistory } from "./chromium";
import { dataDirectory, profileDirectory } from "./discovery";
import { firefoxBookmarks, loadFirefoxSession } from "./firefox";
import { entries, join, type ImportHost, type Secrets } from "./host";
import { checkCancelled, ImportFailure, KIND_ORDER, linkCount, plural, warningCode, type ImportKind, type Observer, type Options, type Result } from "./model";
import { loadSession } from "./sessions";
import { snapshotFailure } from "./sqlite";

export class Unlocks {
  private unlocked = new Set<string>();

  async ensure(host: ImportHost, browser: Browser): Promise<void> {
    if (!isChromiumBased(browser) || this.unlocked.has(browser.id)) return;
    const answer = await host.unlock(browser.id, join(dataDirectory(host, browser), "Local State"));
    if (!answer.unlocked) throw new ImportFailure("locked", `Windows didn't give Ardia ${browser.name}'s key`);
    this.unlocked.add(browser.id);
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
      } else if (kind === "tabs" && browser.family !== "arc") {
        const session = chromium ? await loadSession(host, dir) : await loadFirefoxSession(host, dir);
        result.tabs = session.tabs;
        result.tabGroups = session.groups;
        count = session.tabs.length;
      } else if (kind === "passwords" && chromium) {
        const files = await loginFiles(host, dir);
        await unlocks.ensure(host, browser);
        const outcome = await host.logins(browser.id, files);
        if (outcome.failure && !outcome.items.length) throw snapshotFailure(outcome.failure, files[0]!, browser.name);
        result.credentials = outcome.items;
        count = outcome.items.length;
        secretWarnings(result, kind, outcome, "password", browser);
        if (!count && outcome.undecryptable + outcome.appBound > 0) throw new ImportFailure("locked", `The ${browser.name} key didn't decrypt any passwords`);
      } else if (kind === "cookies" && chromium) {
        const file = await cookieFile(host, dir);
        await unlocks.ensure(host, browser);
        const outcome = await host.cookies(browser.id, file);
        if (outcome.failure) throw snapshotFailure(outcome.failure, file, browser.name);
        result.cookieCount = outcome.count;
        if (outcome.token) result.vaultToken = outcome.token;
        count = outcome.count;
        secretWarnings(result, kind, outcome, "cookie", browser);
        if (!count && outcome.undecryptable + outcome.appBound > 0) throw new ImportFailure("locked", `The ${browser.name} key didn't decrypt any cookies`);
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
  return result;
}
