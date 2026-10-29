type SessionCloseHooks = { quiesce(token: string): void; resume(token: string): void };
const producers = new Set<SessionCloseHooks>();
export const registerSessionCloseHooks = (hooks: SessionCloseHooks) => {
  producers.add(hooks);
  return () => { producers.delete(hooks); };
};
export const quiesceLinuxSession = (token: string) => { for (const producer of producers) producer.quiesce(token); };
export const resumeLinuxSession = (token: string) => { for (const producer of producers) producer.resume(token); };
