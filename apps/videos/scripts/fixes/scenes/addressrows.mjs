import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG = {
  settings: {
    omniboxProviders: [
      {
        keyword: "trip",
        title: "Trip",
        rows: [
          { title: "Ferry times", url: "http://ferry.example/", subtitle: "Island ferry, summer timetable" },
          { title: "Hostel booking", url: "http://hostel.example/", subtitle: "Two nights, June 14" },
          { title: "Trail map", url: "http://trails.example/", subtitle: "Ridge loop, 11 km" },
        ],
      },
    ],
  },
};

export default {
  session: "session-r44-basic.json",
  seed(data) {
    mkdirSync(join(data, "config"), { recursive: true });
    writeFileSync(join(data, "config", "config.json"), JSON.stringify(CONFIG, null, 2) + "\n");
  },
  setup: `return sleep(2500).then(() => done({ providers: (st().settings.omniboxProviders || []).length }));`,
  act: `return at(700, 600).then(() => sleep(500))
  .then(() => { mark("go"); mark("⌘T"); return dw("keys:" + CMD + ":t:17"); }).then(() => sleep(1000))
  .then(() => "trip".split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(130)), Promise.resolve())).then(() => sleep(400))
  .then(() => { mark("Space"); return dw("type: "); }).then(() => sleep(1300))
  .then(() => "fe".split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(160)), Promise.resolve())).then(() => sleep(2600))
  .then(() => done());`,
  tail: 400,
};
