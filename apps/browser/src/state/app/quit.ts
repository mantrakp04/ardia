let quitting = false;

export const isQuitting = () => quitting;
export const setQuitting = (on: boolean) => void (quitting = on);

const quitSaves = new Set<() => Promise<void>>();
const reportFailure = (error: unknown) => console.warn("[quit] a save before quitting failed", error);

export const saveBeforeQuit = (save: () => Promise<void>) => void quitSaves.add(save);

export async function finishQuitSaves(deadlineMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, deadlineMs)));
  const saves = [...quitSaves].map((save) => Promise.resolve().then(save).catch(reportFailure));
  await Promise.race([Promise.all(saves), deadline]);
  clearTimeout(timer);
}

export const answerQuitAfterSaves = (deadlineMs: number, answer: () => unknown) =>
  finishQuitSaves(deadlineMs)
    .catch(reportFailure)
    .then(() => void answer());
