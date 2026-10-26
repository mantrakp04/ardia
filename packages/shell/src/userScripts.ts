import type { EventSubscription } from "expo-modules-core";
import { optionalNativeModule } from "./nativeModules";

export type UserScriptsFolder = { token?: string } & (
  | { state: "empty" | "busy" | "pending"; generation?: number }
  | { state: "absent"; generation: number; path: string }
  | { state: "invalid"; generation?: number; error: string; path?: string }
  | { state: "ready"; generation: number; path: string }
);

export type UserScriptsNative = {
  watch(on: boolean): void;
  read(): Promise<UserScriptsFolder>;
  readStatus(): Promise<string | null>;
  writeStatus(json: string): Promise<void>;
  addListener(name: "onChange", listener: () => void): EventSubscription;
};

const UserScripts = optionalNativeModule("ArdiaUserScripts");

export const userScriptsAvailable = () => !!UserScripts;

export const watchUserScripts = (on: boolean) => UserScripts?.watch(on);

export const readUserScripts = (): Promise<UserScriptsFolder> => UserScripts?.read() ?? Promise.resolve({ state: "empty" });

export const readUserScriptsStatus = (): Promise<string | null> => UserScripts?.readStatus() ?? Promise.resolve(null);

export const writeUserScriptsStatus = (json: string): Promise<void> => UserScripts?.writeStatus(json) ?? Promise.resolve();

export const onUserScriptsChange = (listener: () => void) => UserScripts?.addListener("onChange", listener) ?? { remove() {} };
