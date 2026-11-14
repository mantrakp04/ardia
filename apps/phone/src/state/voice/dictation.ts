export type DictationProblem = "language" | "service" | "heardNothing";

export type DictationPhase = "idle" | "requesting" | "listening" | "finished" | "denied" | "unavailable";

export type Dictation = { phase: DictationPhase; problem: DictationProblem | null; transcript: string; level: number; attempt: number };

export type DictationAccess = "granted" | "denied" | "unavailable";

export const SILENCE_TIMEOUT_MS = 1600;
export const FIRST_WORDS_GRACE_MS = 4000;
export const LEVEL_BARS = 24;

export const DICTATION_IDLE: Dictation = { phase: "idle", problem: null, transcript: "", level: 0, attempt: 0 };

export function begin(state: Dictation): Dictation {
  if (state.phase === "listening" || state.phase === "requesting") return state;
  return { ...state, phase: "requesting", problem: null, attempt: state.attempt + 1 };
}

export function accessResolved(state: Dictation, attempt: number, access: DictationAccess): Dictation {
  if (attempt !== state.attempt || state.phase !== "requesting") return state;
  if (access === "denied") return { ...state, phase: "denied" };
  if (access === "unavailable") return { ...state, phase: "unavailable", problem: "service" };
  return { ...state, phase: "listening", transcript: "" };
}

export function recorderFailed(state: Dictation, attempt: number): Dictation {
  if (attempt !== state.attempt || state.phase !== "listening") return state;
  return { ...state, phase: "unavailable", problem: "service", level: 0 };
}

export function stopped(state: Dictation): Dictation {
  const next = { ...state, attempt: state.attempt + 1, level: 0 };
  if (state.phase === "listening") return state.transcript ? { ...next, phase: "finished" } : { ...next, phase: "unavailable", problem: "heardNothing" };
  if (state.phase === "requesting") return { ...next, phase: "idle" };
  return next;
}

export function heard(state: Dictation, attempt: number, text: string, isFinal: boolean): Dictation {
  if (attempt !== state.attempt || state.phase !== "listening") return state;
  const next = { ...state, transcript: text };
  return isFinal ? stopped(next) : next;
}

export function leveled(state: Dictation, attempt: number, level: number): Dictation {
  if (attempt !== state.attempt || state.phase !== "listening") return state;
  return { ...state, level: Math.min(1, Math.max(0, level)) };
}

export function failed(state: Dictation, attempt: number, problem: Exclude<DictationProblem, "heardNothing"> | null): Dictation {
  if (attempt !== state.attempt || state.phase !== "listening") return state;
  const keepsTranscript = state.transcript.length > 0;
  const next = stopped(state);
  return problem && !keepsTranscript ? { ...next, phase: "unavailable", problem } : next;
}

export const silenceWait = (state: Dictation) => SILENCE_TIMEOUT_MS + (state.transcript ? 0 : FIRST_WORDS_GRACE_MS);

export type VoiceControl = { kind: "done" } | { kind: "search"; text: string } | { kind: "tryAgain" } | null;

export function voiceControl(state: Dictation): VoiceControl {
  const text = state.transcript.trim();
  if (state.phase === "listening") return { kind: "done" };
  if (text) return { kind: "search", text };
  if (state.phase !== "requesting") return { kind: "tryAgain" };
  return null;
}

export function pushLevel(levels: readonly number[], level: number): number[] {
  return [...levels.slice(levels.length >= LEVEL_BARS ? 1 : 0), level];
}

export const PROBLEM_TEXT: Record<DictationProblem, string> = {
  language: "Dictation is unavailable in your language.",
  service: "Speech dictation is unavailable.",
  heardNothing: "Ardia couldn’t hear anything. Try again.",
};
