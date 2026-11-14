import type { MotionBurst, MotionNative } from "@ardia/shell";

type Running = { __active: boolean };
type Frame = (time: number) => void;
type Follower = () => void;
type Timers = { requestAnimationFrame(frame: Frame): number; cancelAnimationFrame(id: number): void };

type BurstListener = (burst: MotionBurst) => void;

export const FRAME_MS = 1000 / 60;
const LONG_FRAME_MS = FRAME_MS * 2.5;
const REPORT_AFTER_FRAMES = 3;

const now = () => performance.now();
const timers = globalThis as unknown as Timers;

let waiting = new Map<number, Frame>();
let turn = new Map<number, Frame>();
let lastId = 0;
let due = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const report = (error: unknown) => console.error("[ardia windows] an animation frame failed", error);

function runFrame() {
  timer = null;
  const time = now();
  due = Math.max(due + FRAME_MS, time + FRAME_MS / 2);
  turn = waiting;
  waiting = new Map();
  for (const [id, frame] of turn) {
    turn.delete(id);
    try {
      frame(time);
    } catch (error) {
      report(error);
    }
  }
}

export function requestFrame(frame: Frame): number {
  const id = ++lastId;
  waiting.set(id, frame);
  if (timer === null) timer = setTimeout(runFrame, Math.max(0, due - now()));
  return id;
}

export function cancelFrame(id: number) {
  waiting.delete(id);
  turn.delete(id);
}

export function installFramePacing() {
  timers.requestAnimationFrame = requestFrame;
  timers.cancelAnimationFrame = cancelFrame;
}

const running = new Set<Running>();
const followers = new Set<Follower>();
const burstListeners = new Set<BurstListener>();
let watching = false;
let burst = { frames: 0, startedAt: 0, lastAt: 0, longest: 0, long: 0 };

function each<Listener>(listeners: Set<Listener>, call: (listener: Listener) => void) {
  for (const listener of [...listeners]) {
    try {
      call(listener);
    } catch (error) {
      report(error);
    }
  }
}

function watch(time: number) {
  for (const animation of running) if (!animation.__active) running.delete(animation);
  burst.frames += 1;
  const gap = time - burst.lastAt;
  burst.lastAt = time;
  if (burst.frames > 1) {
    burst.longest = Math.max(burst.longest, gap);
    if (gap > LONG_FRAME_MS) burst.long += 1;
  }
  each(followers, (follow) => follow());
  if (running.size) return void requestFrame(watch);
  watching = false;
  if (burst.frames < REPORT_AFTER_FRAMES) return;
  const ended: MotionBurst = { frames: burst.frames, milliseconds: Math.round(time - burst.startedAt), longest: Math.round(burst.longest), long: burst.long };
  console.log(`[ardia windows] motion ${ended.frames} frames in ${ended.milliseconds} ms, longest ${ended.longest} ms, ${ended.long} long`);
  each(burstListeners, (listen) => listen(ended));
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

export function onMotionBurst(listen: BurstListener): () => void {
  burstListeners.add(listen);
  return () => void burstListeners.delete(listen);
}

export const windowsMotion: MotionNative = { onBurst: onMotionBurst };
