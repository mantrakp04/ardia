let runs = 0;
let moved = 0;
let undos = 0;

export function noteTidyTabsRun(tabsMoved: number) {
  runs++;
  moved += tabsMoved;
}

export const noteTidyTabsUndo = () => undos++;

export function takeTidyTabsCounts() {
  const taken = { tidy_tabs_runs: runs, tidy_tabs_moved: moved, tidy_tabs_undos: undos };
  runs = 0;
  moved = 0;
  undos = 0;
  return taken;
}
