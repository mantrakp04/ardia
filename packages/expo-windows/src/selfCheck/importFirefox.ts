import { join } from "../import/host";
import { expectEqual, expectTrue, type Check } from "./check";
import { dataFolder, host } from "./importFiles";

const fixture = (name: "firefox" | "work" | "zen") => join(dataFolder(), "import-fixtures", name);

const passwords = (items: { password: string }[]) => items.map((c) => c.password);

export const checks: Check[] = [
  {
    name: "import: Firefox's 3DES logins.json and Zen's AES logins.db with logins.json decrypt with no primary password",
    async run() {
      const native = host();
      const firefox = await native.firefoxLogins(fixture("firefox"));
      expectEqual(firefox.error, undefined, "Firefox's error");
      expectEqual(passwords(firefox.items), ["fire & fox", "パスワード🔒"], "Firefox's passwords");
      expectEqual(firefox.items[1]?.username, "ユーザー", "a username with non-Latin letters");
      expectEqual(firefox.items[1]?.url, "https://unicode.example", "a login with no form address keeps its host");
      const zen = await native.firefoxLogins(fixture("zen"));
      expectEqual(zen.error, undefined, "Zen's error");
      expectEqual(passwords(zen.items), ["workspace pass", "local edit", "from sync", "only in json"], "Zen's passwords");
      expectEqual([zen.items[0]?.username, zen.items[0]?.realm, zen.items[0]?.timesUsed], ["zen@example.com", "https://zen.example", 1], "Zen's first login");
    },
  },
  {
    name: "import: a Firefox profile with a primary password is locked and a folder with no logins has none",
    async run() {
      const native = host();
      const work = await native.firefoxLogins(fixture("work"));
      expectEqual(work, { items: [], undecryptable: 0, appBound: 0, error: { code: "locked", message: "Wrong Firefox primary password" } }, "the work profile");
      const empty = await native.firefoxLogins(join(dataFolder(), "import-fixtures"));
      expectEqual(empty.error?.code, "notFound", "a folder without logins");
    },
  },
  {
    name: "import: Firefox cookies stay native behind a token, and container and private ones are counted out",
    async run() {
      const native = host();
      const read = await native.firefoxCookies(join(fixture("firefox"), "cookies.sqlite"));
      expectEqual([read.count, read.skipped, read.dropped, read.failure], [6, 3, 0, undefined], "count, skipped, dropped and failure");
      expectTrue(typeof read.token === "string" && /^[0-9a-f]{32}$/.test(read.token), `the token is ${read.token}`);
      native.discard(read.token);
      let refused = "";
      await native.writeCookies(read.token, "Default").catch((error: unknown) => (refused = String((error as Error).message ?? error)));
      expectTrue(refused.includes("no longer kept"), `a discarded token was ${refused || "accepted"}`);
      expectEqual<unknown>(await native.firefoxCookies(join(fixture("firefox"), "logins.json")), { failure: "unreadable" }, "cookies from a file that isn't a database");
    },
  },
];
