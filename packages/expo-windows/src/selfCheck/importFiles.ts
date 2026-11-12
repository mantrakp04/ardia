import { TurboModuleRegistry } from "react-native";
import type { DocumentsNative } from "@ardia/shell";
import { join } from "../import/host";
import { nativeImportHost } from "../import/nativeHost";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const host = () => {
  const made = nativeImportHost();
  expectTrue(made, "ArdiaWindowsImport has no Windows module");
  return made;
};

const documents = () => requireNativeModule<DocumentsNative>("ArdiaDocuments");

const dataFolder = () => {
  const folder = requireNativeModule<{ launchConfig(): { dataDirectory?: unknown } }>("ArdiaApp").launchConfig().dataDirectory;
  expectTrue(typeof folder === "string" && folder.length > 0, "the instance has no data folder");
  return folder;
};

async function written(name: string, contents: string): Promise<string> {
  documents().writeDocument(name, contents);
  await documents().documentSaved(name);
  return join(dataFolder(), name);
}

const unique = (stem: string) => `self-check-import-${stem}-${Date.now().toString(36)}`;

export const checks: Check[] = [
  {
    name: "import: the user's data folders are known and a folder lists its files",
    async run() {
      expectTrue(TurboModuleRegistry.get("ArdiaWindowsImport"), "ArdiaWindowsImport is not registered");
      const native = host();
      expectTrue(/^[A-Za-z]:\\/.test(native.localAppData) && /^[A-Za-z]:\\/.test(native.roamingAppData), `folders are ${native.localAppData} and ${native.roamingAppData}`);
      const name = `${unique("list")}.json`;
      await written(name, "{}");
      const listed = await native.list(dataFolder());
      expectTrue(Array.isArray(listed) && listed.some((e) => e.name === name && !e.dir && e.size === 2), `the data folder lists ${JSON.stringify(listed)?.slice(0, 200)}`);
      expectEqual(await native.list(join(dataFolder(), unique("absent"))), null, "a missing folder");
      documents().removeDocument(name);
    },
  },
  {
    name: "import: a file reads back as text and as base64",
    async run() {
      const native = host();
      const name = `${unique("read")}.json`;
      const path = await written(name, '{"café":1}');
      expectEqual(await native.readText(path, 1024), '{"café":1}', "the text");
      expectEqual(await native.readBase64(path, 1024), "eyJjYWbDqSI6MX0=", "the base64");
      expectEqual(await native.readText(path, 4), null, "a file over the size asked for");
      documents().removeDocument(name);
    },
  },
  {
    name: "import: a database is read from a snapshot, and only reads are allowed",
    async run() {
      const native = host();
      const name = unique("empty.sqlite");
      const path = await written(name, "");
      const answer = await native.query(path, [
        { sql: "SELECT count(*) AS n, ? AS echoed FROM sqlite_master", args: ["x"] },
        { sql: "CREATE TABLE t(x)" },
      ]);
      expectTrue("results" in answer, `the query failed: ${JSON.stringify(answer)}`);
      expectEqual(answer.results[0], { columns: ["n", "echoed"], rows: [[0, "x"]] }, "the read");
      expectEqual(answer.results[1]?.error, "only reads are allowed", "the write");
      expectEqual(await native.query(join(dataFolder(), unique("absent")), [{ sql: "SELECT 1" }]), { failure: "missing" }, "a missing database");
      expectEqual(await native.logins("self-check", [path]), { items: [], undecryptable: 0, appBound: 0 }, "logins from a database without them");
      expectEqual<unknown>(await native.cookies("self-check", path), { failure: "unreadable" }, "cookies from a database without them");
      documents().removeDocument(name);
    },
  },
  {
    name: "import: the browsers' secret stores are refused to the generic reads and ATTACH is off",
    async run() {
      const native = host();
      const path = await written("logins.json", "{}");
      expectEqual(await native.readText(path, 1024), null, "readText of logins.json");
      expectEqual(await native.readBase64(path, 1024), null, "readBase64 of logins.json");
      expectEqual(await native.query(path, [{ sql: "SELECT 1" }]), { failure: "refused" }, "a query of logins.json");
      documents().removeDocument("logins.json");
      const name = unique("attach.sqlite");
      const empty = await written(name, "");
      const answer = await native.query(empty, [{ sql: "ATTACH ? AS other", args: [empty] }]);
      expectTrue("results" in answer && !!answer.results[0]?.error, `ATTACH answered ${JSON.stringify(answer)}`);
      documents().removeDocument(name);
    },
  },
  {
    name: "import: a Local State without a usable key unlocks nothing and app-bound keys are noticed",
    async run() {
      const native = host();
      const plain = `${unique("state")}.json`;
      const bound = `${unique("bound")}.json`;
      const wrapped = await written(plain, JSON.stringify({ os_crypt: { encrypted_key: "RFBBUElub3QtYS1ibG9i" } }));
      const appBound = await written(bound, JSON.stringify({ os_crypt: { encrypted_key: "", app_bound_encrypted_key: "QVBQQg==" } }));
      expectEqual(await native.unlock("self-check", wrapped), { unlocked: false, appBound: false }, "a key Windows can't unwrap");
      expectEqual(await native.unlock("self-check", appBound), { unlocked: false, appBound: true }, "an app-bound key");
      let refused = "";
      await native.writeCookies("no-such-token", "Default").catch((error: unknown) => (refused = String((error as Error).message ?? error)));
      expectTrue(refused.includes("no longer kept"), `an unknown token was ${refused || "accepted"}`);
      native.discard("no-such-token");
      native.forget();
      documents().removeDocument(plain);
      documents().removeDocument(bound);
    },
  },
];
