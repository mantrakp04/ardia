import { useState } from "react";
import { Image, View, type ImageSourcePropType, type LayoutChangeEvent } from "react-native";
import type { MeadowProps } from "./index";
import posters from "../ios/Meadow/posters.json";

type Poster = (typeof posters)[number];
type Size = { width: number; height: number };

const DAWN: Record<string, ImageSourcePropType> = {
  "dawn-wider-2196.webp": require("../windows/meadow/dawn-wider-2196.jpg"),
  "dawn-wide-1766.webp": require("../windows/meadow/dawn-wide-1766.jpg"),
  "dawn-laptop-1917.webp": require("../windows/meadow/dawn-laptop-1917.jpg"),
  "dawn-mid-1600.webp": require("../windows/meadow/dawn-mid-1600.jpg"),
};

export const WINDOWS_POSTERS = posters.filter((p) => p.state === "dawn" && Object.hasOwn(DAWN, p.file));

export function nearestPoster(aspect: number): Poster | null {
  let best: Poster | null = null;
  for (const poster of WINDOWS_POSTERS) if (!best || Math.abs(Math.log(poster.aspect / aspect)) < Math.abs(Math.log(best.aspect / aspect))) best = poster;
  return best;
}

export function posterFrame(poster: Pick<Poster, "aspect" | "horizon">, size: Size) {
  const scale = Math.max(size.width / poster.aspect, size.height);
  const width = poster.aspect * scale;
  const height = scale;
  return { left: (size.width - width) / 2, top: (size.height - height) * poster.horizon, width, height };
}

export function Meadow({ night, style, testID }: MeadowProps) {
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((now) => (now && now.width === width && now.height === height ? now : { width, height }));
  };
  const poster = !night && size && size.width > 0 && size.height > 0 ? nearestPoster(size.width / size.height) : null;
  return (
    <View pointerEvents="none" testID={testID} style={[style, { overflow: "hidden" }]} onLayout={onLayout}>
      {poster && size && <Image source={DAWN[poster.file]!} fadeDuration={0} style={{ position: "absolute", ...posterFrame(poster, size) }} />}
    </View>
  );
}
