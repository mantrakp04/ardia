import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launch, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const HELP = `usage: node custom-filters-test.mjs <Debug Ardia.app> [--out <dir>] [--network] [--keep]

Custom uBlock Origin filter lists and My filters in Settings › Privacy & Security › Advanced…, end to end in a hidden instance
with its own data dir. Drives the real Settings components (the add field, Add List, each list's checkbox, Update
and Remove, the My Filters sheet) and checks what pages on a local fixture server show and fetch:
adding a list (it applies), the add field's validation, duplicates, a missing, an HTML, an empty and an unreachable
list (each refused and rolled back), a built-in list's address, turning a list off and on, updating it (new rules
apply), an update that fails (the list and its rules stay), My filters, repeated Enter/Add while a list downloads
(one download), dismissing My filters while it saves (it stays open), a second profile following the default one,
everything still there after a relaunch, and removing a list. --network also adds and removes a real list
(gijsdev/ublock-hide-yt-shorts). Writes settings snapshots, state dumps and a log to --out (default
/tmp/ardia-custom-filters).`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, network: { type: "boolean" }, keep: { type: "boolean" }, help: { type: "boolean", short: "h" } },
});
if (flags.help || !positionals[0]) {
  console.log(HELP);
  process.exit(flags.help ? 0 : 2);
}

const app = resolve(positionals[0]);
const out = resolve(flags.out ?? "/tmp/ardia-custom-filters");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const data = join(out, "data");
const rep = reporter(join(out, "custom-filters-test.log"), { name: "custom-filters-test" });

const fixture = { status: 200, body: "", trackerHits: [] };
const LIST_V1 = ["! Title: Ardia E2E list", "! Expires: 1 day", "127.0.0.1##.e2e-shorts", "/e2e-tracker.js"].join("\n");
const LIST_V2 = `${LIST_V1}\n127.0.0.1##.e2e-promo`;
fixture.body = LIST_V1;
const PAGE = `<!doctype html><title>E2E page</title><div class="e2e-shorts">shorts</div><div class="e2e-promo">promo</div><div class="e2e-mine">mine</div>`;
const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  if (path === "/list.txt") {
    res.writeHead(fixture.status, { "content-type": "text/plain" });
    return res.end(fixture.status === 200 ? fixture.body : "server error");
  }
  if (path === "/empty.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("! Title: Nothing here\n! only comments\n");
  }
  if (path === "/page.html") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(PAGE);
  }
  if (path === "/e2e-tracker.js") {
    fixture.trackerHits.push(req.url);
    res.writeHead(200, { "content-type": "application/javascript" });
    return res.end("window.trackerRan = true;");
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const LIST = `${origin}/list.txt`;
const closedPort = await new Promise((r) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const port = s.address().port;
    s.close(() => r(port));
  });
});

const UI = `
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const roots = () => [...hook.renderers.keys()].flatMap((id) => [...hook.getFiberRoots(id)].map((r) => r.current));
const nameOf = (f) => (typeof f.type === "string" ? f.type : f.type?.displayName || f.type?.name || f.type?.render?.name || "");
const find = (test, from) => {
  for (const root of from ? [from] : roots()) {
    const stack = [root];
    while (stack.length) {
      const f = stack.pop();
      if (test(f)) return f;
      for (let c = f.child; c; c = c.sibling) stack.push(c);
    }
  }
  return null;
};
const named = (name, from, extra = () => true) => find((f) => nameOf(f) === name && extra(f), from);
const texts = (from) => {
  const out = [];
  const walk = (f) => {
    if (typeof f.memoizedProps === "string") out.push(f.memoizedProps);
    else if (nameOf(f) === "RCTRawText") out.push(String(f.memoizedProps?.text ?? ""));
    for (let c = f.child; c; c = c.sibling) walk(c);
  };
  if (from) walk(from);
  return out;
};
const section = () => {
  const s = named("CustomFiltersSection");
  if (!s) {
    ac.openSettings("privacy");
    named("Button", null, (f) => f.memoizedProps?.title === "Advanced…")?.memoizedProps.onPress();
    throw new Error("no CustomFiltersSection on screen; opened Advanced…");
  }
  return s;
};
const button = (title, from) => {
  const b = named("Button", from, (f) => f.memoizedProps?.title === title);
  if (!b) throw new Error("no button " + title);
  return b.memoizedProps;
};
const rowOf = (id) => find((f) => nameOf(f) === "Row" && f.key === id, section());
const sheet = () => named("MyFiltersSheet");
`;

