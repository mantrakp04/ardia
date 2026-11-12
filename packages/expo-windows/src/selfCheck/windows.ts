import type { WindowsNative } from "@ardia/shell";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type Fade = {
  animates: boolean;
  exists: boolean;
  visible?: boolean;
  layered?: boolean;
  phase?: "none" | "revealing" | "entering" | "leaving" | "lingering";
  opacity?: number;
  closing?: boolean;
  pageWindows?: number;
};

type Windows = Pick<WindowsNative, "windowIds" | "windowFrame" | "setWindowTitle" | "openWindow" | "closeWindow" | "animateWindowClose"> & {
  debugWindowFade(id: string): Promise<Fade | null>;
};

const windows = () => requireNativeModule<Windows>("ArdiaAppWindows");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MAIN_EXIT_MS = 180;
const EXIT_FLOOR_MS = 120;
const RESOLVE_LIMIT_MS = 5000;

async function within<Value>(work: Promise<Value>, ms: number, what: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function fadeOf(id: string) {
  const fade = await windows().debugWindowFade(id);
  expectTrue(fade, "debugWindowFade did not answer");
  return fade;
}

async function untilSettled(id: string, ms: number) {
  const deadline = Date.now() + ms;
  for (;;) {
    const fade = await fadeOf(id);
    if (fade.phase === "none" || Date.now() > deadline) return fade;
    await settled(25);
  }
}

async function firstWindowLayered() {
  const ids = await windows().windowIds();
  expectTrue(ids.length > 0, "no window is open");
  return (await fadeOf(ids[0]!)).layered;
}

async function closeAndForget(id: string) {
  await windows().closeWindow(id);
  await settled(300);
  expectTrue(!(await windows().windowIds()).includes(id), `${id} is still listed after it closed`);
}

export const checks: Check[] = [
  {
    name: "windows: the first window exists and has a frame",
    async run() {
      const ids = await windows().windowIds();
      expectTrue(ids.length > 0, "no window is open");
      const frame = await windows().windowFrame(ids[0]!);
      expectTrue(frame && frame.length === 4 && frame[2] > 100 && frame[3] > 100, `the first window's frame is ${JSON.stringify(frame)}`);
    },
  },
  {
    name: "windows: a second window opens and closes",
    async run() {
      const id = "self-check-window";
      await windows().openWindow(id, { kind: "import", title: "Self check", focus: false });
      await settled(300);
      expectTrue((await windows().windowIds()).includes(id), "the opened window is not listed");
      await windows().setWindowTitle(id, "Self check, renamed");
      await windows().closeWindow(id);
      await settled(300);
      expectTrue(!(await windows().windowIds()).includes(id), "the closed window is still listed");
    },
  },
  {
    name: "windows: an animated window fades in, then fades out before its close resolves",
    async run() {
      const id = "self-check-fade";
      const layered = await firstWindowLayered();
      await windows().openWindow(id, { kind: "import", title: "Fade check", focus: false, animated: true });
      const opened = await fadeOf(id);
      expectTrue(opened.exists, "the animated window is not known to native");
      if (opened.animates) {
        expectTrue(opened.phase !== "leaving" && opened.phase !== "lingering", `the animated window opened with fade phase ${opened.phase}`);
        if (opened.phase !== "none") expectTrue(opened.layered, "the animated window is not layered while it fades in");
      }
      const shown = await untilSettled(id, 3000);
      expectEqual(shown.phase, "none", "the fade phase 3 s after opening");
      expectTrue(shown.visible, "the animated window is not visible after its entrance");
      expectEqual(shown.layered, layered, "whether the window is layered after its entrance, against the first window");
      expectEqual(shown.opacity, 1, "the window's opacity after its entrance");

      const started = Date.now();
      await within(windows().animateWindowClose(id, null), RESOLVE_LIMIT_MS, "animateWindowClose");
      const took = Date.now() - started;
      const closed = await fadeOf(id);
      expectTrue(closed.exists, "the window was destroyed by animateWindowClose, which should only hide it");
      expectTrue(!closed.visible, "the window is still visible when animateWindowClose resolved");
      expectEqual(closed.layered, layered, "whether the hidden window is layered, against the first window");
      if (closed.animates) expectTrue(took >= EXIT_FLOOR_MS, `animateWindowClose resolved after ${took} ms, before the ${MAIN_EXIT_MS} ms fade could run`);
      await closeAndForget(id);
    },
  },
  {
    name: "windows: a close during the entrance, a second close and an unknown close all resolve",
    async run() {
      const id = "self-check-fade-interrupted";
      const layered = await firstWindowLayered();
      await windows().openWindow(id, { kind: "import", title: "Fade check", focus: false, animated: true });
      const first = windows().animateWindowClose(id, null);
      const second = windows().animateWindowClose(id, null);
      await within(Promise.all([first, second]), RESOLVE_LIMIT_MS, "two animateWindowClose calls during the entrance");
      const closed = await fadeOf(id);
      expectTrue(!closed.visible, "the window is still visible after a close during its entrance");
      expectEqual(closed.layered, layered, "whether the window is layered after a close during its entrance, against the first window");
      expectTrue(closed.phase === "none" || closed.phase === "lingering", `the fade phase after a close during the entrance is ${closed.phase}`);
      await closeAndForget(id);
      await within(windows().animateWindowClose("no-such-window", null), RESOLVE_LIMIT_MS, "animateWindowClose for an unknown window");
      const unknown = await fadeOf("no-such-window");
      expectTrue(!unknown.exists, "an unknown window is reported as existing");
    },
  },
  {
    name: "windows: an unknown window has no frame",
    async run() {
      expectTrue((await windows().windowFrame("no-such-window")) === null, "an unknown window reported a frame");
    },
  },
];
