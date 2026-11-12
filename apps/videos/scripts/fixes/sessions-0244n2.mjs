import { TITLES, writeSession } from "./sessions-lib.mjs";

const TITLES_HERE = { ...TITLES, chat: "Pinecone · Sam Rivera" };
const T = (id, url, extra = {}) => ({ id, profileId: "default", url, title: TITLES_HERE[new URL(url).hostname.split(".")[0]], ...extra });

function build(file, tabs, active) {
  writeSession(file, { tabs, active });
}

build("session-0244n2-group.json", [
  T("t1", "http://moodwall.example/"),
  T("t2", "http://docpad.example/"),
  T("t3", "http://lexicon.example/"),
  T("t4", "http://crumbs.example/"),
], "t1");

build("session-0244n2-notify.json", [
  T("t1", "http://docpad.example/"),
  T("c1", "http://chat.example/", { muted: true }),
  T("t3", "http://moodwall.example/"),
], "t1");
