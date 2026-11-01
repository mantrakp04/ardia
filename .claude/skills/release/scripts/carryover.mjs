import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UBO_ID, launch, listenerPids, sleep } from "../../../../scripts/lib/instance.mjs";

const [phase, app, home, port, origin, extra, out] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const bundleId = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", `${app}/Contents/Info.plist`]).toString().trim();
const docs = path.join(home, "Library/Application Support", bundleId);
let instance = null;
const alive = () => !!instance && !instance.exited;
setTimeout(() => { console.error("carryover: no result in 420 s"); try { instance?.kill(); } catch {} process.exit(3); }, 420_000).unref();

if (listenerPids(port).length) { console.error(`carryover: port ${port} is taken`); process.exit(4); }
fs.mkdirSync(docs, { recursive: true });
const previousBuild = phase === "create" || phase === "back";
if (previousBuild && !fs.existsSync(path.join(docs, "onboarding.json")))
  fs.writeFileSync(path.join(docs, "onboarding.json"), JSON.stringify({ version: 1, completedAt: Date.now(), introMusicMuted: true }));
async function start(scratchDataDir, logName) {
  try {
    instance = await launch(app, {
      data: docs, port, js: "none", ready: false, probe: true, log: path.join(path.dirname(path.resolve(out)), logName),
      env: { HOME: home, CFFIXED_USER_HOME: home, ...(scratchDataDir ? {} : { ARDIA_DATA_DIR: null }) }, test: { reauth: "granted" },
      switches: "--disable-backgrounding-occluded-windows", args: previousBuild ? ["--mute-audio"] : [],
    });
  } catch (e) {
    console.error(`carryover: the app didn't start (${e.message})`);
    process.exit(2);
  }
  return instance.pid;
}
async function quit(pid) {
  execFileSync(process.env.CARRYOVER_QUIT, [String(pid)]);
  for (let i = 0; i < 60 && alive(); i++) await sleep(500);
  const quitted = !alive();
  if (alive()) instance.kill("SIGKILL");
  return quitted;
}
async function firstWindow() {
  let w = null;
  for (let i = 0; i < 60 && !w; i++) { w = await inApp(`return ${window} || null;`, 3000).catch(() => null); if (!w) await sleep(1000); }
  if (!w) throw new Error("no window");
  return w;
}
const realLibrary = path.join(os.userInfo().homedir, "Library");
const withoutPrivate = (p) => p.replace(/^\/private\//, "/");
function openFilesOf(pid) {
  const tree = [pid];
  for (let i = 0; i < tree.length; i++) { try { tree.push(...execSync(`pgrep -P ${tree[i]}`).toString().trim().split("\n").filter(Boolean)); } catch {} }
  const files = execSync(`lsof -p ${tree.join(",")} -Fn`).toString().split("\n").filter((l) => l.startsWith("n/")).map((l) => withoutPrivate(l.slice(1)));
  return { files, processes: tree.length };
}
const inRealHome = (files) => files.filter((f) => f.startsWith(`${realLibrary}/Application Support/com.ardia`) || f.startsWith(`${realLibrary}/Caches/com.ardia`));
async function openInstalledCopy() {
  const installedPid = await start(false, `${phase}.installed.app.log`);
  const profileFolder = `${withoutPrivate(path.join(docs, "Chromium"))}/`;
  let seen = { files: [], processes: 0 };
  for (let i = 0; i < 60 && alive() && !seen.files.some((f) => f.startsWith(profileFolder)); i++) { await sleep(1000); seen = openFilesOf(installedPid); }
  await sleep(5000);
  if (alive()) seen = openFilesOf(installedPid);
  return {
    dataDirectory: seen.files.some((f) => f.startsWith(profileFolder)) ? path.join(docs, "Chromium") : `nothing open under ${profileFolder}`,
    realHomeFiles: inRealHome(seen.files),
    processes: seen.processes,
    quit: await quit(installedPid),
  };
}
const installed = previousBuild ? null : await openInstalledCopy();
const pid = await start(true, `${phase}.app.log`);

const step = (what) => { if (process.env.CARRYOVER_VERBOSE) console.error(`carryover ${phase}: ${what}`); };
const legacy = path.basename(execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", `${app}/Contents/Info.plist`]).toString().trim()) === "Netnyahoo";
const inLegacyNames = (body) => `const ac = nn;\n${body.replace(/expo\.modules\.Ardia(\w+)/g, "expo.modules.Netnyahoo$1").replace(/"ac_(\w+)"/g, '"nn_$1"')}`;
async function inApp(body, timeoutMs = 30_000) {
  step(body.trim().split("\n")[0].slice(0, 100));
  return instance.eval(legacy ? inLegacyNames(body) : body, { timeout: timeoutMs });
}
async function inPage(urlPart, expression) {
  for (let i = 0; i < 40; i++) {
    const page = await instance.page(urlPart, { timeout: 0 }).catch(() => null);
    if (page) {
      const v = await page.send("Runtime.evaluate", { expression, returnByValue: true }).then((r) => r?.result?.value, () => undefined);
      page.close();
      if (v !== undefined) return v;
    }
    await sleep(500);
  }
  return `(no page ${urlPart})`;
}
const window = `Object.keys(ac.store.getState().windows)[0]`;
async function inUbo(body) {
  const expression = `(async () => { const send = (m) => vAPI.messaging.send("dashboard", m); ${body} })()`;
  const url = `chrome-extension://${UBO_ID}/1p-filters.html`;
  const tab = await inApp(`const s = ac.store.getState(), w = ${window}; ac.actions.switchProfile(w, "default"); const id = s.newTab(w, { url: ${JSON.stringify(url)}, profileId: "default" }); ac.actions.switchToTab(id); return id;`);
  try {
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const page = await instance.page(`${UBO_ID}/1p-filters.html`, { timeout: 0 }).catch(() => null);
      const v = page ? await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, { timeout: 20_000 }).then((r) => r?.result?.value, () => undefined) : undefined;
      page?.close();
      if (v !== undefined) return v;
    }
  } finally {
    await inApp(`ac.store.getState().closeTab(${JSON.stringify(tab)}); return 1;`).catch(() => {});
    await sleep(1000);
  }
  return "(uBO's dashboard didn't answer)";
}
const READ_UBO = `const f = await send({ what: "readUserFilters" }); const u = await send({ what: "userSettings" }); const w = await send({ what: "getWhitelist" });
  return { filters: f && f.content, filtersOn: f && f.enabled, advancedUser: u && u.advancedUserEnabled, trusted: w && w.whitelist.filter((h) => /carryover/.test(h)) };`;
