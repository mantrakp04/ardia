import { writeFileSync } from "node:fs";
import { session } from "../../../../scripts/lib/instance.mjs";

const PEOPLE = {
  priya: {
    profile: { id: "default", name: "Priya", color: "plum" },
    tabs: [
      ["a1", "http://canopy.example/"],
      ["a2", "http://citydata.example/"],
      ["a3", "http://course.example/"],
      ["a4", "http://library.example/"],
      ["a5", "http://survey.example/"],
      ["a6", "http://heatmap.example/"],
    ],
    active: "a6",
  },
  tomas: {
    profile: { id: "default", name: "Tomás", color: "blue" },
    tabs: [
      ["b1", "http://docpad.example/"],
      ["b2", "http://lexicon.example/"],
      ["b3", "http://lecture.example/"],
    ],
    active: "b3",
  },
};

const [out, who] = process.argv.slice(2);
const person = PEOPLE[who];
const tabs = person.tabs.map(([id, url]) => ({ id, profileId: "default", url }));
const s = session({
  profiles: [person.profile],
  windows: [{ id: "w1", frame: [80, 60, 1280, 800], profileId: "default" }],
  tabs,
});
s.windows[0].tabIds = tabs.map((t) => t.id);
s.windows[0].activeTabIds = { default: person.active };
s.settings = { addressBar: "toolbar", appearance: "light", searchSuggestions: false, warnBeforeQuitting: false, sidebarWidth: 250 };
writeFileSync(out, JSON.stringify(s, null, 2));
