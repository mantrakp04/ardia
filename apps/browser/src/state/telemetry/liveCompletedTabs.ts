let closed = 0;

export function noteLiveCompletedTabsClosed(n: number) {
  closed += n;
}

export function takeLiveCompletedTabsClosed() {
  const taken = closed;
  closed = 0;
  return taken;
}