const READ_SETTINGS = `const t = ac.store.getState().settings; return { appearance: t.appearance, sidebarWidth: t.sidebarWidth, newTabPosition: t.newTabPosition };`;
const show = (pattern) => inApp(`const s = ac.store.getState(); const t = Object.values(s.tabs).find((t) => ${pattern}.test(t.url));
  if (t) { ac.actions.switchProfile(${window}, t.profileId); ac.actions.switchToTab(t.id); } return !!t;`);

const READ = `
const s = ac.store.getState(), E = ac.engine;
const O = ${JSON.stringify(origin)};
const seq = (items, f) => items.reduce((p, x) => p.then(() => f(x)), Promise.resolve());
const safe = (p, f) => Promise.resolve().then(() => p).then(f, (e) => "error: " + e);
const orError = (p) => p.catch((e) => ({ error: e.message }));
const flat = (n, acc) => { acc = acc || []; if (!n) return acc; if (n.u) acc.push(n.t + " " + n.u); (n.c || []).forEach((c) => flat(c, acc)); return acc; };
const r = { profiles: s.profileOrder.map((id) => s.profiles[id].name), tabs: [] };
for (const t of Object.values(s.tabs)) if (t.url && !t.url.startsWith("https://ardia.dev/release-notes")) r.tabs.push(s.profiles[t.profileId].name + " " + t.url);
r.tabs.sort();
return safe(E.call("engine.info"), (i) => { r.dataDirectory = i && i.dataDirectory; }).then(() => seq(s.profileOrder, (id) => {
  const p = id === "default" ? "" : id, name = s.profiles[id].name, put = (k, v) => { r[name + " " + k] = v; };
  return orError(E.call("passwords.unlock", { profile: p })).then(() => orError(E.call("passwords.list", { profile: p })))
    .then((list) => { const pw = []; put("passwords", pw); return seq((list && list.passwords) || [], (e) => orError(E.call("passwords.reveal", { profile: p, origin: e.origin, username: e.username })).then((v) => { pw.push(e.username + " " + (v && v.password)); })); })
    .then(() => safe(orError(E.call("bookmarks.tree", { profile: p })), (t) => { put("bookmarks", flat(t.bar).concat(flat(t.other))); }))
    .then(() => safe(orError(E.call("history.query", { profile: p, maxUrls: 100, maxVisits: 5 })), (h) => put("history", (h.entries || []).map((e) => e.u).sort())))
    .then(() => safe(orError(E.call("autofill.addresses", { profile: p })), (a) => put("addresses", ((a && a.addresses) || []).map((x) => x.name + ", " + x.city))))
    .then(() => safe(E.call("sites.settings", { profile: p, origin: O, engine: "chromium" }), (v) => put("notifications", v && v.notifications && v.notifications.value)))
    .then(() => safe(E.call("sites.zoomLevels", { profile: p }), (z) => put("zoom", z)))
    .then(() => safe(orError(E.call("extensions.list", { profile: p })), (l) => put("extensions", ((l && l.extensions) || []).filter((e) => !/uBlock/.test(e.name)).map((e) => e.name + (e.enabled ? "" : " (off)")).sort())));
})).then(() => r);`;
const REVEAL_PASSWORDS = `
const s = ac.store.getState(), E = ac.engine;
const seq = (items, f) => items.reduce((p, x) => p.then(() => f(x)), Promise.resolve());
const orError = (p) => p.catch((e) => ({ error: e.message }));
const r = {};
return seq(s.profileOrder, (id) => {
  const p = id === "default" ? "" : id, pw = [];
  r[s.profiles[id].name + " passwords"] = pw;
  return orError(E.call("passwords.unlock", { profile: p })).then(() => orError(E.call("passwords.list", { profile: p })))
    .then((list) => seq((list && list.passwords) || [], (e) => orError(E.call("passwords.reveal", { profile: p, origin: e.origin, username: e.username })).then((v) => { pw.push(e.username + " " + (v && v.password)); })));
}).then(() => r);`;
const READ_BEFORE_ENGINE = `
const s = ac.store.getState(), C = globalThis.expo.modules.ArdiaCEF, X = globalThis.expo.modules.ArdiaExtensions;
const O = ${JSON.stringify(origin)};
const seq = (items, f) => items.reduce((p, x) => p.then(() => f(x)), Promise.resolve());
const safe = (p, f) => Promise.resolve().then(() => p).then(f, (e) => "error: " + e);
const flat = (n, acc) => { acc = acc || []; if (!n) return acc; if (n.u) acc.push(n.t + " " + n.u); (n.c || []).forEach((c) => flat(c, acc)); return acc; };
const r = { profiles: s.profileOrder.map((id) => s.profiles[id].name), tabs: [] };
for (const t of Object.values(s.tabs)) if (t.url && !t.url.startsWith("https://ardia.dev/release-notes")) r.tabs.push(s.profiles[t.profileId].name + " " + t.url);
r.tabs.sort();
return safe(C.engineInfo(), (i) => { r.dataDirectory = i && i.dataDirectory; }).then(() => seq(s.profileOrder, (id) => {
  const p = id === "default" ? "" : id, name = s.profiles[id].name, put = (k, v) => { r[name + " " + k] = v; };
  return C.unlockPasswords(p).then(() => C.listPasswords(p))
    .then((list) => { const pw = []; put("passwords", pw); return seq((list && list.passwords) || [], (e) => C.getPassword(p, e.origin, e.username).then((v) => { pw.push(e.username + " " + (v && v.password)); })); })
    .then(() => safe(C.engineCall("ac_bookmarks_tree", p, null), (t) => { t = JSON.parse(t); put("bookmarks", flat(t.bar).concat(flat(t.other))); }))
    .then(() => safe(C.engineCall("ac_history_query", p, JSON.stringify({ maxUrls: 100, maxVisits: 5 })), (h) => put("history", (JSON.parse(h).entries || []).map((e) => e.u).sort())))
    .then(() => safe(C.listAddresses(p), (a) => put("addresses", ((a && a.addresses) || []).map((x) => x.name + ", " + x.city))))
    .then(() => safe(C.getSiteSettings(p, O), (v) => put("notifications", v && v.notifications && v.notifications.value)))
    .then(() => safe(C.getZoomLevels(p), (z) => put("zoom", z)))
    .then(() => safe(X.list(p), (l) => put("extensions", ((l && l.extensions) || []).filter((e) => !/uBlock/.test(e.name)).map((e) => e.name + (e.enabled ? "" : " (off)")).sort())));
})).then(() => r);`;

