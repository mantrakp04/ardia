let held = 0;

export function noteAutoPictureInPictureNothingPlaying() {
  held++;
}

export function takeAutoPictureInPictureNothingPlaying(): number {
  const taken = held;
  held = 0;
  return taken;
}
