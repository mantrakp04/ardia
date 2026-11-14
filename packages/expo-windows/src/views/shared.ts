import { useEffect, type ComponentType } from "react";
import { useAppDark } from "./appearance";
import { noteFirstWindow } from "../missing";

export type ViewByName = ComponentType<never>;

export const finite = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const colorOrUndefined = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

export const useDark = useAppDark;

export function useFirstWindow() {
  useEffect(noteFirstWindow, []);
}

export function claimOnce(set: WeakSet<object>, token: unknown): boolean {
  if (!token || typeof token !== "object") return true;
  if (set.has(token)) return false;
  set.add(token);
  return true;
}
