export const USER_SCRIPTS_LOCK = "ardia-user-scripts";

export type UserScriptsLocks = {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
};

export function leadUserScripts(options: { locks?: UserScriptsLocks; start: () => void; report?: (error: unknown) => void }) {
  const { locks, start, report = (error) => console.warn("[ardia linux] userscripts lock", error) } = options;
  if (!locks) return start();
  let started = false;
  const lead = () => {
    if (started) return;
    started = true;
    start();
  };
  locks.request(USER_SCRIPTS_LOCK, () => {
    lead();
    return new Promise<void>(() => {});
  }).catch((error: unknown) => {
    report(error);
    lead();
  });
}
