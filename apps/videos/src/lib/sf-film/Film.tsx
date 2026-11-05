import { Audio } from "@remotion/media";
import type { ComponentProps } from "react";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { StudioObjects } from "../studio-objects-v6";
import { color, loadFonts } from "../ac-launch/theme";
import { ShotProvider } from "./kit";
import { CUTS, type CutName, f } from "./plan";
import { SHOTS } from "./shots";

loadFonts();

type Doc = ComponentProps<typeof StudioObjects>["document"];

export function Film({ cut, document, score }: { cut: CutName; document: Doc; score: string }) {
  const { shots } = CUTS[cut];
  return (
    <StudioObjects document={document}>
      <AbsoluteFill style={{ backgroundColor: color.paper }}>
        {shots.map((shot) => {
          const Shot = SHOTS[shot.kind];
          return (
            <Sequence key={shot.id} from={f(shot.at)} durationInFrames={f(shot.at + shot.beats) - f(shot.at)} name={shot.id}>
              <ShotProvider value={shot}>
                <Shot />
              </ShotProvider>
            </Sequence>
          );
        })}
        <Audio src={staticFile(`music/shared-folders/${score}.wav`)} />
      </AbsoluteFill>
    </StudioObjects>
  );
}

export const meta = (cut: CutName, width: number, height: number) => ({
  durationInFrames: f(CUTS[cut].beats),
  fps: 30,
  width,
  height,
});
