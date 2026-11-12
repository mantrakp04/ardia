export type MotionBurst = { frames: number; milliseconds: number; longest: number; long: number };

export type MotionNative = { onBurst(listen: (burst: MotionBurst) => void): () => void };
