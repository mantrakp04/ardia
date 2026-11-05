import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * k);
const STEP_MS = 16;
const PRESS_MS = 90;

export class Script {
  constructor(window = "Settings") {
    this.window = window;
    this.steps = [];
    this.at = 0;
    this.px = null;
    this.py = null;
  }

  wait(ms) {
    this.at += ms;
    return this;
  }

  add(step) {
    this.steps.push({ window: this.window, ...step, at: Math.round(this.at) });
    return this;
  }

  move(x, y, ms = 600, { real = true } = {}) {
    if (this.px === null) {
      this.px = x;
      this.py = y;
      return this.add({ type: "move", x, y, real });
    }
    const x0 = this.px;
    const y0 = this.py;
    const n = Math.max(1, Math.round(ms / STEP_MS));
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      this.at += STEP_MS;
      this.add({ type: "move", x: Math.round((x0 + (x - x0) * k) * 10) / 10, y: Math.round((y0 + (y - y0) * k) * 10) / 10, real });
    }
    this.px = x;
    this.py = y;
    return this;
  }

  click({ real = true, draw = true, x = this.px, y = this.py } = {}) {
    return this.add({ type: "click", x, y, real, draw });
  }

  text(chars, gapMs = 140) {
    this.add({ type: "text", chars, gap: gapMs / 1000 });
    this.at += chars.length * gapMs;
    return this;
  }

  action(selector) {
    return this.add({ type: "action", selector });
  }

  mark(name, extra = {}) {
    return this.add({ mark: name, ...extra });
  }

  note(extra) {
    return this.add({ note: true, ...extra });
  }

  duration() {
    return this.at;
  }
}

export async function play(instance, script, { onStart } = {}) {
  const inbox = join(instance.data, "film-input.json");
  const outbox = join(instance.data, "film-input-done.json");
  rmSync(outbox, { force: true });
  const real = script.steps.filter((s) => s.type && s.real !== false);
  writeFileSync(inbox, JSON.stringify(real.map(({ real: _r, draw: _d, ...s }) => s)));
  const sent = Date.now();
  if (onStart) onStart(sent);
  const deadline = sent + script.duration() + 15000;
  while (!existsSync(outbox)) {
    if (Date.now() > deadline) throw new Error("input.dylib never reported its steps");
    await sleep(50);
  }
  const done = JSON.parse(readFileSync(outbox, "utf8"));
  if (done.some((d) => !d.found)) throw new Error(`input.dylib couldn't find the ${script.window} window`);
  const offsets = done.map((d) => d.t - real[d.i].at).sort((a, b) => a - b);
  const origin = offsets[Math.floor(offsets.length / 2)];
  const events = [];
  for (const s of script.steps) {
    const t = origin + s.at;
    if (s.mark !== undefined) {
      const { mark, at: _a, window: _w, ...extra } = s;
      events.push({ t, mark, ...extra });
    } else if (s.note) {
      const { note: _n, at: _a, window: _w, ...extra } = s;
      events.push({ t, ...extra });
    } else if (s.type === "move") events.push({ t, x: s.x, y: s.y });
    else if (s.type === "click" && s.draw !== false) events.push({ t, x: s.x, y: s.y }, { t, down: 1 }, { t: t + PRESS_MS, up: 1 });
  }
  return events;
}
