import { js } from "./util.mjs";

export const videoStateScript = (id) =>
  `(() => { const v = document.getElementById(${js(id)}); return v ? { paused: v.paused, ended: v.ended, currentTime: v.currentTime, readyState: v.readyState } : null; })()`;

export const videoPlaying = (state) => !!state && !state.paused && !state.ended && state.currentTime > 0.2;

export async function playByClickWith({ read, click, wait }) {
  const before = await read();
  if (!before || before.paused || before.ended) await click();
  return wait();
}
