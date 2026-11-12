import { openSmall, smallHelpers } from "./_little.mjs";

const OPEN_IN_ARDIA = [596, 19];

export default {
  session: "session-0244n4-move.json",
  setup: openSmall("http://notes.example/"),
  act: `${smallHelpers}
  return smallWindow().then((n) => { N = n; return sat(430, 300); }).then(() => sleep(600))
  .then(() => smove(${OPEN_IN_ARDIA.join(", ")}, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => { events.push({ t: Date.now() + 250, hide: 1 }); return sleep(3200); })
  .then(() => done({ main: mainOrder(), position: st().settings.newTabPosition }));`,
  tail: 400,
};
