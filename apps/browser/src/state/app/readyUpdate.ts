import { create } from "zustand";
import { onReadyUpdate, restartToUpdate as restartNative, updaterState, type ReadyUpdate } from "../../platform/app";
import { openReleaseNotesPage } from "../releaseNotes/releaseNotesPage";
import { showMenu } from "./system";
import { noteReadyUpdate } from "../telemetry/usage";

export type { ReadyUpdate } from "../../platform/app";

export const useReadyUpdateState = create<{ ready: ReadyUpdate | null; onQuitBuild: string | null }>()(() => ({ ready: null, onQuitBuild: null }));

export const useReadyUpdate = () => useReadyUpdateState((s) => (s.ready && s.ready.build !== s.onQuitBuild ? s.ready : null));

export function restartToUpdate() {
  noteReadyUpdate("restart");
  void restartNative().catch((error) => console.warn("[readyUpdate] restart", error));
}

export async function openReadyUpdateMenu(windowId: string | null) {
  const ready = useReadyUpdateState.getState().ready;
  if (!ready) return;
  const choice = await showMenu([
    { id: "restart", title: `Restart to Update to ${ready.displayVersion}`, symbol: "arrow.clockwise.circle" },
    { id: "notes", title: "Release Notes", symbol: "doc.text" },
    { separator: true },
    { id: "onQuit", title: "Install When I Quit", symbol: "eye.slash" },
  ]);
  if (choice === "restart") restartToUpdate();
  else if (choice === "notes") openReleaseNotesPage(windowId, ready.version);
  else if (choice === "onQuit") {
    noteReadyUpdate("onQuit");
    useReadyUpdateState.setState({ onQuitBuild: ready.build });
  }
}

let started = false;
let shownBuild: string | null = null;

function setReady(ready: ReadyUpdate | null) {
  if (ready && ready.build !== shownBuild) {
    shownBuild = ready.build;
    noteReadyUpdate("shown");
  }
  useReadyUpdateState.setState({ ready });
}

export function startReadyUpdate() {
  if (started) return;
  started = true;
  let heard = false;
  onReadyUpdate((ready) => {
    heard = true;
    setReady(ready);
  });
  void updaterState()
    .then((state) => {
      if (!heard && state.available) setReady(state.ready ?? null);
    })
    .catch((error) => console.warn("[readyUpdate] state", error));
}
