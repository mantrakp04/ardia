import { openSmall, smallHelpers } from "./_little.mjs";

const LINK = [200, 230];

export default {
  session: "session-0244n4-little.json",
  setup: openSmall("http://notes.example/"),
  act: `${smallHelpers}
  return smallWindow().then((n) => { N = n; return sat(420, 470); }).then(() => sleep(600))
  .then(() => smove(${LINK.join(", ")}, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(3200))
  .then(() => done({ small: smallUrls(), main: mainOrder(), setting: st().settings.littleArdiaOpensNewTabLinks }));`,
  tail: 400,
};
