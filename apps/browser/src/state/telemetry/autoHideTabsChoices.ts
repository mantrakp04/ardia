let chosen = 0;

export function noteAutoHideTabsChosen() {
  chosen++;
}

export function takeAutoHideTabsChoices(): number {
  const taken = chosen;
  chosen = 0;
  return taken;
}