const report = {};
try {
  const w = await firstWindow();
  const engineApi = await inApp("return !!ac.engine;");
  if (phase === "create") {
    const W = JSON.stringify(w);
    await inApp(`const s = ac.store.getState(); s.newTab(${W}, { url: "${origin}/page2.html" }); ac.actions.switchToTab(s.newTab(${W}, { url: "${origin}/page1.html" })); return 1;`);
    report.setPersonal = await inPage("page1.html", `document.cookie = "p_persist=yes; max-age=31536000; path=/"; document.cookie = "p_session=yes; path=/"; localStorage.setItem("p_ls", "yes"); document.cookie`);
    await show("/page2/"); await sleep(1500);
    const work = await inApp(`const s = ac.store.getState(); const id = s.createProfile({ name: "Work", color: "blue" }); ac.actions.switchProfile(${W}, id); return id;`);
    await sleep(1500);
    await inApp(`ac.actions.switchToTab(ac.store.getState().newTab(${W}, { url: "${origin}/work.html", profileId: ${JSON.stringify(work)} })); return 1;`);
    report.setWork = await inPage("work.html", `document.cookie = "w_persist=yes; max-age=31536000; path=/"; document.cookie = "w_session=yes; path=/"; localStorage.setItem("w_ls", "yes"); document.cookie`);
    report.made = await inApp(engineApi ? `
      const s = ac.store.getState(), E = ac.engine, P = globalThis.expo.modules.ArdiaPasswords, O = ${JSON.stringify(origin)}, work = ${JSON.stringify(work)};
      const orError = (p) => p.catch((e) => ({ error: e.message }));
      s.addBookmark({ profileId: "default", url: O + "/page2.html", title: "Carryover bookmark" });
      s.addBookmark({ profileId: work, url: O + "/work.html", title: "Work bookmark" });
      return orError(P.save("", O, "alice", "pw-personal-123").then(JSON.parse))
        .then(() => orError(P.save(work, O, "bob", "pw-work-456").then(JSON.parse)))
        .then(() => orError(E.call("autofill.saveAddress", { profile: "", address: { name: "Ada Lovelace", city: "London", street: "12 St James's Square", postalCode: "SW1Y 4JH", country: "GB" } })))
        .then(() => E.call("sites.setSetting", { profile: "", origin: O, type: "notifications", value: "allow", engine: "chromium" }))
        .then(() => E.call("sites.setZoom", { profile: "", host: "127.0.0.1", zoom: 1.5 }))
        .then(() => orError(E.call("extensions.install", { profile: "", path: ${JSON.stringify(extra)} })));` : `
      const s = ac.store.getState(), C = globalThis.expo.modules.ArdiaCEF, O = ${JSON.stringify(origin)}, work = ${JSON.stringify(work)};
      s.addBookmark({ profileId: "default", url: O + "/page2.html", title: "Carryover bookmark" });
      s.addBookmark({ profileId: work, url: O + "/work.html", title: "Work bookmark" });
      return C.savePassword("", O, "alice", "pw-personal-123")
        .then(() => C.savePassword(work, O, "bob", "pw-work-456"))
        .then(() => C.saveAddress("", { name: "Ada Lovelace", city: "London", street: "12 St James's Square", postalCode: "SW1Y 4JH", country: "GB" }))
        .then(() => C.setSiteSetting("", O, "notifications", "allow"))
        .then(() => C.setZoom("", "127.0.0.1", 1.5))
        .then(() => globalThis.expo.modules.ArdiaExtensions.install(${JSON.stringify(extra)}, ""));`, 60_000);
    report.madeUbo = await inUbo(`await send({ what: "writeUserFilters", content: "||carryover-ads.example^\\n##.carryover-banner", enabled: true, trusted: false });
      await send({ what: "userSettings", name: "advancedUserEnabled", value: true });
      const w = await send({ what: "getWhitelist" }); await send({ what: "setWhitelist", whitelist: w.whitelist.concat("carryover.example").join("\\n") }); return 1;`);
    await inApp(`ac.store.getState().updateSettings({ appearance: "dark", sidebarWidth: 244, newTabPosition: "bottom" }); return 1;`);
    await sleep(4000);
  }
  if (phase === "use") {
    const W = JSON.stringify(w);
    await inApp(`ac.actions.switchProfile(${W}, "default"); ac.actions.switchToTab(ac.store.getState().newTab(${W}, { url: "${origin}/page3.html", profileId: "default" })); return 1;`);
    report.setNew = await inPage("page3.html", `document.cookie = "n_persist=yes; max-age=31536000; path=/"; document.cookie = "n_session=yes; path=/"; localStorage.setItem("n_ls", "yes"); document.cookie`);
    report.made = await inApp(`
      const s = ac.store.getState(), E = ac.engine, O = ${JSON.stringify(origin)};
      const orError = (p) => p.catch((e) => ({ error: e.message }));
      s.addBookmark({ profileId: "default", url: O + "/page3.html", title: "New build bookmark" });
      return orError(globalThis.expo.modules.ArdiaPasswords.save("", O, "carol", "pw-new-789").then(JSON.parse))
        .then(() => E.call("sites.setZoom", { profile: "", host: "localhost", zoom: 0.9 }))
        .then(() => orError(E.call("extensions.list", { profile: "" })))
        .then((l) => { const e = ((l && l.extensions) || []).find((e) => e.name === "ArdiaCore spike extension"); return e ? orError(E.call("extensions.setEnabled", { profile: "", id: e.id, enabled: false })) : "no extension"; });`, 60_000);
    await sleep(4000);
  }
  report.read = await inApp(engineApi ? READ : READ_BEFORE_ENGINE, 90_000);
  report.read["Personal uBlock Origin"] = await inUbo(READ_UBO);
  report.read["settings"] = await inApp(READ_SETTINGS);
  if (phase === "use" || phase === "back") {
    await show("/page3/"); await sleep(2500);
    report.read["New build page"] = await inPage("page3.html", `document.cookie + "; localStorage " + localStorage.getItem("n_ls")`);
  }
  await show("/work/"); await sleep(2500);
  report.read["Work page"] = await inPage("work.html", `document.cookie + "; localStorage " + localStorage.getItem("w_ls")`);
  await show("/page1/"); await sleep(2500);
  report.read["Personal page"] = await inPage("page1.html", `document.cookie + "; localStorage " + localStorage.getItem("p_ls")`);
  const seen = openFilesOf(pid);
  report.realHomeFiles = [...(installed?.realHomeFiles ?? []), ...inRealHome(seen.files)];
  report.processesChecked = seen.processes + (installed?.processes ?? 0);
  if (installed) report.read.dataDirectory = installed.dataDirectory;
} catch (e) {
  report.error = String(e.stack || e);
}
report.quit = (await quit(pid)) && (installed?.quit ?? true);
if (!previousBuild && !report.error) {
  try {
    const revealPid = await start(true, `${phase}.reveal.app.log`);
    await firstWindow();
    Object.assign(report.read, await inApp(REVEAL_PASSWORDS, 90_000));
    report.revealQuit = await quit(revealPid);
  } catch (e) {
    report.error = `revealing passwords: ${e.stack || e}`;
  }
}

