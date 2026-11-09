import { execFileSync } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITES = `http://127.0.0.1:${process.env.FIXES_SITES_PORT ?? 47231}`;
const set = (counts) => fetch(`${SITES}/__set?${new URLSearchParams(counts)}`).then((r) => r.text());

export default {
  session: "session-0245n3-apps.json",
  seed: () => execFileSync("curl", ["-s", `${SITES}/__set?mail=0&chat=0&forum=0`]),
  setup: `return ["r1", "t1", "p1"].reduce((p, id) => p.then(() => { st().activate(id); return sleep(1800); }), Promise.resolve()).then(() => done({ titles: Object.values(st().tabs).map((t) => t.title) }));`,
  external: async () => {
    const events = [];
    await sleep(1500);
    events.push({ t: Date.now(), mark: "go" });
    await set({ mail: 1 });
    await sleep(900);
    await set({ chat: 2 });
    await sleep(900);
    await set({ forum: 5 });
    await sleep(900);
    await set({ mail: 3 });
    await sleep(2200);
    return events;
  },
  act: `return sleep(8200).then(() => done({ titles: Object.values(st().tabs).map((t) => t.title) }));`,
  tail: 400,
};
