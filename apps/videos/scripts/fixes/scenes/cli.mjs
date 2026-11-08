import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browse = (instance, args) => {
  const run = spawnSync("ardia", ["browse", "--data-dir", instance.data, ...args], { encoding: "utf8", timeout: 20000, env: { ...process.env, ARDIA_DATA_DIR: instance.data } });
  if (run.status !== 0) throw new Error(`ardia browse ${args.join(" ")}: ${run.status} ${run.stderr}`);
};

export default {
  withoutDevTools: true,
  setup: `st().updateSettings({ cliControl: true }); st().activate("t3"); return sleep(3000).then(() => done({ cli: st().settings.cliControl }));`,
  prepare: async (instance) => {
    const file = join(instance.data, "Chromium", "ArdiaControl.json");
    for (const end = Date.now() + 15000; !existsSync(file) && Date.now() < end; ) await sleep(200);
    if (!existsSync(file)) throw new Error(`no ${file}`);
    return null;
  },
  external: async (instance) => {
    const events = [];
    await sleep(1000);
    for (let i = 0; i < 4; i++) {
      if (i === 0) events.push({ t: Date.now(), mark: "go" });
      browse(instance, ["tab", "list"]);
      await sleep(750);
    }
    browse(instance, ["close"]);
    return events;
  },
  act: `return sleep(9000).then(() => done());`,
  tail: 600,
};
