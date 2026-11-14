#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";

const [original, transpiled] = process.argv.slice(2);
if (!original || !transpiled) {
  console.error("usage: check-sync-bundle.mjs <ardia-sync.js> <transpiled ardia-sync.js>");
  process.exit(2);
}

const START = Date.UTC(2026, 9, 1);
const PHONE = "phone0000000000000000000000";
const OTHER = "phoneother000000000000000000";

function device(source, folder, id, log) {
  let now = START;
  const FixedDate = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
  const context = vm.createContext({ Date: FixedDate, JSON, Math, Promise, Map, Set, Object, Array, String, Number, Boolean, Error, Symbol, RegExp, console });
  vm.runInContext(source, context, { filename: "ardia-sync.js" });
  let state = null;
  let journal = {};
  const listing = (scope, known) => {
    const files = [];
    const present = [];
    for (const [fileId, payload] of folder.get(scope) ?? []) {
      present.push(fileId);
      if (!known.includes(fileId)) files.push({ id: fileId, payload });
    }
    return { files, pending: [], damaged: [], present };
  };
  context.__host = {
    chainStatus: () => "ok",
    read: (scope, known) => JSON.stringify(listing(scope, JSON.parse(known))),
    write: (scope, payload) => {
      const files = folder.get(scope) ?? new Map();
      folder.set(scope, files);
      const fileId = `f${String((folder.counter = (folder.counter ?? 0) + 1)).padStart(5, "0")}`;
      files.set(fileId, payload);
      log.push(["write", id, scope, payload]);
      return fileId;
    },
    remove: (scope, ids) => {
      for (const fileId of JSON.parse(ids)) folder.get(scope)?.delete(fileId);
      log.push(["remove", id, scope, ids]);
      return "";
    },
    persistJournal: (scope, batches) => {
      journal[scope] = [...(journal[scope] ?? []), ...JSON.parse(batches).map((raw) => JSON.parse(raw))];
      log.push(["journal", id, scope, batches]);
      return "ok";
    },
    saveState: (json, seqs) => {
      state = json;
      const saved = JSON.parse(seqs);
      for (const scope of Object.keys(journal)) journal[scope] = journal[scope].filter((f) => f.seq > (saved[scope] ?? 0));
      log.push(["state", id, json]);
      return "ok";
    },
  };
  const api = () => context.ArdiaSync;
  return {
    at: (time) => (now = time),
    load: () => api().companionLoad({ device: id, state: state ? JSON.parse(state) : null, journal, fresh: !state }),
    unload: () => api().companionUnload(),
    cycle: async (input) => JSON.parse(JSON.stringify(await api().runCompanionCycle({ ...input, now }))),
    call: (name, input) => JSON.parse(JSON.stringify(api()[name](input))),
  };
}

async function scenario(source) {
  const folder = new Map();
  const log = [];
  const outputs = [];
  const phone = device(source, folder, PHONE, log);
  const other = device(source, folder, OTHER, log);
  let time = START;
  const step = async (who, input) => {
    time += 15_000;
    who.at(time);
    outputs.push(await who.cycle(input));
  };
  phone.load();
  other.load();
  const tabs = Array.from({ length: 35 }, (_, i) => ({ u: `https://site${i}.example/`, t: `Site ${i}`, at: START + i }));
  const visits = tabs.slice(0, 12).map((tab, i) => ({ u: tab.u, t: tab.t, vt: [START + i, START + i + 60_000] }));
  await step(phone, { name: "Phone", tabs, visits });
  await step(other, { name: "Other", tabs: [{ u: "https://other.example/", t: "Other", at: START }], visits: [] });
  await step(phone, { name: "Phone", tabs, visits });
  outputs.push(phone.call("companionSend", { profile: "none", key: "k1", u: "https://sent.example/", t: "Sent", to: OTHER, at: time }));
  outputs.push(phone.call("companionAddBookmark", { profile: "none", key: "b1", u: "https://pinned.example/", t: "Pinned", at: time }));
  await step(phone, { name: "Phone renamed", tabs: tabs.slice(5), visits });
  phone.unload();
  phone.load();
  await step(phone, { name: "Phone renamed", tabs: tabs.slice(5), visits });
  await step(other, { name: "Other", tabs: [], visits: [] });
  return JSON.stringify({ outputs, log });
}

const expected = await scenario(readFileSync(original, "utf8"));
const actual = await scenario(readFileSync(transpiled, "utf8"));
if (expected !== actual) {
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) at++;
  console.error(`the transpiled sync bundle behaves differently at character ${at}:\n  original:   ${expected.slice(at - 80, at + 120)}\n  transpiled: ${actual.slice(at - 80, at + 120)}`);
  process.exit(1);
}
console.log(`the transpiled sync bundle matches the original over ${JSON.parse(expected).log.length} host calls`);