if (phase === "use") {
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const ok = !report.error && report.quit && /n_session/.test(report.setNew) && /pw-new-789/.test(JSON.stringify(report.read)) && /\(off\)/.test(JSON.stringify(report.read));
  if (!ok) { console.log(`FAIL  the new build added its session  (${report.error ?? JSON.stringify(report).slice(0, 300)})`); process.exit(1); }
  process.exit(0);
}
if (phase === "create") {
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  const r = report.read ?? {};
  const want = {
    "profiles": '["Personal","Work"]', "Personal passwords": '["alice pw-personal-123"]', "Work passwords": '["bob pw-work-456"]',
    "Personal bookmarks": `["Carryover bookmark ${origin}/page2.html"]`, "Work bookmarks": `["Work bookmark ${origin}/work.html"]`,
    "Personal addresses": '["Ada Lovelace, London"]', "Personal notifications": '"allow"', "Personal zoom": '{"127.0.0.1":1.5}',
    "Personal extensions": '["ArdiaCore spike extension"]',
    "Personal page": '"p_persist=yes; p_session=yes; localStorage yes"', "Work page": '"w_persist=yes; w_session=yes; localStorage yes"',
    "Personal uBlock Origin": '{"filters":"||carryover-ads.example^\\n##.carryover-banner","filtersOn":true,"advancedUser":true,"trusted":["carryover.example"]}',
    "settings": '{"appearance":"dark","sidebarWidth":244,"newTabPosition":"bottom"}',
  };
  const wrong = Object.entries(want).filter(([k, v]) => JSON.stringify(r[k]) !== v).map(([k]) => `${k}: ${JSON.stringify(r[k])}`);
  if (!(r["Personal history"] ?? []).includes(`${origin}/page1.html`) || !(r["Work history"] ?? []).includes(`${origin}/work.html`)) wrong.push("history");
  const ok = !report.error && report.quit && !wrong.length;
  if (!ok && !report.error) report.error = `not as made: ${wrong.join("; ")}`;
  if (!ok) { console.log(`FAIL  the previous build made the test data  (${report.error ?? JSON.stringify(report).slice(0, 300)})`); process.exit(1); }
  process.exit(0);
}

