import { requireOptionalNativeModule } from "expo-modules-core";
import { Linking } from "react-native";

export type SpeechAccess = "granted" | "denied" | "unavailable";

export type SpeechProblem = "language" | "service";

export type SpeechEvent =
  | { type: "text"; session: number; text: string; isFinal: boolean }
  | { type: "level"; session: number; level: number }
  | { type: "failure"; session: number; problem: SpeechProblem | null };

type Subscription = { remove(): void };

type SpeechNative = {
  isAvailable(): Promise<boolean>;
  requestAccess(): Promise<SpeechAccess>;
  start(session: number): Promise<void>;
  stop(): Promise<void>;
  addListener(eventName: "onSpeech", listener: (event: SpeechEvent) => void): Subscription;
};

const native = requireOptionalNativeModule<SpeechNative>("ArdiaPhoneSpeech");

export const canUseSpeech = () => native !== null;

export const speech = {
  isAvailable: async (): Promise<boolean> => (native ? native.isAvailable() : false),
  requestAccess: async (): Promise<SpeechAccess> => (native ? native.requestAccess() : "unavailable"),
  start: async (session: number): Promise<void> => {
    if (!native) throw new Error("speech is unavailable");
    await native.start(session);
  },
  stop: async (): Promise<void> => {
    await native?.stop();
  },
  addListener: (listener: (event: SpeechEvent) => void): Subscription => (native ? native.addListener("onSpeech", listener) : { remove() {} }),
};

export const openAppSettings = () => Linking.openSettings();
