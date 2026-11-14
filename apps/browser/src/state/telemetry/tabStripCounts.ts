let groupToggles = 0;

export function noteTabStripGroupToggle() {
  groupToggles++;
}

export function takeTabStripCounts() {
  const taken = { tab_strip_group_toggles: groupToggles };
  groupToggles = 0;
  return taken;
}
