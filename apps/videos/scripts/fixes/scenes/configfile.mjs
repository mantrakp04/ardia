import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIRST = { settings: { appearance: "light" } };
const SECOND = { theme: "fern", settings: { appearance: "light" } };
const FERN = { light: { accent: "#2E7D32", textTab: "#1B4D20", textPrimary: "#16361A", tabSelected: "rgba(46,125,50,0.30)", tabHover: "rgba(46,125,50,0.14)", pinnedResting: "rgba(46,125,50,0.20)", urlPill: "rgba(46,125,50,0.16)" } };

export default {
  session: "session-r44-basic.json",
  seed(data) {
    mkdirSync(join(data, "config"), { recursive: true });
    writeFileSync(join(data, "config", "config.json"), JSON.stringify({ settings: {} }, null, 2) + "\n");
    mkdirSync(join(data, "config", "themes"), { recursive: true });
    writeFileSync(join(data, "config", "themes", "fern.json"), JSON.stringify(FERN, null, 2) + "\n");
  },
  setup: `return sleep(2500).then(() => done({ appearance: st().settings.appearance }));`,
  async external(instance) {
    const events = [];
    const write = (doc, mark) => {
      writeFileSync(join(instance.data, "config", "config.json"), JSON.stringify(doc, null, 2) + "\n");
      events.push({ t: Date.now(), mark, save: JSON.stringify(doc, null, 2) });
    };
    await sleep(1200);
    events.push({ t: Date.now(), mark: "go" });
    await sleep(2600);
    write(FIRST, "⌘S");
    await sleep(3000);
    write(SECOND, "⌘S");
    await sleep(2800);
    return events;
  },
  act: `return sleep(10500).then(() => done({ appearance: st().settings.appearance, side: st().settings.sidebarSide }));`,
  tail: 500,
};
