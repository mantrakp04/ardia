import { TITLES, writeSession } from "./sessions-lib.mjs";

const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES[new URL(url).hostname.split(".")[0]], ...extra });

writeSession("session-0246n7-basic.json", {
  tabs: [T("t1", "http://docpad.example/"), T("t2", "http://dailyledger.example/"), T("t3", "http://lexicon.example/")],
  active: "t1",
});

writeSession("session-0246n7-newtab.json", {
  tabs: [T("t1", "http://docpad.example/"), T("t2", "http://dailyledger.example/")],
  active: "t1",
});

writeSession("session-0246n7-small.json", {
  tabs: [T("t1", "http://docpad.example/")],
  active: "t1",
  frame: [80, 60, 720, 460],
});
