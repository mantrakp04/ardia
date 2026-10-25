const favorite = (url, title) => ({ url, title });
const result = {
  bookmarks: null, history: [], tabs: [], spaces: [], credentials: [], favicons: [],
  favorites: [favorite("http://lexicon.example/", "Lexicon"), favorite("http://dailyledger.example/", "The Daily Ledger"), favorite("http://docpad.example/", "Docpad")],
};

export default {
  setup: `st().activate("t3"); return sleep(2500).then(() => done());`,
  act: `return sleep(700).then(() => { mark("go"); mark("Import from Arc"); return ac.pages.applyResult("default", ${JSON.stringify(result)}, "Arc", ["tabs"]); }).then((counts) => sleep(3000).then(() => done({ counts, tiles: Object.values(st().tabs).filter((t) => t.pinned && !t.pinnedAsRow).map((t) => t.url) })));`,
};
