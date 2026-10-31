const FIND = `
const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const roots = () => [...hook.renderers.keys()].flatMap((id) => [...hook.getFiberRoots(id)].map((r) => r.current));
function* walk(root) { const st = [root]; while (st.length) { const f = st.pop(); yield f; for (let c = f.child; c; c = c.sibling) st.push(c); } }
const hosts = (tip) => { const out = []; for (const r of roots()) for (const f of walk(r)) if (typeof f.type === "string" && f.stateNode && f.stateNode.measureInWindow && f.memoizedProps && f.memoizedProps.tooltip === tip) out.push(f.stateNode); return out; };
const measure = (n) => new Promise((r) => { const t = setTimeout(() => r(null), 800); n.measureInWindow((x, y, w, h) => { clearTimeout(t); r([x, y, w, h]); }); });
const lowest = (tip) => Promise.all(hosts(tip).map(measure)).then((fs) => fs.filter((f) => f && f[2] > 0).sort((a, b) => b[1] - a[1])[0] || null);
`;

const LAYOUT = { play: [226, 821, 24, 24], art: [13, 819, 28, 28] };

const STATE = `const sessionOf = () => { const m = (ac.media || {}).getState ? ac.media.getState().sessions : {}; const s = m.t4; return s ? s.playbackState : "none"; };`;

export default {
  session: "session-0243n7.json",
  switches: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  setup: `${STATE} return sleep(3500).then(() => { st().activate("t5"); return sleep(3000); }).then(() => done({ state: sessionOf() }));`,
  prepare: async (instance) => {
    const measured = await instance.eval(`${FIND} return Promise.all([lowest("Pause"), lowest("Play"), lowest("Back to Tab")]).then(([pause, play, art]) => JSON.stringify({ play: pause || play, art }));`, { timeout: 30000 }).then(JSON.parse, (e) => ({ error: String(e) }));
    return measured.play && measured.art ? measured : { ...LAYOUT, measured };
  },
  act: `${STATE}
const [bx, by, bw, bh] = P.play;
const x0 = Math.round(bx + bw / 2), y0 = Math.round(by + bh / 2);
const middle = Math.round((P.art[0] - 6 + bx + bw + 4) / 2);
const note = (name) => events.push({ t: Date.now(), mark: name + ":" + sessionOf() });
let last = sessionOf();
const sampler = setInterval(() => { const now = sessionOf(); if (now !== last) { last = now; events.push({ t: Date.now(), mark: "state:" + now }); } }, 50);
return at(700, 470).then(() => sleep(900))
  .then(() => move(x0, y0, 750)).then(() => { mark("go"); return click(); })
  .then(() => sleep(600)).then(() => note("afterQuick")).then(() => sleep(1300))
  .then(() => move(700, 460, 650)).then(() => sleep(1300))
  .then(() => move(x0, y0, 750)).then(() => { mark("rest"); return sleep(1700); })
  .then(() => (SIDE === "after" ? move(middle, y0, 550).then(() => sleep(300)) : sleep(300)))
  .then(() => { mark("play2"); return click(); })
  .then(() => sleep(600)).then(() => note("afterSecond")).then(() => sleep(1100))
  .then(() => move(700, 470, 700)).then(() => sleep(1400))
  .then(() => { clearInterval(sampler); return done({ state: sessionOf(), middle, x0, y0 }); });`,
  tail: 400,
};
