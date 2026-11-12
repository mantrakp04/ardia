import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scratch = process.env.FIXES_SCRATCH ?? join(process.env.HOME, "ardia-scratch/video-fixes");
const CLI = { before: join(scratch, "cli/before/bin/ardia"), after: join(scratch, "cli/after/bin/ardia") };

let runs = 0;

async function run(side, data, args, timeout = 30000) {
  const dir = join(scratch, "cli-runs");
  mkdirSync(dir, { recursive: true });
  const id = `${side}-${process.pid}-${runs++}`;
  const out = join(dir, `${id}.out`);
  const code = join(dir, `${id}.code`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|AI_AGENT|CODEX)/.test(k)));
  spawn("/bin/sh", ["-c", '( sleep 0.3; "$0" "$@" >"$OUT" 2>&1; echo $? >"$CODE" ) &', CLI[side], ...args], {
    env: { ...env, ARDIA_DATA_DIR: data, NO_COLOR: "1", COLUMNS: "90", OUT: out, CODE: code },
    stdio: "ignore",
  });
  for (const end = Date.now() + timeout; !existsSync(code) && Date.now() < end; ) await sleep(50);
  const text = existsSync(out) ? readFileSync(out, "utf8").trim() : "";
  const status = existsSync(code) ? Number(readFileSync(code, "utf8").trim()) : -1;
  return { code: status, out: text };
}

const lines = (text) => text.split("\n").filter((l) => l.trim());

function tabIds(flat) {
  const found = {};
  for (const line of lines(flat)) {
    const words = line.replace(/^\*/, "").trim().split(/\s+/);
    const url = words.find((w) => /^https?:\/\//.test(w));
    if (url && words[2]) found[url] = words[2];
  }
  return found;
}

export default {
  session: "session-r45-cli.json",
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
    const step = async (args, shown, max = 3) => {
      say(`$ ardia ${shown ?? args.join(" ")}`);
      const r = await run(side, instance.data, args);
      for (const line of lines(r.out).slice(0, max)) say(line.length > 64 ? `${line.slice(0, 63)}…` : line, true);
      return r;
    };
    await sleep(1200);
    events.push({ t: Date.now(), mark: "go" });
    const listed = await step(["tabs", "--flat"], "tabs --flat", 5);
    await sleep(1400);
    if (listed.code !== 0) {
      await sleep(5000);
      return events;
    }
    const ids = tabIds(listed.out);
    const trip = ["http://trails.example/", "http://ferry.example/", "http://hostel.example/"];
    await step(["groups", "create", ...trip.flatMap((u) => ["--url", u]), "--name", "Trip", "--icon", "🧭", "--color", "green", "--unpinned"], "groups create --url trails… --url ferry… --url hostel… --name Trip --icon 🧭 --color green --unpinned", 2);
    await sleep(1800);
    const ideas = ["http://moodwall.example/", "http://docpad.example/"].map((u) => ids[u]).filter(Boolean);
    if (ideas.length) await step(["groups", "create", ...ideas, "--name", "Ideas", "--icon", "💡", "--color", "purple", "--unpinned"], `groups create ${ideas.join(" ")} --name Ideas --icon 💡 --color purple --unpinned`, 2);
    await sleep(3000);
    return events;
  },
  act: `return sleep(17000).then(() => done({ groups: Object.values(st().groups ?? {}).map((g) => g.name) }));`,
  tail: 500,
};
