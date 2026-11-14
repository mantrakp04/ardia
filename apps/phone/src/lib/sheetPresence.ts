export type Presence<T> = { target: T | null; mounted: T | null; generation: number };

export type PresenceStep<T> = { presence: Presence<T>; motion: "in" | "out" | "none"; fromHidden: boolean };

export const initialPresence = <T>(target: T | null): Presence<T> => ({ target, mounted: target, generation: 0 });

export function presenceTarget<T>(presence: Presence<T>, target: T | null): PresenceStep<T> {
  if (target !== null) {
    return { presence: { target, mounted: target, generation: presence.generation + 1 }, motion: "in", fromHidden: presence.mounted === null };
  }
  if (presence.mounted === null) return { presence: { ...presence, target: null }, motion: "none", fromHidden: false };
  return { presence: { target: null, mounted: presence.mounted, generation: presence.generation + 1 }, motion: "out", fromHidden: false };
}

export function presenceSettled<T>(presence: Presence<T>, generation: number, finished: boolean): Presence<T> {
  if (!finished || generation !== presence.generation || presence.target !== null || presence.mounted === null) return presence;
  return { ...presence, mounted: null };
}

export const presenceShown = <T>(presence: Presence<T>): T | null => presence.target ?? presence.mounted;

export const presenceCovers = <T>(presence: Presence<T>): boolean => presence.target !== null;
