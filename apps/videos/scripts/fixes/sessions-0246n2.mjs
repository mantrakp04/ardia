import { TITLES, writeSession } from "./sessions-lib.mjs";

const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES[new URL(url).hostname.split(".")[0]], ...extra });

writeSession("session-0246n2-reopen.json", {
  tabs: [T("t1", "http://moodwall.example/"), T("o1", "http://lexicon.example/", { windowId: "w2" })],
  windows: [
    { id: "w1", frame: [40, 60, 1120, 720], profileId: "default", activeTabIds: { default: "t1" } },
    { id: "w2", frame: [1190, 160, 520, 560], profileId: "default", activeTabIds: { default: "o1" } },
  ],
});

writeSession("session-0246n2-split.json", {
  tabs: [T("t1", "http://moodwall.example/"), T("t2", "http://crumbs.example/"), T("t3", "http://docpad.example/"), T("t4", "http://dailyledger.example/"), T("t5", "http://lexicon.example/")],
  active: "t1",
});

writeSession("session-0246n2-peek.json", {
  tabs: [T("t1", "http://moodwall.example/"), T("t2", "http://docpad.example/"), T("t3", "http://dailyledger.example/"), T("t4", "http://lexicon.example/")],
  active: "t1",
});
