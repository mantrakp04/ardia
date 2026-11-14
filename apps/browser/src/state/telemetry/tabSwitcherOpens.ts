let inWebKit = 0;

export function noteTabSwitcherOpenedInWebKit() {
  inWebKit++;
}

export function takeTabSwitcherOpensInWebKit(): number {
  const taken = inWebKit;
  inWebKit = 0;
  return taken;
}

let rowCloses = 0;

export function noteTabSwitcherRowClosed() {
  rowCloses++;
}

export function takeTabSwitcherRowCloses(): number {
  const taken = rowCloses;
  rowCloses = 0;
  return taken;
}
