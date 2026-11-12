type Unsubscribe = () => void;

export type SlowJob = {
  every: number;
  run: () => void;
  needed?: () => boolean;
  watch?: (changed: () => void) => Unsubscribe;
};

type Entry = SlowJob & { next: number; armed: boolean };

const GRID_SLACK_MS = 50;

const jobs = new Set<Entry>();
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = Infinity;
let clock = () => Date.now();
let firing = false;

const slotAfter = (t: number, every: number) => (Math.floor(t / every) + 1) * every;

const isNeeded = (job: Entry) => {
  try {
    return job.needed ? job.needed() : true;
  } catch {
    return true;
  }
};

export function everySlowly(job: SlowJob): Unsubscribe {
  const entry: Entry = { ...job, next: slotAfter(clock(), job.every), armed: false };
  jobs.add(entry);
  const unwatch = job.watch?.(reschedule);
  reschedule();
  return () => {
    jobs.delete(entry);
    unwatch?.();
    reschedule();
  };
}

export function reschedule() {
  if (firing) return;
  const now = clock();
  let next = Infinity;
  for (const job of jobs) {
    if (!isNeeded(job)) {
      job.armed = false;
      continue;
    }
    if (!job.armed && job.next <= now) job.next = slotAfter(now, job.every);
    job.armed = true;
    next = Math.min(next, job.next);
  }
  if (next === timerAt) return;
  if (timer) clearTimeout(timer);
  timer = null;
  timerAt = next;
  if (next !== Infinity) timer = setTimeout(fire, Math.max(0, next - now));
}

function fire() {
  timer = null;
  timerAt = Infinity;
  const now = clock();
  const due = [...jobs].filter((job) => job.armed && job.next <= now + GRID_SLACK_MS);
  for (const job of due) job.next = slotAfter(Math.max(now, job.next), job.every);
  firing = true;
  try {
    for (const job of due) {
      if (!jobs.has(job) || !isNeeded(job)) continue;
      try {
        job.run();
      } catch (error) {
        console.error(error);
      }
    }
  } finally {
    firing = false;
  }
  reschedule();
}

export function slowTimersForTests(now: () => number) {
  for (const job of jobs) job.next = slotAfter(now(), job.every);
  clock = now;
  return {
    pending: () => (timer ? timerAt : null),
    fire: () => {
      if (timer) clearTimeout(timer);
      fire();
    },
    clear: () => {
      jobs.clear();
      if (timer) clearTimeout(timer);
      timer = null;
      timerAt = Infinity;
    },
  };
}
