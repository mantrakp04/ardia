import type { BasePalette } from "../../../lib/themeFile";
import type { ReactNode } from "react";
import type { Animated } from "react-native";
import type { Geo } from "./geometry";
import type { Look } from "./look";
import type { SwitcherIconSize } from "../../profiles/tokens";

export type SceneOpts = { addressInSidebar: boolean; systemDark: boolean; accent: string; palette: BasePalette | null; iconSize: SwitcherIconSize };
export type SceneProps = { g: Geo; look: Look; p: Animated.Value; opts: SceneOpts };
export type Scene = (props: SceneProps) => ReactNode;
