#!/usr/bin/env node
// usage: node sf-vignettes.mjs <Debug Ardia.app> <scratch dir> [vignette…] — runs each vignette of sf-vignettes.json in its own hidden instances sharing one scratch folder, capturing setup, share, add and every action with the other people watching
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const ac = join(repo, "scripts/agent/ac");
const [app, scratch, ...only] = process.argv.slice(2);
if (!app || !scratch) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n")[1].replace(/^\/\/ ?/, ""));
  process.exit(64);
}
const specs = JSON.parse(readFileSync(join(here, "sf-vignettes.json"), "utf8"));
const SITES_PORT = 47410;

const run = (cmd, args) => new Promise((ok, fail) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.slice(0, 3).join(" ")} exited ${code}`))));
});
const cap = (data, scene, name, arg) => run("node", [join(here, "sf-cap.mjs"), data, scene, name, JSON.stringify(arg)]);
const quit = (data) => { try { execFileSync(ac, ["quit", data], { stdio: "ignore" }); } catch {} };

async function vignette(id, spec) {
  const root = join(scratch, id);
  const shared = join(root, "shared");
  mkdirSync(join(root, "import-empty"), { recursive: true });
  mkdirSync(shared, { recursive: true });
  const people = spec.people.map((p, i) => ({ ...p, data: join(root, p.who), port: 47401 + i }));
  await Promise.all(people.map(async (p) => {
    const tabs = p.tabs.map(([tid, host]) => ({ id: tid, profileId: "default", url: `http://${host}.example/` }));
    const s = session({ profiles: [{ id: "default", name: p.name, color: p.color }], windows: [{ id: "w1", frame: [80, 60, 1280, 800], profileId: "default" }], tabs });
    s.windows[0].tabIds = tabs.map((t) => t.id);
    s.windows[0].activeTabIds = { default: p.active };
    s.settings = { addressBar: "toolbar", appearance: p.appearance, searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 250, sidebarSide: p.side, tabLayout: p.layout };
    const file = join(root, `${p.who}-session.json`);
    writeFileSync(file, JSON.stringify(s, null, 2));
    await run(ac, ["launch", app, "--data", p.data, "--port", String(p.port), "--onboarded", "--session", file,
      "--instance", `sharedFolders=${shared}`, "--instance", `importSourceDir=${join(root, "import-empty")}`,
      "--instance", `importSafariHome=${join(root, "import-empty")}`, "--test", "appMenu", "--test", "appDialog",
      "--switch", `--host-resolver-rules=MAP *.example 127.0.0.1:${SITES_PORT}`]);
  }));
  try {
    await new Promise((r) => setTimeout(r, 4000));
    const owner = people.find((p) => p.build);
    const warm = [...new Set(spec.people.flatMap((p) => p.tabs.map(([, host]) => `http://${host}.example/`)))];
    await Promise.all(people.map((p) => cap(p.data, "sf-v-setup", `${id}-setup-${p.who}`, {
      folder: spec.folder, load: p.tabs.map(([tid]) => tid), active: p.active, build: p.build ?? null,
      warm: warm.filter((u) => !p.tabs.some(([, host]) => u.includes(`//${host}.`))),
    })));
    writeFileSync(join(owner.data, "menu.json.pick"), "shareFolder");
    await cap(owner.data, "sf-v-share", `${id}-share-${owner.who}`, { folder: spec.folder });
    const shareDir = join(repo, "apps/videos/.capture", `${id}-share-${owner.who}`);
    writeFileSync(join(shareDir, "files.txt"), execFileSync("ls", [join(shared, spec.folder)], { encoding: "utf8" }).trim().split("\n").join("\n"));
    try { writeFileSync(join(shareDir, "menu.json"), readFileSync(join(owner.data, "menu.json"))); } catch {}
    for (const p of people.filter((x) => x !== owner)) {
      writeFileSync(join(p.data, "menu.json.pick"), "addShared");
      writeFileSync(join(p.data, "file-chooser.txt"), `${join(shared, spec.folder)}\n`);
      await cap(p.data, "sf-v-add", `${id}-add-${p.who}`, { folder: spec.folder, expand: p.expand ?? [] });
      try { writeFileSync(join(repo, "apps/videos/.capture", `${id}-add-${p.who}`, "menu.json"), readFileSync(join(p.data, "menu.json"))); } catch {}
    }
    for (const [n, action] of spec.actions.entries()) {
      const actor = people.find((p) => p.who === action.who);
      const watchers = people.filter((p) => p !== actor).map((p) => cap(p.data, "sf-v-watch", `${id}-${n}-watch-${p.who}`, { folder: spec.folder, expand: p.expand ?? [] }));
      await new Promise((r) => setTimeout(r, 3000));
      await cap(actor.data, "sf-v-act", `${id}-${n}-act-${actor.who}`, { folder: spec.folder, op: action.op });
      await Promise.all(watchers);
    }
    writeFileSync(join(repo, "apps/videos/.capture", `${id}-files.txt`), execFileSync("ls", ["-R", join(shared, spec.folder)], { encoding: "utf8" }));
  } finally {
    people.forEach((p) => quit(p.data));
  }
}

for (const [id, spec] of Object.entries(specs)) {
  if (only.length && !only.includes(id)) continue;
  console.log(`== ${id}`);
  await vignette(id, spec);
}
