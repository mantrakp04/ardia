export const TOOLBAR_BOUNCE_MS = 1000;

type Hidden = Record<string, true>;

export function toolbarBounces(exists: (tabId: string) => boolean, now: () => number = Date.now) {
  const shownAt = new Map<string, number>();
  return {
    get tracked() {
      return shownAt.size;
    },
    note(hidden: Hidden, before: Hidden): { hides: number; bounces: number } {
      const at = now();
      for (const [id, shown] of shownAt) if (at - shown >= TOOLBAR_BOUNCE_MS) shownAt.delete(id);
      for (const id in before) if (!hidden[id] && exists(id)) shownAt.set(id, at);
      let hides = 0;
      let bounces = 0;
      for (const id in hidden) {
        if (before[id]) continue;
        hides++;
        const shown = shownAt.get(id);
        if (shown !== undefined && at - shown < TOOLBAR_BOUNCE_MS) bounces++;
        shownAt.delete(id);
      }
      return { hides, bounces };
    },
  };
}