const created = JSON.parse(fs.readFileSync(extra, "utf8")).read;
fs.writeFileSync(out, JSON.stringify(report, null, 2));
let failed = !!report.error;
if (report.error) console.log(`FAIL  the new build read the data  (${report.error})`);
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const sessionless = (v) => (typeof v === "string" ? v.replace(/\w+_session=yes; /g, "") : v);
const line = (ok, name, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  carried over: ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failed = true; };
const expected = path.join(docs, "Chromium");
if (phase !== "back") line(report.read?.dataDirectory?.replace(/^\/private/, "") === expected.replace(/^\/private/, ""), "the installed copy's folder, found without ARDIA_DATA_DIR", report.read?.dataDirectory);
for (const [key, was] of Object.entries(created)) {
  if (key === "dataDirectory") continue;
  const now = report.read?.[key];
  const failedRead = typeof now === "string" && now.startsWith("error:");
  const ok = !failedRead && key.endsWith(" history") && Array.isArray(was) && Array.isArray(now) ? was.every((u) => now.includes(u)) : !failedRead && (stable(now) === stable(was) || (phase === "back" && key.endsWith(" page") && sessionless(now) === sessionless(was)));
  if (phase === "back" && key.endsWith(" page") && ok && stable(now) !== stable(was))
    console.log(`INFO  ${key}: the previous build dropped session cookies at launch (${(String(was).match(/\w+_session/g) || []).join(", ")})`);
  const shown = JSON.stringify(now ?? null);
  line(ok, key, ok ? shown.slice(0, 120) : `${JSON.stringify(was).slice(0, 150)} → ${shown.slice(0, 150)}`);
}
line(report.realHomeFiles?.length === 0, "nothing opened in the real home's Ardia folders", report.realHomeFiles?.slice(0, 2).join(", "));
line(report.quit, "it quits on the quit Apple event");
process.exit(failed ? 1 : 0);
