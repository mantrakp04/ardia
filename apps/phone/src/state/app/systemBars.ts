import { useEffect, useRef } from "react";
import { setSystemBarIcons } from "../../platform/systemBars";

export type BarIcons = { lightStatus: boolean; lightNavigation: boolean };

type Entry = { id: number; icons: BarIcons };

const stack: Entry[] = [];
let next = 0;
let applied = "";
let base: BarIcons = { lightStatus: false, lightNavigation: false };

export function topIcons(entries: readonly Entry[]): BarIcons | null {
  return entries.length ? entries[entries.length - 1]!.icons : null;
}

function apply() {
  const icons = topIcons(stack) ?? base;
  const key = `${icons.lightStatus}:${icons.lightNavigation}`;
  if (key === applied) return;
  applied = key;
  setSystemBarIcons(icons.lightStatus, icons.lightNavigation);
}

export function useSystemBars(lightStatus: boolean, lightNavigation: boolean = lightStatus) {
  const id = useRef(0);
  useEffect(() => {
    next += 1;
    id.current = next;
    stack.push({ id: next, icons: { lightStatus, lightNavigation } });
    apply();
    return () => {
      const at = stack.findIndex((entry) => entry.id === id.current);
      if (at >= 0) stack.splice(at, 1);
      apply();
    };
  }, []);
  useEffect(() => {
    const entry = stack.find((item) => item.id === id.current);
    if (!entry) return;
    entry.icons = { lightStatus, lightNavigation };
    apply();
  }, [lightStatus, lightNavigation]);
}

export function useBaseSystemBars(light: boolean) {
  useEffect(() => {
    base = { lightStatus: light, lightNavigation: light };
    apply();
  }, [light]);
}
