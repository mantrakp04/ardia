import { TurboModuleRegistry } from "react-native";
import type { ConfigNative, DocumentsNative, KeychainNative, TelemetryLocalNative } from "@ardia/shell";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const DEADLINE_MS = 5000;

function native<Module>(name: string): Module {
  expectTrue(TurboModuleRegistry.get(name), `${name} has no Windows module`);
  return requireNativeModule<Module>(name);
}

const documents = () => native<DocumentsNative>("ArdiaDocuments");
const config = () => native<ConfigNative>("ArdiaConfig");
const keychain = () => native<KeychainNative>("ArdiaKeychain");
const telemetry = () => native<TelemetryLocalNative>("ArdiaTelemetryLocal");

function within<Value>(promise: Promise<Value>, what: string): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} did not settle within ${DEADLINE_MS} ms`)), DEADLINE_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const checks: Check[] = [
  {
    name: "storage: a document is written, read back, overwritten and removed",
    async run() {
      const name = `${unique("self-check")}.json`;
      const store = documents();
      expectEqual(store.readDocument(name), null, "a new document");
      store.writeDocument(name, '{"n":1}');
      expectEqual(store.readDocument(name), '{"n":1}', "the written document");
      store.writeDocument(name, '{"n":2,"text":"café \u{1f600}"}');
      expectEqual(store.readDocument(name), '{"n":2,"text":"café \u{1f600}"}', "the overwritten document");
      await within(store.documentSaved(name), "documentSaved after a write");
      expectEqual(store.readDocument(name), '{"n":2,"text":"café \u{1f600}"}', "the document after it landed on disk");
      store.removeDocument(name);
      expectEqual(store.readDocument(name), null, "the removed document");
    },
  },
  {
    name: "storage: a save resolves and documentSaved follows it",
    async run() {
      const name = `${unique("self-check")}.json`;
      const store = documents();
      const saved = store.saveDocument(name, "first");
      store.writeDocument(name, "second");
      const landed = store.documentSaved(name);
      await within(saved, "saveDocument");
      await within(landed, "documentSaved after a save");
      expectEqual(store.readDocument(name), "second", "the document after the save and a later write");
      await within(store.documentSaved(unique("never-written")), "documentSaved for a document nobody wrote");
      store.removeDocument(name);
    },
  },
  {
    name: "storage: a document name with folders uses only its last part",
    async run() {
      const leaf = `${unique("self-check")}.json`;
      const store = documents();
      store.writeDocument(`nested/folder/${leaf}`, "leaf");
      expectEqual(store.readDocument(leaf), "leaf", "the document read by its last part");
      await within(store.documentSaved(leaf), "documentSaved for the nested name");
      store.removeDocument(leaf);
      expectEqual(store.readDocument(`nested/folder/${leaf}`), null, "the removed nested document");
    },
  },
  {
    name: "storage: config files that are missing or not allowed read as such",
    run() {
      const folder = config();
      expectEqual(folder.readFile("config.json").status, "missing", "config.json in a fresh config folder");
      const hooks = folder.readFile("hooks.json");
      expectEqual([hooks.status, hooks.stamp], ["missing", "missing"], "hooks.json in a fresh config folder");
      expectEqual(folder.readFile("themes/self-check.json").status, "missing", "a theme that does not exist");
      expectEqual(folder.readFile("secrets.txt").status, "unreadable", "a file outside the config names");
      expectEqual(folder.readFile("themes/../config.json").status, "unreadable", "a theme name that climbs out of themes");
    },
  },
  {
    name: "storage: schemas are written once and skipped when unchanged",
    async run() {
      const folder = config();
      const files = { "config.schema.json": '{"title":"self check"}', "not-a-schema.json": "{}" };
      const written = await within(folder.writeSchemas(files), "writeSchemas");
      expectTrue(written.length >= 1, `writeSchemas wrote ${JSON.stringify(written)}`);
      expectTrue(
        written.every((path) => path.endsWith("config.schema.json")),
        `writeSchemas wrote a file that is not a schema: ${JSON.stringify(written)}`,
      );
      expectEqual(await within(folder.writeSchemas(files), "writeSchemas again"), [], "the second writeSchemas with the same contents");
    },
  },
  {
    name: "storage: watching the config folder arms",
    async run() {
      await within(config().watch(["config.json", "hooks.json", "themes/self-check.json", "not-watchable.txt"]), "watch");
      await within(config().watch(["config.json"]), "watch again with other names");
    },
  },
  {
    name: "storage: a keychain secret is set, read, replaced and deleted",
    async run() {
      const account = unique("self-check-account");
      const secrets = keychain();
      try {
        expectEqual(await within(secrets.get(account), "get before set"), null, "an account with no secret");
        expectEqual(await within(secrets.set(account, "s3cret é"), "set"), true, "set");
        expectEqual(await within(secrets.get(account), "get"), "s3cret é", "the stored secret");
        const long = "x".repeat(6000) + "end";
        expectEqual(await within(secrets.set(account, long), "set a long secret"), true, "set a long secret");
        expectEqual(await within(secrets.get(account), "get a long secret"), long, "the stored long secret");
        expectEqual(await within(secrets.set(account, "short"), "set a short secret again"), true, "set a short secret again");
        expectEqual(await within(secrets.get(account), "get the short secret"), "short", "the secret after shrinking");
        expectEqual(await within(secrets.delete(account), "delete"), true, "delete");
        expectEqual(await within(secrets.get(account), "get after delete"), null, "the deleted secret");
        expectEqual(await within(secrets.delete(account), "delete again"), true, "deleting a missing secret");
      } finally {
        await within(secrets.delete(account), "delete after the check");
      }
    },
  },
  {
    name: "storage: local telemetry appends, prunes, exports and clears",
    async run() {
      const local = telemetry();
      const now = Date.now();
      const day = utcDay(now);
      await within(local.clear(), "clear");
      local.configure(8 * 1_048_576, 7);
      local.appendNow(day, `{"at":${now},"event":"self_check_now"}\n`);
      local.append(day, `{"at":${now + 1},"event":"self_check_later"}\n`);
      local.append("not-a-day", `{"at":${now},"event":"ignored"}\n`);
      const stats = await within(local.prune(now), "prune");
      expectEqual([stats.lines, stats.files], [2, 1], "lines and files after two appends");
      expectTrue(stats.bytes > 0 && stats.writeMs.length >= 2, `prune stats ${JSON.stringify(stats)}`);
      const report = await within(local.exportForReport(now - 60_000), "exportForReport");
      expectTrue(report && report.lines === 2 && report.bytes > 0 && report.path.endsWith(".jsonl.gz"), `exportForReport gave ${JSON.stringify(report)}`);
      await within(local.clear(), "clear again");
      const cleared = await within(local.prune(now), "prune after clear");
      expectEqual([cleared.lines, cleared.files], [0, 0], "lines and files after clear");
    },
  },
];
