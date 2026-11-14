import type { AppWindowsModule } from "../nativeModuleTypes";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const windows = () => requireNativeModule<Pick<AppWindowsModule, "windowIds" | "capturePage">>("ArdiaAppWindows");

const JPEG_BASE64 = "/9j/";

export const checks: Check[] = [
  {
    name: "a page picture answers empty for an unknown window or an empty rect, and a JPEG or empty for a real window",
    async run() {
      const native = windows();
      expectEqual(await native.capturePage("no-such-window", 0, 0, 100, 100, 0.25), "", "an unknown window");
      const [id] = await native.windowIds();
      expectTrue(id, "no window to capture in");
      expectEqual(await native.capturePage(id, 0, 0, 0, 0, 0.25), "", "an empty rect");
      const picture = await native.capturePage(id, 0, 0, 200, 150, 1);
      expectTrue(picture === "" || picture.startsWith(JPEG_BASE64), `a capture over the window answered ${picture.slice(0, 16)}`);
    },
  },
];
