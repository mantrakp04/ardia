import { Clock, type HLC } from "../../platform/sync";

let clock = new Clock("");

export const editClock = () => clock;

export const useEditClock = (next: Clock) => void (clock = next);

export function startEditClock(device: string, last: HLC | null) {
  const next = new Clock(device, last);
  next.observe(clock.last);
  clock = next;
}

export const editStamp = (): HLC => clock.tick();
