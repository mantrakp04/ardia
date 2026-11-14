import { create } from "zustand";
import { cancelShortcutRecording, recordShortcut } from "../../platform/commands";
import { useBrowser } from "../browser/store";
import { setShortcutOverride } from "../settings/actions";
import { noteShortcutRecorded } from "../telemetry/usage";
import { resolvedShortcuts } from "./commandShortcuts";
import { sameShortcut, type Shortcut } from "./shortcuts";

export type ShortcutRecordingPlace = Parameters<typeof noteShortcutRecorded>[0];

type LiveRecording = { owner: string; id: string; session: number };

export const NO_SHORTCUT: Shortcut = { key: "", modifiers: [] };

export const useShortcutRecording = create<{ live: LiveRecording | null }>()(() => ({ live: null }));

let sessions = 0;

const endSession = (session: number) => {
  if (useShortcutRecording.getState().live?.session === session) useShortcutRecording.setState({ live: null });
};

export const useRecordingShortcut = (owner: string, id: string) => useShortcutRecording((s) => s.live?.owner === owner && s.live.id === id);

export async function recordShortcutFor(owner: string, id: string, place: ShortcutRecordingPlace) {
  const session = ++sessions;
  useShortcutRecording.setState({ live: { owner, id, session } });
  const combo = await recordShortcut().catch(() => null);
  endSession(session);
  if (!combo) return;
  const fallback = resolvedShortcuts(useBrowser.getState()).defaultsOf(id)[0] ?? NO_SHORTCUT;
  setShortcutOverride(id, sameShortcut(combo, fallback) ? null : combo);
  noteShortcutRecorded(place);
}

export function cancelShortcutRecordingFor(owner: string) {
  const live = useShortcutRecording.getState().live;
  if (live?.owner !== owner) return;
  endSession(live.session);
  void cancelShortcutRecording();
}

export const clearShortcut = (id: string) => setShortcutOverride(id, resolvedShortcuts(useBrowser.getState()).defaultsOf(id).length ? NO_SHORTCUT : null);

export const resetShortcut = (id: string) => setShortcutOverride(id, null);
