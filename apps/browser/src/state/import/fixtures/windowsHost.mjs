import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const fixtures = fileURLToPath(new URL("../../../../../../packages/import/fixtures/", import.meta.url));
export const support = join(fixtures, "home/Library/Application Support");
export const LOCAL = "C:\\Users\\tester\\AppData\\Local";
export const ROAMING = "C:\\Users\\tester\\AppData\\Roaming";

const MOUNTS = [
  [`${LOCAL}\\Google\\Chrome\\User Data`, join(support, "Google/Chrome")],
  [`${LOCAL}\\BraveSoftware\\Brave-Browser\\User Data`, join(support, "BraveSoftware/Brave-Browser")],
  [`${LOCAL}\\BraveSoftware\\Brave-Browser-Beta\\User Data`, join(support, "BraveSoftware/Brave-Browser-Beta")],
  [`${LOCAL}\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache\\Local\\Arc`, join(support, "Arc")],
  [`${ROAMING}\\Opera Software\\Opera Stable`, join(support, "com.operasoftware.Opera")],
  [`${ROAMING}\\Mozilla\\Firefox`, join(support, "Firefox")],
  [`${ROAMING}\\zen`, join(support, "zen")],
];

const onDisk = (windowsPath) => {
  for (const [prefix, folder] of MOUNTS) {
    if (windowsPath === prefix || windowsPath.startsWith(`${prefix}\\`)) return join(folder, ...windowsPath.slice(prefix.length).split("\\").filter(Boolean));
  }
  return null;
};

const cell = (value) => (value instanceof Uint8Array ? { blob: Buffer.from(value).toString("base64") } : typeof value === "bigint" ? Number(value) : value);

export function fakeHost(secrets = {}) {
  const calls = [];
  const open = new Map();
  return {
    calls,
    open,
    localAppData: LOCAL,
    roamingAppData: ROAMING,
    async list(path) {
      const folder = onDisk(path);
      if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) return null;
      return readdirSync(folder).map((name) => {
        const s = statSync(join(folder, name));
        return { name, dir: s.isDirectory(), size: s.size, modified: s.mtimeMs };
      });
    },
    async readText(path) {
      const file = onDisk(path);
      return file && existsSync(file) ? readFileSync(file, "utf8") : null;
    },
    async readBase64(path) {
      const file = onDisk(path);
      return file && existsSync(file) ? readFileSync(file).toString("base64") : null;
    },
    async query(path, queries) {
      const opened = await this.openSnapshot(path);
      if (opened.failure) return opened;
      try {
        return await this.querySnapshot(opened.id, queries);
      } finally {
        this.closeSnapshot(opened.id);
      }
    },
    async openSnapshot(path) {
      calls.push(["openSnapshot"]);
      const file = onDisk(path);
      if (!file || !existsSync(file)) return { failure: "missing" };
      const scratch = mkdtempSync(join(tmpdir(), "ardia-import-test-"));
      copyFileSync(file, join(scratch, "db.sqlite"));
      for (const suffix of ["-wal", "-journal"]) if (existsSync(file + suffix)) copyFileSync(file + suffix, join(scratch, `db.sqlite${suffix}`));
      const id = `s${open.size + 1}-${Math.random()}`;
      open.set(id, { db: new DatabaseSync(join(scratch, "db.sqlite")), scratch });
      return { id };
    },
    async querySnapshot(id, queries) {
      calls.push(["querySnapshot", queries.length]);
      const held = open.get(id);
      if (!held) return { failure: "closed" };
      const results = queries.map(({ sql, args = [], limit }) => {
        try {
          const statement = held.db.prepare(sql);
          statement.setReadBigInts(true);
          const columns = statement.columns().map((c) => c.name);
          const rows = statement.all(...args).slice(0, limit ?? Infinity).map((row) => columns.map((c) => cell(row[c])));
          return { columns, rows };
        } catch (error) {
          return { error: String(error.message) };
        }
      });
      return { results };
    },
    closeSnapshot(id) {
      const held = open.get(id);
      if (!held) return;
      held.db.close();
      rmSync(held.scratch, { recursive: true, force: true });
      open.delete(id);
    },
    async unlock(browserId) {
      calls.push(["unlock", browserId]);
      return { unlocked: secrets.unlocked ?? true, appBound: false };
    },
    async logins(browserId, files) {
      calls.push(["logins", browserId, files.length]);
      return secrets.logins ?? { items: [], undecryptable: 0, appBound: 0 };
    },
    async cookies(browserId) {
      calls.push(["cookies", browserId]);
      return secrets.cookies ?? { count: 0, undecryptable: 0, appBound: 0, dropped: 0 };
    },
    async firefoxLogins(profile) {
      calls.push(["firefoxLogins", profile]);
      return secrets.firefoxLogins ?? { items: [], undecryptable: 0, appBound: 0 };
    },
    async firefoxCookies(file) {
      calls.push(["firefoxCookies", file]);
      return secrets.firefoxCookies ?? { count: 0, undecryptable: 0, appBound: 0, dropped: 0, skipped: 0 };
    },
    async autofill(browserId, file, joinToken) {
      calls.push(["autofill", browserId, joinToken]);
      return secrets.autofill ?? { addresses: 0, cards: 0, lockedCards: 0, undecryptable: 0, appBound: 0 };
    },
    async writeImported() {
      return { cookies: 0, cookiesRejected: 0, cookiesExisting: 0, addresses: 0, cards: 0 };
    },
    discard() {},
    forget() {
      calls.push(["forget"]);
    },
  };
}
