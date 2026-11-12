const none = () => ({ new_tab_pages_held: 0, new_tab_pages_shown_unpainted: 0, new_tab_paint_wait_ms: 0 });
let tally = none();

export function noteNewTabPaint(painted: boolean, waitedMs: number) {
  tally.new_tab_pages_held++;
  if (!painted) tally.new_tab_pages_shown_unpainted++;
  tally.new_tab_paint_wait_ms += waitedMs;
}

export function takeNewTabPaints() {
  const taken = tally;
  tally = none();
  return taken;
}
