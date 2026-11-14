import type { ImportedTab, ImportResult, SpaceSuggestion } from "../../platform/importModule";

export type PlannedSpace = { space: SpaceSuggestion; partition: number };

export type SidebarPlan = {
  spaces: PlannedSpace[];
  partitions: number;
  dataPartition: number;
  favorites: ImportedTab[][];
  sharesTopApps: boolean;
};

const containerOf = (x: { container?: number }) => x.container ?? 0;

export function planSidebar(
  sidebar: "arc" | "zen",
  result: Pick<ImportResult, "spaces" | "favorites" | "separateEssentials">,
  everySpace: { container?: number }[] = [],
): SidebarPlan {
  if (sidebar === "arc") {
    return {
      spaces: result.spaces.map((space) => ({ space, partition: 0 })),
      partitions: result.spaces.length ? 1 : 0,
      dataPartition: 0,
      favorites: [result.favorites],
      sharesTopApps: false,
    };
  }
  const containers: number[] = [];
  const spaces = result.spaces.map((space) => {
    const container = containerOf(space);
    if (!containers.includes(container)) containers.push(container);
    return { space, partition: containers.indexOf(container) };
  });
  const dataPartition = Math.max(0, containers.indexOf(0));
  const dataHead = spaces.findIndex((s) => s.partition === dataPartition);
  if (dataHead > 0) spaces.unshift(...spaces.splice(dataHead, 1));
  const favorites: ImportedTab[][] = Array.from({ length: Math.max(1, containers.length) }, () => []);
  for (const tab of result.favorites) {
    if (result.separateEssentials === false) {
      favorites.forEach((list) => list.push(tab));
      continue;
    }
    const own = containers.indexOf(containerOf(tab));
    if (own >= 0) favorites[own]!.push(tab);
    else if (!everySpace.some((s) => containerOf(s) === containerOf(tab))) favorites[dataPartition]!.push(tab);
  }
  return { spaces, partitions: containers.length, dataPartition, favorites, sharesTopApps: true };
}
