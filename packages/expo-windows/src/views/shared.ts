import { useEffect, type ReactNode } from "react";
import type { ViewStyle } from "react-native";
import { useAppDark } from "./appearance";
import { noteFirstWindow } from "../missing";
import { withOpacity } from "./color";

export type AnyProps = Record<string, unknown> & { children?: ReactNode };

export const SHADOW_BLUR_PER_RADIUS = 2;

export const finite = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const colorOrUndefined = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

export const useDark = useAppDark;

export function useFirstWindow() {
  useEffect(noteFirstWindow, []);
}

export function dropShadow(color: unknown, opacity: unknown, radius: unknown, offsetX: unknown, offsetY: unknown): ViewStyle | null {
  const alpha = finite(opacity, 0);
  const shadowColor = colorOrUndefined(color);
  if (!shadowColor || alpha <= 0) return null;
  return {
    shadowColor: withOpacity(shadowColor, 1),
    shadowOpacity: Math.min(1, alpha),
    shadowRadius: Math.max(0, finite(radius, 0)) * SHADOW_BLUR_PER_RADIUS,
    shadowOffset: { width: finite(offsetX, 0), height: finite(offsetY, 0) },
  };
}

export function claimOnce(set: WeakSet<object>, token: unknown): boolean {
  if (!token || typeof token !== "object") return true;
  if (set.has(token)) return false;
  set.add(token);
  return true;
}
