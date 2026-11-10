const DOWN = String.fromCharCode(0xf701);

export default {
  session: "session-r45-basic.json",
  setup: `st().addBookmark({ profileId: "default", url: "http://crumbs.example/recipes/crepes", title: "Crêpes for a crowd" });
  st().addBookmark({ profileId: "default", url: "http://crumbs.example/recipes/croissants", title: "Croissants, the slow way" });
  return sleep(1200).then(() => done({ nodes: Object.keys(st().bookmarks.nodes).length }));`,
  act: `return at(700, 420).then(() => sleep(800))
  .then(() => { mark("go"); return key("⌘L", CMD, "l", 37); }).then(() => sleep(1000))
  .then(() => typeText("cr", 160)).then(() => sleep(1100))
  .then(() => key("↓", 0, ${JSON.stringify(DOWN)}, 125)).then(() => sleep(1200))
  .then(() => key("↓", 0, ${JSON.stringify(DOWN)}, 125)).then(() => sleep(1200))
  .then(() => key("↓", 0, ${JSON.stringify(DOWN)}, 125)).then(() => sleep(1300))
  .then(() => key("esc", 0, String.fromCharCode(27), 53)).then(() => sleep(1500))
  .then(() => done({}));`,
  tail: 500,
};
