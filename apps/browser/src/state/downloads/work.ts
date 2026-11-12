const EMPTY = { downloadProgressUpdates: 0, downloadRecordUpdates: 0, downloadHistoryWrites: 0, downloadHistoryBytes: 0 };
let counts = { ...EMPTY };

export function noteDownloadWork(kind: keyof typeof EMPTY, count = 1) {
  counts[kind] += count;
}

export function takeDownloadWork() {
  const taken = counts;
  counts = { ...EMPTY };
  return taken;
}
