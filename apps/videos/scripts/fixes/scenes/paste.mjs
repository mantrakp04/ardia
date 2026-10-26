import { execFileSync } from "node:child_process";

const LINK = "https://ardia.dev/release-notes/0.2.41";
const TITLE = "Ardia 0.2.41 release notes";

export default {
  setup: `st().activate("t3"); return sleep(2500).then(() => done());`,
  prepare: async (instance, side) => {
    if (side !== "after") throw new Error("the release build shares the Mac's real clipboard; film the after side only");
    const name = `com.ardia.scratch:${instance.data}`;
    execFileSync("osascript", ["-l", "JavaScript", "-e", `ObjC.import("AppKit");
      const pb = $.NSPasteboard.pasteboardWithName(${JSON.stringify(name)});
      pb.clearContents;
      pb.setPropertyListForType($([[${JSON.stringify(LINK)}], [${JSON.stringify(TITLE)}]]), "WebURLsWithTitlesPboardType");
      pb.setStringForType(${JSON.stringify(LINK)}, "public.url");
      pb.setStringForType(${JSON.stringify(TITLE)}, "public.url-name");
      pb.setStringForType(${JSON.stringify(LINK)}, "public.utf8-plain-text");
      ObjC.unwrap(pb.types).length`], { timeout: 10000 });
    return { pasteboard: name };
  },
  act: `return sleep(600).then(() => key("⌘T", CMD, "t", 17)).then(() => sleep(1100)).then(() => { mark("go"); return key("⌘V", CMD, "v", 9); }).then(() => sleep(2400)).then(() => { globalThis.nativeModuleProxy.Clipboard.setString("ardia.dev/release-notes/\\n0.2.41\\n"); return sleep(200); }).then(() => key("⌘A ⌘V", CMD, "a", 0)).then(() => sleep(120)).then(() => dw("keys:" + CMD + ":v:9")).then(() => sleep(2600)).then(() => done());`,
};
