export function clearDividerShown(showClearButton: boolean, offScreen: boolean, tabCount: number) {
  return showClearButton && !offScreen && tabCount > 0;
}
