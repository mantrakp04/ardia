export type AnimationBurst = { frames: number; milliseconds: number; longest: number; long: number };

export type AnimationBursts = { onBurst(listen: (burst: AnimationBurst) => void): () => void };

export const animationBursts: AnimationBursts = { onBurst: () => () => {} };
