const OFF_THE_RECORD = "@";

const isPrivate = (profile: string) => profile.includes(OFF_THE_RECORD);
const originalOf = (profile: string) => profile.slice(profile.indexOf(OFF_THE_RECORD) + 1);

export function takerOfOpenedTab<Candidate extends { profile: string }>(listening: readonly Candidate[], profile: string | undefined): Candidate | undefined {
  if (profile === undefined) return listening.find((page) => !isPrivate(page.profile));
  const same = listening.find((page) => page.profile === profile);
  if (same || !isPrivate(profile)) return same;
  return listening.find((page) => isPrivate(page.profile) && originalOf(page.profile) === originalOf(profile));
}
