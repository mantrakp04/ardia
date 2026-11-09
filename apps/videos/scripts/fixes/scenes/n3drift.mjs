export default {
  session: "session-0245n3-doc.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `const drift = (x, y) => move(x, y, 600).then(() => sleep(250)).then(() => { events.push({ t: Date.now(), down: 1 }); return dw("mouse:down:" + x + "," + y); })
    .then(() => sleep(40)).then(() => dw("mouse:dragged:" + (x + 2) + "," + (y + 2))).then(() => at(x + 2, y + 2))
    .then(() => sleep(40)).then(() => dw("mouse:dragged:" + (x + 4) + "," + (y + 5))).then(() => at(x + 4, y + 5))
    .then(() => sleep(40)).then(() => { events.push({ t: Date.now(), up: 1 }); return dw("mouse:up:" + (x + 4) + "," + (y + 5)); });
  const shown = [];
  return at(700, 600).then(() => sleep(500))
  .then(() => { mark("go"); return drift(120, 293); }).then(() => sleep(1300)).then(() => shown.push(st().windows[W].activeTabIds.default))
  .then(() => drift(110, 330)).then(() => sleep(1500)).then(() => shown.push(st().windows[W].activeTabIds.default))
  .then(() => done({ shown }));`,
  tail: 500,
};
