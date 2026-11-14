const SEED = `const SITES = ["lexicon", "crumbs", "trails", "ferry", "hostel", "moodwall", "docpad", "dailyledger", "canopy", "library", "eats", "tunes"];
const links = Array.from({ length: 300 }, (_, i) => { const site = SITES[i % SITES.length]; return { title: site[0].toUpperCase() + site.slice(1) + " · saved " + (i + 1), url: "http://" + site + ".example/" + (i + 1) }; });
st().addBookmarkTree("default", [{ title: "Imported", children: links }]);`;

export default {
  session: "session-r45-bookmarks.json",
  setup: `${SEED}\nreturn sleep(1500).then(() => done({ nodes: Object.keys(st().bookmarks.nodes).length }));`,
  act: `return at(700, 420).then(() => sleep(600))
  .then(() => move(363, 159, 900)).then(() => sleep(300)).then(click).then(() => sleep(1300))
  .then(() => move(640, 182, 800)).then(() => sleep(300)).then(click).then(() => sleep(900))
  .then(() => { mark("go"); return key("⌘A", CMD, "a", 0); }).then(() => sleep(1800))
  .then(() => key("⌫", 0, String.fromCharCode(127), 51)).then(() => sleep(2200))
  .then(() => done({ nodes: Object.keys(st().bookmarks.nodes).length }));`,
  tail: 600,
};
