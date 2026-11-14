let rowHides = 0;
let stackHides = 0;

export function noteLiveRowHide() {
  rowHides++;
}

export function noteLiveStackHide() {
  stackHides++;
}

export function takeLiveHideCounts() {
  const taken = { live_row_hides: rowHides, live_stack_hides: stackHides };
  rowHides = 0;
  stackHides = 0;
  return taken;
}
