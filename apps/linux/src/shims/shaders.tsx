import { useMemo, useState } from "react";
import { View } from "react-native";
import type { PowerUpProps, WindowBackdropProps } from "@ardia-real/shaders";
import { useBrowser } from "../../../browser/src/state/browser/store";
import { prefersReducedMotion } from "./web/gl/clock";
import { parseHex } from "./web/gl/colors";
import { GLView } from "./web/gl/GLView";
import { backdropFragment, haloFragment, powerUpFragment } from "./web/gl/sources";
import { webgl2Supported } from "./web/gl/surface";
import { backdropUniforms, HALO, haloUniforms, POWER_UP, powerUpPalette, powerUpUniforms } from "./web/gl/uniforms";
import { BackdropFallback, HaloFallback, PowerUpFallback } from "./web/gl/fallbacks";
import { Vibrancy } from "./web/gl/Vibrancy";

export * from "@ardia-real/shaders";

const FRAME = 1 / 60;

export function WindowBackdrop({ colors, angle = 180, grainOpacity = 0.09, grainScale = 1, vibrancy, tintColor, tintAlpha, tintLightness, style }: WindowBackdropProps) {
  const dark = useBrowser((s) => s.ui.appDark);
  const key = `${colors.join()}|${angle}|${grainOpacity}|${grainScale}`;
  const uniformsAt = useMemo(() => (css: [number, number]) => backdropUniforms({ colors, angle, grainOpacity, grainScale }, css), [key]);
  return (
    <View pointerEvents="none" style={style}>
      {vibrancy ? (
        <Vibrancy dark={dark} tintColor={tintColor} tintAlpha={tintAlpha} tintLightness={tintLightness} />
      ) : webgl2Supported() ? (
        <GLView fragment={backdropFragment} uniformsAt={uniformsAt} version={key} />
      ) : (
        <BackdropFallback colors={colors} angle={angle} />
      )}
    </View>
  );
}

export function PowerUp({ palette = "pink", speed = POWER_UP.defaultSpeed, origin = POWER_UP.defaultOrigin, cornerRadius = POWER_UP.defaultCornerRadius, halo = null, style }: PowerUpProps) {
  const dark = useBrowser((s) => s.ui.appDark);
  const [reduceMotion] = useState(prefersReducedMotion);
  const paletteKey = typeof palette === "string" ? palette : palette.join();
  const srgb = useMemo(() => powerUpPalette(palette), [paletteKey]);
  const powerUpAt = useMemo(() => (_css: [number, number], time: number) => powerUpUniforms({ srgb, speed, origin }, time), [srgb, speed, origin]);
  const haloAt = useMemo(
    () => (css: [number, number], time: number) => haloUniforms({ srgb, speed, cornerRadius, dark }, css, time),
    [srgb, speed, cornerRadius, dark],
  );
  if (reduceMotion) return <View pointerEvents="none" style={style} />;
  const gl = webgl2Supported();
  const haloBox = halo && halo.width > 0 && halo.height > 0
    ? { left: halo.x - HALO.inset, top: halo.y - HALO.inset, width: halo.width + 2 * HALO.inset, height: halo.height + 2 * HALO.inset }
    : null;
  return (
    <View pointerEvents="none" style={style}>
      {gl ? (
        <GLView fragment={powerUpFragment} uniformsAt={powerUpAt} animation={{ lastFrameTime: POWER_UP.finishTime - FRAME }} style={{ filter: "blur(24px)" }} />
      ) : (
        <PowerUpFallback srgb={srgb} speed={speed} />
      )}
      {haloBox ? (
        <div style={{ position: "absolute", pointerEvents: "none", ...haloBox }}>
          {gl ? (
            <GLView fragment={haloFragment} uniformsAt={haloAt} animation={{ lastFrameTime: HALO.finishTime }} />
          ) : (
            <HaloFallback color={srgb[0] ?? parseHex("#FF845A")!} speed={speed} cornerRadius={cornerRadius + 2} dark={dark} />
          )}
        </div>
      ) : null}
    </View>
  );
}