let inst;
const ui = (body, timeout = 20000) => inst.eval(`${UI}\n${body}`, { timeout });
const cef = (call, timeout = 90000) => inst.eval(`return globalThis.expo.modules.ArdiaCEF.${call}`, { timeout });
const until = async (what, test, ms = 30000) => {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await test();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    if (Date.now() > end) throw new Error(`${what}: timed out (last: ${JSON.stringify(last)?.slice(0, 300)})`);
    await sleep(200);
  }
};
const state = () => cef("getContentBlocker()");
const customLists = async () => (await state()).customLists ?? [];
const sectionText = () => ui(`return texts(section()).join(" | ")`);
const dump = async (name) => writeFileSync(join(out, `${name}.json`), JSON.stringify(await state(), null, 2));

const withNativeGate = async (method, run) => {
  await ui(`
    if (globalThis.__customFiltersGate) throw new Error("a native gate is already installed");
    const module = globalThis.expo.modules.ArdiaCEF;
    const original = module[${JSON.stringify(method)}];
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const probe = { calls: [], pending: [], original };
    probe.release = () => { clearTimeout(probe.timer); release(); };
    probe.timer = setTimeout(probe.release, 30000);
    const wrapped = (...args) => {
      probe.calls.push(args);
      const pending = ready.then(() => original.apply(module, args));
      probe.pending.push(pending);
      return pending;
    };
    module[${JSON.stringify(method)}] = wrapped;
    if (module[${JSON.stringify(method)}] !== wrapped) {
      probe.release();
      throw new Error("cannot gate native method " + ${JSON.stringify(method)});
    }
    globalThis.__customFiltersGate = probe;
    return true;
  `);
  try {
    return await run();
  } finally {
    await ui(`
      const probe = globalThis.__customFiltersGate;
      probe.release();
      return Promise.allSettled(probe.pending).then(() => {
        globalThis.expo.modules.ArdiaCEF[${JSON.stringify(method)}] = probe.original;
        delete globalThis.__customFiltersGate;
        return true;
      });
    `, 120000);
  }
};

const snapshot = async (name) => {
  await sleep(600);
  const path = join(out, `${name}.png`);
  const ok = await inst.eval(`return ac.shell.devSnapshotWindow("settings", ${JSON.stringify(path)})`, { timeout: 15000 });
  if (!ok) throw new Error(`no snapshot ${name}`);
  return path;
};

const openPrivacy = async () => {
  await inst.eval(`ac.openSettings("privacy"); return true`);
  await until("the Advanced… sheet", () => ui(`return !!section()`));
  await until("the blocker's state in Settings", () => ui(`return !!button("Add List", section())`));
};

const typeUrl = (url) => ui(`named("TextField", section()).memoizedProps.onChangeText(${JSON.stringify(url)}); return true`);
const pressAdd = () => ui(`const b = button("Add List", section()); if (b.disabled) throw new Error("Add List is disabled"); b.onPress(); return true`);
const addThroughUi = async (url) => {
  await typeUrl(url);
  await sleep(150);
  await pressAdd();
  await sleep(150);
  return until(`the add of ${url} to finish`, async () => {
    const text = await sectionText();
    return text.includes("Downloading the list") ? null : text;
  }, 120000);
};
const rowButton = (id, title) =>
  ui(`const row = rowOf(${JSON.stringify(id)}); if (!row) throw new Error("no row"); const b = button(${JSON.stringify(title)}, row); if (b.disabled) throw new Error(${JSON.stringify(title)} + " is disabled"); b.onPress(); return true`);
const rowCheckbox = (id, on) =>
  ui(`const row = rowOf(${JSON.stringify(id)}); if (!row) throw new Error("no row"); named("Checkbox", row).memoizedProps.onChange(${on}); return true`);
