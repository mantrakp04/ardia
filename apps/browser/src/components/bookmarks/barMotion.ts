import { useEffect, useRef } from "react";
import { Animated, type View } from "react-native";
import type { MenuRect } from "../../state/bookmarks/folderMenus";
import { SLIDE } from "../tabstrip/stripReorder";
import { curve } from "../ui";
import { bookmarksBar } from "./tokens";

export const measureRect = (view: View | null): Promise<MenuRect | null> =>
  new Promise((resolve) => (view ? view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })) : resolve(null)));

export function useEased(on: boolean, inMs: number = bookmarksBar.hoverIn, outMs: number = bookmarksBar.hoverOut) {
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(value, { toValue: on ? 1 : 0, duration: on ? inMs : outMs, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [on]);
  return value;
}

export function useSlide(to: number) {
  const value = useRef(new Animated.Value(to)).current;
  useEffect(() => {
    Animated.spring(value, { toValue: to, ...SLIDE }).start();
  }, [to]);
  return value;
}
