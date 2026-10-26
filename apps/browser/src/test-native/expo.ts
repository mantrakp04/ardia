import type * as Expo from "expo-modules-core";
import { ardiaCoreNativeModules } from "./ardiacore";
import { shellNativeModules, shellOptionalNativeModules } from "./shell";

const nativeModules: Record<string, object> = { ...shellNativeModules, ...ardiaCoreNativeModules };
const optionalNativeModules: Record<string, () => object | null> = { ...shellOptionalNativeModules };
const testModules = () => (globalThis as { acTestNativeModules?: Record<string, object> }).acTestNativeModules;

export const requireNativeModule: typeof Expo.requireNativeModule = <Module,>(name: string) => (testModules()?.[name] ?? nativeModules[name] ?? {}) as Module;

export const requireOptionalNativeModule: typeof Expo.requireOptionalNativeModule = <Module,>(name: string) =>
  (testModules()?.[name] ?? (name in optionalNativeModules ? optionalNativeModules[name]!() : (nativeModules[name] ?? null))) as Module | null;

export const requireNativeViewManager: typeof Expo.requireNativeViewManager = () => () => null;
