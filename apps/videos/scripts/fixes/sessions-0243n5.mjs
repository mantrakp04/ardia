import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DARK, writeSession } from "./sessions-lib.mjs";

const pages = process.argv[3];
const PAGES = {
  moodwall: "moodwall — ideas for everything",
  crumbs: "Crumbs — Brown butter oat cookies",
  docpad: "Trip plan — Docpad",
  ledger: "The Daily Ledger",
  tunes: "Tunes · Late Night Drive",
  lexicon: "Lexicon dictionary",
  glow: "Glow — colour field",
};
const url = (page) => `file://${join(pages, `${page}.html`)}`;
const iconOf = (page) => {
  const m = /<link rel="icon" href="([^"]+)"/.exec(readFileSync(join(pages, `${page}.html`), "utf8"));
  return m ? m[1] : null;
};
const T = (id, page, extra = {}) => ({ id, profileId: "default", url: url(page), title: PAGES[page], favicon: iconOf(page), ...extra });
const tile = (id, page) => T(id, page, { pinned: true, pinnedUrl: url(page), unloaded: true });

function build(file, { tabs, active, appearance }) {
  writeSession(file, { tabs, active, settings: { ...DARK, appearance } });
}

build("session-lasttab.json", {
  tabs: [tile("p1", "moodwall"), tile("p2", "crumbs"), tile("p3", "ledger"), tile("p4", "tunes"), T("t1", "docpad")],
  active: "t1",
  appearance: "light",
});
build("session-glass.json", {
  tabs: [tile("p1", "moodwall"), tile("p2", "crumbs"), tile("p3", "ledger"), T("t1", "glow"), T("t2", "docpad"), T("t3", "lexicon")],
  active: "t1",
  appearance: "dark",
});