const rowText = (id) => ui(`const row = rowOf(${JSON.stringify(id)}); return row ? texts(row).join(" | ") : null`);
const rowSettled = (id) =>
  until(`${id}'s row to settle`, async () => {
    const t = await rowText(id);
    return t === null || !/(Updating|Turning on|Turning off|Removing)…/.test(t) ? t ?? "gone" : null;
  }, 120000);

const mainWindow = async () =>
  inst.eval(`const s = ac.store.getState(); return Object.values(s.windows).filter((w) => !w.incognito && w.kind !== "small" && w.kind !== "settings").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0]?.id ?? null`);

let pageSeq = 0;
const visit = async (profileId) => {
  const tag = `v${++pageSeq}-${Date.now()}`;
  const url = `${origin}/page.html?${tag}`;
  let windowId = null;
  let tabId;
  if (profileId) {
    windowId = await inst.eval(`return ac.actions.openWindow({ profileId: ${JSON.stringify(profileId)}, url: ${JSON.stringify(url)} })`);
    tabId = await until("the profile's tab", () => inst.eval(`return ac.store.getState().windows[${JSON.stringify(windowId)}]?.tabIds[0] ?? null`));
  } else {
    const w = await until("a browser window", mainWindow);
    tabId = await inst.eval(`return ac.store.getState().newTab(${JSON.stringify(w)}, { url: ${JSON.stringify(url)} })`);
  }
  try {
    const page = await inst.page(tag, { timeout: 30000 });
    try {
      await until("the page", () => page.eval(`document.readyState === "complete" && !!document.querySelector(".e2e-mine")`), 30000);
      await sleep(1200);
      const hitsBefore = fixture.trackerHits.length;
      const seen = await page.eval(`(() => {
        const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== "none";
        return new Promise((r) => {
          const s = document.createElement("script");
          s.src = "/e2e-tracker.js?${tag}";
          s.onload = () => r("loaded");
          s.onerror = () => r("blocked");
          document.head.append(s);
        }).then((tracker) => ({ shorts: shown(".e2e-shorts"), promo: shown(".e2e-promo"), mine: shown(".e2e-mine"), tracker }));
      })()`);
      return { ...seen, trackerReachedServer: fixture.trackerHits.length > hitsBefore };
    } finally {
      page.close();
    }
  } finally {
    if (windowId) await inst.eval(`ac.store.getState().closeWindow(${JSON.stringify(windowId)}); return true`);
    else await inst.eval(`ac.store.getState().closeTab(${JSON.stringify(tabId)}); return true`);
  }
};
const expectPage = (seen, want) => {
  for (const [k, v] of Object.entries(want)) if (seen[k] !== v) throw new Error(`page: ${k} is ${seen[k]}, wanted ${v} (${JSON.stringify(seen)})`);
  return seen;
};
const waitForPage = (profileId, want, what) => until(what, async () => expectPage(await visit(profileId), want), 90000);
const BLOCKED = { shorts: false, tracker: "blocked", trackerReachedServer: false };
const UNBLOCKED = { shorts: true, tracker: "loaded", trackerReachedServer: true };

const boot = async () => {
  inst = await launch(app, { data, onboarded: true, ready: "return !!ac.openSettings" });
  rep.log(`instance pid ${inst.pid} port ${inst.port} data ${data}`);
  await until("the blocker", async () => ((await state())?.stats?.ready ? true : null), 90000);
  await openPrivacy();
};

