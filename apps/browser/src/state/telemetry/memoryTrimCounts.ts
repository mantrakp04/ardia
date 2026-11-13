let trims = 0;
let givenUp = 0;

export const noteMemoryTrim = () => void (trims += 1);
export const noteMemoryTrimGivenUp = () => void (givenUp += 1);

export function takeMemoryTrimCounts() {
  const taken = { engine_memory_trims: trims, engine_memory_trims_given_up: givenUp };
  trims = 0;
  givenUp = 0;
  return taken;
}
