#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { babelFor, transpile } from "./transpile-sync-bundle.mjs";

const [original, transpiled, appDirectory] = process.argv.slice(2);
if (!original || !transpiled || !appDirectory) {
  console.error("usage: check-sync-bundle.mjs <ardia-sync.js> <transpiled ardia-sync.js> <apps/phone>");
  process.exit(2);
}

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

function leftoverSyntax(code) {
  const { babel } = babelFor(appDirectory);
  const ast = babel.parseSync(code, { babelrc: false, configFile: false, sourceType: "script" });
  const found = new Map();
  const note = (kind, node) => {
    if (!found.has(kind)) found.set(kind, node.loc?.start.line ?? 0);
  };
  babel.traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.kind !== "var") note(path.node.kind, path.node);
    },
    Class(path) {
      note("class", path.node);
    },
    Function(path) {
      if (path.node.async) note("async function", path.node);
    },
    AwaitExpression(path) {
      note("await", path.node);
    },
  });
  return [...found].map(([kind, line]) => `${kind} at line ${line}`);
}

const leftovers = leftoverSyntax(readFileSync(transpiled, "utf8"));
if (leftovers.length) fail(`the transpiled sync bundle still has syntax React Native 0.81's Hermes runs differently: ${leftovers.join(", ")}`);

const loopSamples = `
globalThis.loopResults = (async () => {
  const counters = [];
  for (let i = 0; i < 3; i++) counters.push(() => i);
  const items = [];
  for (const item of ["a", "b", "c"]) items.push(() => item);
  const keyed = [];
  for (const key in { x: 1, y: 2 }) keyed.push(() => key);
  const later = [];
  for (const item of [1, 2, 3]) {
    await Promise.resolve();
    later.push(() => item * 10);
  }
  const nested = [];
  for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) nested.push(() => row + ":" + column);
  class Box {
    #value;
    constructor(value) { this.#value = value; }
    get value() { return this.#value; }
  }
  const boxes = [];
  for (const value of [7, 8]) boxes.push(() => new Box(value).value);
  return [counters, items, keyed, later, nested, boxes].map((list) => list.map((read) => read()));
})();
`;
const loopCode = transpile(loopSamples, appDirectory);
const loopLeftovers = leftoverSyntax(loopCode);
if (loopLeftovers.length) fail(`the loop samples kept ${loopLeftovers.join(", ")} after Babel`);
const loopContext = vm.createContext({ Promise });
vm.runInContext(loopCode, loopContext);
const loopResults = JSON.stringify(await loopContext.loopResults);
const loopExpected = JSON.stringify([[0, 1, 2], ["a", "b", "c"], ["x", "y"], [10, 20, 30], ["0:0", "0:1", "1:0", "1:1"], [7, 8]]);
if (loopResults !== loopExpected) fail(`a closure in a loop saw the wrong value after Babel: ${loopResults}, expected ${loopExpected}`);

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
console.log(`the transpiled sync bundle has only var bindings, its loop closures keep one binding per pass, and it matches the original over ${JSON.parse(expected).log.length} host calls`);
