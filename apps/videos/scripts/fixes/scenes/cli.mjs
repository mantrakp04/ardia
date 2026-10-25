import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const run = spawnSync("ardia", ["exec", "--data-dir", instance.data, "await asyncio.sleep(0.3); len(tabs)"], { encoding: "utf8", timeout: 20000, env: { ...process.env, ARDIA_DATA_DIR: instance.data } });
      if (run.status !== 0) throw new Error(`ardia exec: ${run.status} ${run.stderr}`);
      await sleep(450);
    }
    return events;
  },
  act: `return sleep(9000).then(() => done());`,
  tail: 600,
};