let secondProfile = null;
const bundledStockList = () => {
  const assets = JSON.parse(readFileSync(join(app, "Contents/Resources/Extensions/ublock/assets/assets.json"), "utf8"));
  for (const [id, a] of Object.entries(assets)) {
    if (a.content !== "filters" || a.off !== true || a.lang) continue;
    const url = [a.contentURL].flat().find((u) => typeof u === "string" && /^https:\/\/ublockorigin\.github\.io\//.test(u));
    if (url) return { id, url };
  }
  return null;
};

try {
  await rep.check("boot", async () => {
    await boot();
    const s = await state();
    if ((s.customLists ?? []).length) throw new Error("a fresh profile already has custom lists");
    await dump("state-0-fresh");
    return { lists: s.lists.length, custom: 0, before: expectPage(await visit(), UNBLOCKED) };
  });

  await rep.check("ui-empty", async () => ({ snapshot: await snapshot("1-empty"), add: await ui(`return button("Add List", section()).disabled`) }));

  await rep.check("validation-not-a-url", async () => {
    const text = await addThroughUi("youtube shorts list");
    if (!text.includes("starting with http:// or https://")) throw new Error(`no validation message: ${text}`);
    if ((await customLists()).length) throw new Error("something was added");
    return { message: text, snapshot: await snapshot("2-validation") };
  });

  await rep.check("add-list", async () => {
    await typeUrl(LIST);
    await until("the add field's value", () => ui(`return named("TextField", section()).memoizedProps.value === ${JSON.stringify(LIST)}`));
    const calls = await withNativeGate("addFilterList", async () => {
      await ui(`
        const submit = named("TextField", section()).memoizedProps.onSubmit;
        const add = button("Add List", section());
        if (add.disabled) throw new Error("Add List is disabled");
        submit();
        submit();
        add.onPress();
        return true;
      `);
      await until("the pending add", async () => (await sectionText()).includes("Downloading the list"));
      return ui(`named("TextField", section()).memoizedProps.onSubmit(); return globalThis.__customFiltersGate.calls.length`);
    });
    if (calls !== 1) throw new Error(`Enter, Enter, Add List and Enter while downloading made ${calls} native add calls, wanted 1`);
    const text = await until("the add to finish", async () => {
      const text = await sectionText();
      return text.includes("Downloading the list") ? null : text;
    }, 120000);
    if (!text.includes("Added Ardia E2E list with 2 filters")) throw new Error(`unexpected status: ${text}`);
    const l = (await customLists()).find((x) => x.id === LIST);
    if (!l?.enabled || l.filters !== 2 || !l.updatedAt || l.title !== "Ardia E2E list") throw new Error(`state: ${JSON.stringify(l)}`);
    await dump("state-1-added");
    return { calls, status: text, list: l, snapshot: await snapshot("3-added") };
  });

  await rep.check("add-list-applies", async () => expectPage(await visit(), BLOCKED));

  await rep.check("second-profile-gets-list", async () => {
    secondProfile = await inst.eval(`return ac.store.getState().createProfile({ name: "Work" })`);
    if (!secondProfile) throw new Error("no profile made");
    const seen = await until("the second profile's blocking", async () => {
      const v = await visit(secondProfile);
      return v.shorts === false ? v : null;
    }, 90000);
    return { profile: secondProfile, page: expectPage(seen, BLOCKED) };
  });

  await rep.check("add-duplicate", async () => {
    const text = await addThroughUi(LIST);
    if (!text.includes("You already have this list")) throw new Error(`no duplicate message: ${text}`);
    if ((await customLists()).length !== 1) throw new Error("a second copy was added");
    return text;
  });

  for (const [name, url, expect] of [
    ["add-missing-404", `${origin}/missing.txt`, "Couldn't download the list"],
    ["add-html-page", `${origin}/page.html`, "Couldn't download the list"],
    ["add-empty-list", `${origin}/empty.txt`, "No filters found"],
    ["add-unreachable", `http://127.0.0.1:${closedPort}/list.txt`, "Couldn't download the list"],
  ])
    await rep.check(name, async () => {
      const t0 = Date.now();
      const text = await addThroughUi(url);
      if (!text.includes(expect)) throw new Error(`wanted "${expect}": ${text}`);
      const lists = await customLists();
      if (lists.some((l) => l.id === url)) throw new Error("the failed list stayed");
      if (lists.length !== 1) throw new Error(`lists: ${JSON.stringify(lists)}`);
      if (name === "add-missing-404") await snapshot("4-add-error");
      return { message: text, ms: Date.now() - t0 };
    });

  await rep.check("add-builtin-address", async () => {
    const stock = bundledStockList();
    if (!stock) throw new Error("Missing built-in-address fixture: bundled uBlock assets/assets.json has no off-by-default, non-language filter list with a ublockorigin.github.io address");
    const text = await addThroughUi(stock.url);
    if (!text.includes("one of the built-in lists")) throw new Error(`unexpected: ${text}`);
    const s = await state();
    if (!s.lists.find((l) => l.id === stock.id)?.enabled) throw new Error(`${stock.id} isn't on`);
    if ((s.customLists ?? []).length !== 1) throw new Error("it was added as a custom list too");
    await cef(`setFilterListEnabled(${JSON.stringify(stock.id)}, false)`);
    return { stock, message: text };
  });

  await rep.check("toggle-off", async () => {
    await rowCheckbox(LIST, false);
    await rowSettled(LIST);
    const l = (await customLists()).find((x) => x.id === LIST);
    if (l?.enabled !== false) throw new Error(`still on: ${JSON.stringify(l)}`);
    const row = await rowText(LIST);
    if (!row.startsWith("Ardia E2E list | Off")) throw new Error(`row: ${row}`);
    const updateDisabled = await ui(`return button("Update", rowOf(${JSON.stringify(LIST)})).disabled`);
    if (!updateDisabled) throw new Error("Update is enabled on a list that's off");
    return { row, page: expectPage(await visit(), UNBLOCKED), snapshot: await snapshot("5-off") };
  });

  await rep.check("update-while-off-refused", async () => {
    const error = await cef(`updateFilterList(${JSON.stringify(LIST)}).then(() => "updated", (e) => e.message)`);
    if (!String(error).includes("Turn the list on")) throw new Error(`got ${error}`);
    return error;
  });

  await rep.check("toggle-on", async () => {
    await rowCheckbox(LIST, true);
    await rowSettled(LIST);
    const l = (await customLists()).find((x) => x.id === LIST);
    if (!l?.enabled) throw new Error(`still off: ${JSON.stringify(l)}`);
    return expectPage(await visit(), BLOCKED);
  });

  await rep.check("update", async () => {
    const before = (await customLists()).find((x) => x.id === LIST);
    fixture.body = LIST_V2;
    await sleep(1100);
    await rowButton(LIST, "Update");
    await until("Updating… in the row", async () => ((await rowText(LIST)) ?? "").includes("Updating") || (await customLists()).find((x) => x.id === LIST)?.filters === 3, 10000);
    const row = await rowSettled(LIST);
    const after = (await customLists()).find((x) => x.id === LIST);
    if (after.filters !== 3 || after.updatedAt <= before.updatedAt) throw new Error(`not updated: ${JSON.stringify({ before, after, row })}`);
    if (row.includes("Couldn't")) throw new Error(row);
    const page = expectPage(await visit(), { ...BLOCKED, promo: false });
    const other = await until("the second profile's update", async () => {
      const v = await visit(secondProfile);
      return v.promo === false ? v : null;
    }, 90000);
    return { before: before.filters, after: after.filters, row, page, secondProfile: other };
  });

  await rep.check("update-fails-keeps-list", async () => {
    fixture.status = 500;
    try {
      await rowButton(LIST, "Update");
      await sleep(300);
      const row = await rowSettled(LIST);
      if (!row.includes("Couldn't update the list")) throw new Error(`no error in the row: ${row}`);
      const l = (await customLists()).find((x) => x.id === LIST);
      if (!l?.enabled || l.filters !== 3 || !l.downloaded) throw new Error(`the list changed: ${JSON.stringify(l)}`);
      const snap = await snapshot("6-update-failed");
      return { row, page: expectPage(await visit(), { ...BLOCKED, promo: false }), snapshot: snap };
    } finally {
      fixture.status = 200;
    }
  });

  await rep.check("my-filters-read-failure", async () => {
    await cef(`devContentBlockerFailNextMessage()`);
    await ui(`named("Row", section(), (f) => f.memoizedProps?.title === "My filters").memoizedProps.onPress(); return true`);
    const shown = await until("the read error", async () => {
      const t = await ui(`const s = sheet(); return s ? texts(s).join(" | ") : null`);
      return t?.includes("Couldn't read your filters") ? t : null;
    });
    const editable = await ui(`return named("TextInput", sheet()).memoizedProps.editable`);
    if (editable !== false) throw new Error("the editor is editable after a failed read");
    const snap = await snapshot("7a-my-filters-read-failed");
    await ui(`button("Try Again", sheet()).onPress(); return true`);
    await until("the retried read", () => ui(`return named("TextInput", sheet())?.memoizedProps?.editable ? true : null`));
    await ui(`button("Done", sheet()).onPress(); return true`);
    await until("back in Advanced…", () => ui(`return !sheet() && !!section()`));
    return { shown, snapshot: snap };
  });

  await rep.check("my-filters-stays-open-while-saving", async () => {
    const before = await cef("getUserFilters()");
    const edited = `${before}\n! held save`;
    await ui(`named("Row", section(), (f) => f.memoizedProps?.title === "My filters").memoizedProps.onPress(); return true`);
    await until("the editable My Filters sheet", () => ui(`return !!sheet() && named("TextInput", sheet()).memoizedProps.editable`));
    try {
      const busy = await withNativeGate("setUserFilters", async () => {
        await ui(`named("TextInput", sheet()).memoizedProps.onChangeText(${JSON.stringify(edited)}); return true`);
        await until("the edited filters", () => ui(`return !button("Save", sheet()).disabled`));
        await ui(`
          const s = sheet();
          const cancel = button("Cancel", s).onPress;
          const close = named("Sheet", s).memoizedProps.onClose;
          button("Save", s).onPress();
          cancel();
          close();
          return true
        `);
        return ui(`
          const s = sheet();
          if (!s) throw new Error("the sheet closed while saving");
          const cancel = button("Cancel", s);
          if (!cancel.disabled) throw new Error("Cancel is enabled while saving");
          cancel.onPress();
          named("Sheet", s).memoizedProps.onClose();
          return { calls: globalThis.__customFiltersGate.calls.length };
        `);
      });
      if (busy.calls !== 1) throw new Error(`Save made ${busy.calls} native calls, wanted 1`);
      if (!(await ui(`return !!sheet()`))) throw new Error("the sheet closed while saving");
      const status = await until("the held save", () => ui(`const text = texts(sheet()).join(" | "); return text.includes("Saved") || text.includes("Couldn't") ? text : null`));
      if (!status.includes("Saved")) throw new Error(status);
      if ((await cef("getUserFilters()")).trim() !== edited.trim()) throw new Error("the held save didn't persist");
      await ui(`button("Done", sheet()).onPress(); return true`);
      await until("the sheet closed after saving", () => ui(`return !sheet() && !!section()`));
      return { ...busy, status };
    } finally {
      await cef(`setUserFilters(${JSON.stringify(before)})`);
      await ui(`const s = sheet(); if (s) named("Sheet", s).memoizedProps.onClose(); return true`);
    }
  });

  await rep.check("my-filters", async () => {
    await ui(`named("Row", section(), (f) => f.memoizedProps?.title === "My filters").memoizedProps.onPress(); return true`);
    await until("the My Filters sheet", () => ui(`const s = sheet(); return s && named("TextInput", s)?.memoizedProps?.editable ? true : null`));
    await snapshot("7-my-filters-empty");
    await cef(`setContentBlockerEnabled(false)`);
    if ((await state()).enabled !== false) throw new Error("blocking didn't turn off");
    await ui(`named("TextInput", sheet()).memoizedProps.onChangeText("! mine\\n127.0.0.1##.e2e-mine"); return true`);
    await sleep(150);
    await ui(`button("Save", sheet()).onPress(); return true`);
    const status = await until("saved", async () => {
      const t = await ui(`return texts(sheet()).join(" | ")`);
      return t.includes("Saved") || t.includes("Couldn't") ? t : null;
    });
    if (!status.includes("Saved")) throw new Error(status);
    const snap = await snapshot("8-my-filters-saved");
    await ui(`button("Done", sheet()).onPress(); return true`);
    await until("back in Advanced…", () => ui(`return !sheet() && !!section()`));
    const text = await cef(`getUserFilters()`);
    if (!text.includes("127.0.0.1##.e2e-mine")) throw new Error(`stored: ${JSON.stringify(text)}`);
    const s = await state();
    if (s.userFilters !== 1) throw new Error(`userFilters: ${s.userFilters}`);
    if (!s.enabled) throw new Error("saving My filters left blocking off");
    await until("the row's count", async () => ((await sectionText()).includes("1 rule in use") ? true : null), 10000);
    return { status, page: expectPage(await visit(), { ...BLOCKED, mine: false }), snapshot: snap };
  });

  await rep.check("second-profile-follows", async () => {
    const seen = await until("the second profile's blocking", async () => {
      const v = await visit(secondProfile);
      return v.shorts === false && v.mine === false && v.promo === false ? v : null;
    }, 90000);
    return { profile: secondProfile, page: expectPage(seen, { ...BLOCKED, promo: false, mine: false }) };
  });

  await dump("state-2-before-relaunch");
  await rep.check("relaunch-persists", async () => {
    if (!secondProfile) throw new Error("no second profile to check after relaunch");
    await inst.quit();
    await boot();
    const s = await state();
    const l = (s.customLists ?? []).find((x) => x.id === LIST);
    if (!l?.enabled || l.filters !== 3) throw new Error(`after relaunch: ${JSON.stringify(s.customLists)}`);
    if (!(await cef(`getUserFilters()`)).includes("127.0.0.1##.e2e-mine")) throw new Error("My filters are gone");
    await dump("state-3-relaunched");
    const snap = await snapshot("9-relaunched");
    const page = await waitForPage(undefined, { ...BLOCKED, promo: false, mine: false }, "the default profile's blocking after relaunch");
    const other = await waitForPage(secondProfile, { ...BLOCKED, promo: false, mine: false }, "the second profile's blocking after relaunch");
    return { list: l, userFilters: s.userFilters, page, secondProfile: other, snapshot: snap };
  });

  await rep.check("remove", async () => {
    await rowButton(LIST, "Remove");
    await until("the row gone", async () => ((await rowText(LIST)) === null ? true : null), 60000);
    if ((await customLists()).length) throw new Error("still listed");
    const page = expectPage(await visit(), { ...UNBLOCKED, mine: false });
    const other = secondProfile
      ? await until("the second profile's list removed", async () => {
          const v = await visit(secondProfile);
          return v.shorts === true ? v : null;
        }, 60000)
      : null;
    await dump("state-4-removed");
    return { page, secondProfile: other, snapshot: await snapshot("10-removed") };
  });

  await rep.check("remove-persists", async () => {
    await inst.quit();
    await boot();
    if ((await customLists()).length) throw new Error("the removed list came back");
    return expectPage(await visit(), { ...UNBLOCKED, mine: false });
  });

  if (flags.network)
    await rep.check("real-list-yt-shorts", async () => {
      const url = "https://raw.githubusercontent.com/gijsdev/ublock-hide-yt-shorts/master/list.txt";
      const text = await addThroughUi(url);
      if (!text.includes("Added Hide YouTube Shorts with")) throw new Error(text);
      const l = (await customLists()).find((x) => x.id === url);
      if (!l?.enabled || l.filters < 1) throw new Error(JSON.stringify(l));
      const snap = await snapshot("11-real-list");
      await rowButton(url, "Remove");
      await until("the row gone", async () => ((await rowText(url)) === null ? true : null), 60000);
      return { status: text, list: l, snapshot: snap };
    });
} finally {
  if (inst && !flags.keep) await inst.quit().catch(() => {});
  server.close();
  const failed = rep.results.filter((r) => !r.ok);
  writeFileSync(join(out, "results.json"), JSON.stringify(rep.results, null, 2));
  rep.say(`\n${rep.results.length - failed.length}/${rep.results.length} passed. Log: ${rep.logFile}. Artifacts: ${out}`);
  if (flags.keep && inst) rep.say(`kept: pid ${inst.pid}, data ${data} (scripts/agent/ac quit ${data})`);
  process.exitCode = failed.length ? 1 : 0;
}
