let chosen = 0;

export function noteAutoHideTabsChosen() {
  chosen++;
}

export function takeAutoHideTabsChoices(): number {
  const taken = chosen;
  chosen = 0;
  return taken;
}

let tornOffKept = 0;

export function noteTornOffWindowKeptAutoHide() {
  tornOffKept++;
}

export function takeTornOffWindowsKeptAutoHide(): number {
  const taken = tornOffKept;
  tornOffKept = 0;
  return taken;
}
