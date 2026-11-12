import { animationBursts } from "../../platform/motion";

let bursts = 0;
let longFrames = 0;

export function watchAnimationBursts() {
  animationBursts.onBurst((burst) => {
    bursts += 1;
    longFrames += burst.long;
  });
}

export function takeAnimationBursts() {
  const taken = { animation_bursts: bursts, animation_long_frames: longFrames };
  bursts = 0;
  longFrames = 0;
  return taken;
}
