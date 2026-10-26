import * as shell from "@ardia/shell";
import { readDocument, writeDocument } from "@ardia/shell";
import * as actions from "../../src/state/browser/actions";
import { runCommand } from "../../src/state/commands/commands";
import { webviews } from "../../src/platform/webviews";
import { usePages } from "../../src/state/tabs/pageState";
import { useBrowser } from "../../src/state/browser/store";
import { devJourneys } from "../../src/state/telemetry/journeys";
import { devState as telemetryState } from "../../src/state/telemetry/client";

writeDocument("bench-boot.json", JSON.stringify({ jsStart: Date.now() }));

let pausedUntil = 0;
const ac = {
  store: useBrowser,
  pages: usePages,
  actions,
  runCommand,
  webviews,
  shell,
  now: () => Date.now(),
  journeys: devJourneys,
  telemetry: telemetryState,
  blockedFetches: () => globalThis.__acBlockedFetches?.() ?? [],
  get preload() {
    return require("../../src/platform/preload");
  },
  pause(ms) {
    pausedUntil = Date.now() + ms;
  },
};
globalThis.ac = ac;

const idOf = (source) => source?.match(/^\/\/ *(\S+)/)?.[1];
let lastId = idOf(readDocument("bench-cmd.js")) ?? "";

function poll() {
  const wait = pausedUntil - Date.now();
  if (wait > 0) return void setTimeout(poll, wait);
  const source = readDocument("bench-cmd.js");
  const id = idOf(source);
  if (source && id && id !== lastId) {
    lastId = id;
    const done = (body) => writeDocument("bench-result.json", JSON.stringify({ id, ...body }));
    try {
      Promise.resolve(new Function("ac", source)(ac)).then(
        (result) => done({ result: result ?? null }),
        (error) => done({ error: String(error) }),
      );
    } catch (error) {
      done({ error: String(error) });
    }
  }
  setTimeout(poll, 50);
}
setTimeout(poll, 50);
