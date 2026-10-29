import { nativeModule, type IntroMusicCues } from "@ardia/shell";

export type { IntroMusicCues };

const App = nativeModule("ArdiaApp");

export const playIntroMusic = (cues: IntroMusicCues, muted: boolean) => void App.playIntroMusic(cues, muted);
export const setIntroMusicMuted = (muted: boolean) => void App.setIntroMusicMuted(muted);
export const stopIntroMusic = (fade = 0.4) => void App.stopIntroMusic(fade);
