import { blankScene } from "./_blank.mjs";

export default blankScene(`() => move(520, 198, 800).then(() => sleep(300)).then(() => { mark("go"); return click(); })`);
