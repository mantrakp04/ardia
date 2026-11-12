type Running = { __active: boolean };
type Frame = (time: number) => void;
type Follower = () => void;
type Timers = { requestAnimationFrame(frame: Frame): number; cancelAnimationFrame(id: number): void };

export const FRAME_MS = 1000 / 60;
const LONG_FRAME_MS = FRAME_MS * 2.5;
const REPORT_AFTER_FRAMES = 3;

const now = () => performance.now();
const timers = globalThis as unknown as Timers;

const waiting = new Map<number, Frame>();
let lastId = 0;
let due = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function runFrame() {
  timer = null;
  const time = now();
  due = Math.max(due + FRAME_MS, time + FRAME_MS / 2);
  const frames = [...waiting.values()];
  waiting.clear();
  for (const frame of frames) frame(time);
}

function requestFrame(frame: Frame): number {
  const id = ++lastId;
  waiting.set(id, frame);
  if (timer === null) timer = setTimeout(runFrame, Math.max(0, due - now()));
  return id;
}

export function installFramePacing() {
  timers.requestAnimationFrame = requestFrame;
  timers.cancelAnimationFrame = (id) => void waiting.delete(id);
}

const running = new Set<Running>();
const followers = new Set<Follower>();
let watching = false;
let burst = { frames: 0, startedAt: 0, lastAt: 0, longest: 0, long: 0 };

function watch(time: number) {
  for (const animation of running) if (!animation.__active) running.delete(animation);
  burst.frames += 1;
  const gap = time - burst.lastAt;
  burst.lastAt = time;
  if (burst.frames > 1) {
    burst.longest = Math.max(burst.longest, gap);
    if (gap > LONG_FRAME_MS) burst.long += 1;
  }
  for (const follow of [...followers]) follow();
  if (running.size) return void requestFrame(watch);
  watching = false;
  if (burst.frames >= REPORT_AFTER_FRAMES) {
    console.log(`[ardia windows] motion ${burst.frames} frames in ${Math.round(time - burst.startedAt)} ms, longest ${Math.round(burst.longest)} ms, ${burst.long} long`);
  }
}

export function noteAnimation(animation: Running) {
  running.add(animation);
  if (watching) return;
  watching = true;
  const time = now();
  burst = { frames: 0, startedAt: time, lastAt: time, longest: 0, long: 0 };
  requestFrame(watch);
}

export function forgetAnimation(animation: Running) {
  running.delete(animation);
}

export function followMotion(follow: Follower): () => void {
  followers.add(follow);
  return () => void followers.delete(follow);
}
