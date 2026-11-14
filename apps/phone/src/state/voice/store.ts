import { create } from "zustand";
import { canUseSpeech, openAppSettings, speech, type SpeechEvent } from "../../platform/voice";
import { searchFor } from "../browse/store";
import { settled } from "../pages/store";
import {
  accessResolved,
  begin,
  DICTATION_IDLE,
  failed,
  heard,
  LEVEL_BARS,
  leveled,
  pushLevel,
  recorderFailed,
  silenceWait,
  stopped,
  type Dictation,
} from "./dictation";

type VoiceState = { presented: boolean; dictation: Dictation; levels: number[] };

const quiet = () => Array<number>(LEVEL_BARS).fill(0);

export const useVoice = create<VoiceState>()(() => ({ presented: false, dictation: DICTATION_IDLE, levels: quiet() }));

let silence: ReturnType<typeof setTimeout> | null = null;
let subscription: { remove(): void } | null = null;

function update(change: (dictation: Dictation) => Dictation): Dictation {
  const before = useVoice.getState().dictation;
  const after = change(before);
  if (after !== before) useVoice.setState({ dictation: after });
  return after;
}

function clearSilence() {
  if (silence) clearTimeout(silence);
  silence = null;
}

function listenForSilence(dictation: Dictation) {
  clearSilence();
  if (dictation.phase === "listening") silence = setTimeout(stopListening, silenceWait(dictation));
}

function release() {
  clearSilence();
  void settled(() => speech.stop(), undefined);
}

function onSpeech(event: SpeechEvent) {
  const current = useVoice.getState().dictation;
  if (event.session !== current.attempt || current.phase !== "listening") return;
  if (event.type === "level") {
    const next = leveled(current, event.session, event.level);
    useVoice.setState((state) => ({ dictation: next, levels: pushLevel(state.levels, next.level) }));
    return;
  }
  const next = update((dictation) => (event.type === "text" ? heard(dictation, event.session, event.text, event.isFinal) : failed(dictation, event.session, event.problem)));
  if (next.phase === "listening") listenForSilence(next);
  else release();
}

export const canSearchByVoice = canUseSpeech;

export async function startListening() {
  const before = useVoice.getState().dictation;
  const asked = update(begin);
  if (asked === before) return;
  subscription ??= speech.addListener(onSpeech);
  const available = await settled(() => speech.isAvailable(), false);
  const access = available ? await settled(() => speech.requestAccess(), "unavailable" as const) : "unavailable";
  const on = update((dictation) => accessResolved(dictation, asked.attempt, access));
  if (on.phase !== "listening" || on.attempt !== asked.attempt) return;
  useVoice.setState({ levels: quiet() });
  const started = await settled(() => speech.start(on.attempt).then(() => true), false);
  if (!started) {
    update((dictation) => recorderFailed(dictation, on.attempt));
    return;
  }
  listenForSilence(useVoice.getState().dictation);
}

export function stopListening() {
  update(stopped);
  release();
}

export function presentVoiceSearch(): boolean {
  if (!canUseSpeech()) return false;
  useVoice.setState((state) => ({ presented: true, dictation: { ...DICTATION_IDLE, attempt: state.dictation.attempt }, levels: quiet() }));
  void startListening();
  return true;
}

export function closeVoiceSearch() {
  if (!useVoice.getState().presented) return;
  stopListening();
  subscription?.remove();
  subscription = null;
  useVoice.setState({ presented: false });
}

export function searchSpoken(text: string) {
  closeVoiceSearch();
  searchFor(text);
}

export const openSpeechSettings = () => void settled(() => openAppSettings(), undefined);

export const useVoicePresented = () => useVoice((state) => state.presented);

export const useDictation = () => useVoice((state) => state.dictation);

export const useVoiceLevels = () => useVoice((state) => state.levels);
