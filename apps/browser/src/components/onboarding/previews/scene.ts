import type { ReactNode } from "react";
import type { Animated } from "react-native";
import type { Geo } from "./geometry";
import type { Look } from "./look";

export type SceneOpts = { addressInSidebar: boolean; systemDark: boolean; accent: string };
export type SceneProps = { g: Geo; look: Look; p: Animated.Value; opts: SceneOpts };
export type Scene = (props: SceneProps) => ReactNode;
