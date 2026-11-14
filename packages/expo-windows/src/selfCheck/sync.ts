import { TurboModuleRegistry } from "react-native";
import type { SyncNative } from "@ardia/sync";
import { requireNativeModule } from "../modules";
import type { WindowsSyncModule } from "../nativeModuleTypes";
import { NATIVE_SYNC } from "../sync";
import { expectEqual, expectTrue, type Check } from "./check";
import { dataFolder } from "./importFiles";
import { MAC_VAULT } from "./syncFixture";

const native = () => {
  const module = TurboModuleRegistry.get<WindowsSyncModule>(NATIVE_SYNC);
  expectTrue(module, `${NATIVE_SYNC} is not registered`);
  return module;
};

const contract = () => requireNativeModule<NonNullable<typeof SyncNative>>("ArdiaSync");

const PRIMITIVES = ["aead", "kdf", "hmac", "tags", "words", "padding", "logins", "protectedStorage"];

const checkWith = (action: string, first = "", second = "", third = "") => native().checkWith(MAC_VAULT.entropy, action, first, second, third);

export const checks: Check[] = [
  {
    name: "sync: AES-GCM, HKDF and HMAC give their known answers, the sync tags and words match the Mac's, and the key survives a DPAPI round trip",
    async run() {
      const report = await native().selfTest();
      const failed = PRIMITIVES.filter((name) => report[name] !== true);
      expectEqual(failed, [], "sync primitives that failed");
    },
  },
  {
    name: "sync: a vault the Mac wrote opens on Windows, with its passwords sealed before they reach JS",
    async run() {
      expectEqual(await checkWith("chainTag"), MAC_VAULT.chainTag, "chain tag");
      expectEqual(await checkWith("words"), MAC_VAULT.words, "recovery words");
      for (const [scope, tag] of Object.entries(MAC_VAULT.scopeTags)) expectEqual(await checkWith("scopeTag", scope), tag, `${scope} tag`);
      const { origin, username, password, sealed } = MAC_VAULT.password;
      expectEqual(await checkWith("sealPassword", password, origin, username), sealed, "the sealed password");
      expectEqual(await checkWith("openLocal", MAC_VAULT.local.sealed), MAC_VAULT.local.plain, "the Mac's sealed local state");
      for (const file of MAC_VAULT.files) {
        const payload = await checkWith("open", file.scope, file.id, file.data);
        expectTrue(payload && !payload.endsWith(":"), `${file.scope} opened as ${payload}`);
        expectTrue(!payload.includes('"p":'), `a plaintext password reached JS from ${file.scope}`);
        if (file.scope !== "app") expectEqual(JSON.parse(payload), JSON.parse(file.payload), `${file.scope} payload`);
        expectEqual(await checkWith("open", file.scope, "aaaaaaaaaaaaaaaaaaaaaaaaaa", file.data), "damaged:", `${file.scope} under another file id`);
      }
      const resealed = await checkWith("seal", "app", "bbbbbbbbbbbbbbbbbbbbbbbbbb", '{"records":{"pw:1":{"k":"pw:1","v":{"o":"https://a.example","u":"ada","p":"secret"}}}}');
      expectTrue(resealed, "a document didn't seal");
      const reopened = await checkWith("open", "app", "bbbbbbbbbbbbbbbbbbbbbbbbbb", resealed);
      expectTrue(reopened && reopened.includes('"s":') && !reopened.includes("secret"), `a document sealed on Windows reopened as ${reopened}`);
    },
  },
  {
    name: "sync: a vault file is published, listed, read and removed through folder handles, and nothing lands in the working folder",
    async run() {
      const report = JSON.parse(await native().checkFiles(`${dataFolder()}\\sync-files-${Date.now().toString(36)}`)) as Record<string, string>;
      const wanted = { root: "0", scope: "0", publish: "ok", inScope: "yes", inWorkingFolder: "no", read: "0:hello", remove: "removed", afterRemove: "gone", removeFolder: "ok" };
      const got = Object.fromEntries(Object.keys(wanted).map((key) => [key, report[key]]));
      expectEqual(got, wanted, `file steps (${JSON.stringify(report)})`);
      expectTrue(report.list?.includes('"name":"aaaaaaaaaaaaaaaaaaaaaaaaaa.nns"'), `the listing was ${report.list}`);
    },
  },
  {
    name: "sync: the module turns on, writes, reads and removes in a folder, refuses to disclose the phrase without the owner check, and forgets its key",
    async run() {
      const sync = contract();
      const account = `selfcheck${Date.now().toString(36)}`;
      const folder = `${dataFolder()}\\sync-self-check-${Date.now().toString(36)}`;
      expectTrue(await sync.createPhrase(account), "createPhrase failed");
      try {
        expectEqual((await sync.folderInfo(folder)).exists, false, "a new folder exists");
        await sync.createChain(folder);
        expectEqual(await sync.chainStatus(folder), "ok", "chain status after createChain");
        expectEqual((await sync.folderInfo(folder)).hasSyncData, true, "the folder has sync data");
        const id = await sync.write(folder, "app", '{"n":1731500000000123,"t":"Ünïcode ✓"}');
        const listing = await sync.read(folder, "app", []);
        expectEqual(listing.files, [{ id, payload: '{"n":1731500000000123,"t":"Ünïcode ✓"}' }], "the files read back");
        expectEqual((await sync.read(folder, "app", [id])).present, [id], "a known file is still present");
        expectEqual(await sync.openLocal(await sync.sealLocal('{"local":true}')), '{"local":true}', "local state");
        expectEqual(await sync.recoveryWords(), null, "the phrase was disclosed without the owner check");
        await sync.remove(folder, "app", [id]);
        expectEqual((await sync.read(folder, "app", [])).present, [], "a removed file is gone");
        await sync.deleteChain(folder);
        expectEqual(await sync.chainStatus(folder), "missing", "chain status after deleteChain");
        expectTrue(await sync.unlock(account), "the stored key didn't unlock");
      } finally {
        await sync.forget(account);
      }
      expectEqual(await sync.unlock(account), false, "a forgotten key still unlocked");
    },
  },
];
