import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scratch = process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes");
const CLI = { before: join(scratch, "cli/before/bin/ardia"), after: join(scratch, "cli/after/bin/ardia") };
const ITEM = "Sourdough starter";

function run(side, data, args, timeout = 30000) {
  return new Promise((resolve) => {
    const child = spawn(CLI[side], ["browse", ...args], { env: { ...process.env, ARDIA_DATA_DIR: data, NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim() });
    });
    child.on("error", (e) => resolve({ code: -1, out: String(e) }));
  });
}

const shown = (text, max = 4) => text.split("\n").filter((l) => l.trim()).slice(0, max);

export default {
  session: "session-r44-cli.json",
  withoutDevTools: true,
  setup: `st().updateSettings({ cliControl: true }); return sleep(3000).then(() => done({ cli: st().settings.cliControl }));`,
  prepare: async (instance) => {
    const file = join(instance.data, "Chromium", "ArdiaControl.json");
    for (const end = Date.now() + 15000; !existsSync(file) && Date.now() < end; ) await sleep(200);
    return { control: existsSync(file) };
  },
  external: async (instance, side) => {
    const events = [];
    const say = (text, dim = false) => events.push({ t: Date.now(), term: text, dim });
    const step = async (args, label) => {
      say(`$ ardia browse ${label ?? args.join(" ")}`);
      const r = await run(side, instance.data, args);
      for (const line of shown(r.out)) say(line, true);
      return r;
    };
    await sleep(1200);
    events.push({ t: Date.now(), mark: "go" });
    const opened = await step(["open", "http://groceries.example/", "--show"]);
    await sleep(900);
    if (opened.code !== 0) {
      await sleep(4000);
      return events;
    }
    say("$ ardia browse snapshot -i");
    const snap = await run(side, instance.data, ["snapshot", "-i"]);
    const box = /textbox[^\n]*\[ref=(e\d+)\]/.exec(snap.out)?.[1];
    const add = /button "Add"[^\n]*\[ref=(e\d+)\]/.exec(snap.out)?.[1];
    for (const line of snap.out.split("\n").filter((l) => /textbox|button/.test(l)).slice(0, 3)) say(line.trim(), true);
    await sleep(900);
    if (box) await step(["fill", `@${box}`, ITEM], `fill @${box} "${ITEM}"`);
    await sleep(600);
    if (add) await step(["click", `@${add}`]);
    await sleep(2500);
    return events;
  },
  act: `return sleep(26000).then(() => done({ tabs: Object.values(st().tabs).map((t) => t.url) }));`,
  tail: 500,
};
