import { requireNativeModule } from "../modules";
import { expectTrue, type Check } from "./check";

type Windows = {
  windowIds(): Promise<string[]>;
  windowFrame(id: string): Promise<[number, number, number, number] | null>;
  setWindowTitle(id: string, title: string): Promise<void>;
  openWindow(id: string, options: { kind: string; title: string; focus: boolean }): Promise<void>;
  closeWindow(id: string): Promise<void>;
};

const windows = () => requireNativeModule<Windows>("ArdiaAppWindows");
const settled = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    name: "windows: an unknown window has no frame",
    async run() {
      expectTrue((await windows().windowFrame("no-such-window")) === null, "an unknown window reported a frame");
    },
  },
];
