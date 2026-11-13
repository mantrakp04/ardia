let shows = 0;
let longShows = 0;
let skips = 0;

export const noteLoadingPillShown = () => void shows++;
export const noteLoadingPillLong = () => void longShows++;
export const noteLoadingPillSkipped = () => void skips++;

export function takeLoadingPillCounts() {
  const taken = { loading_pill_shows: shows, loading_pill_long_shows: longShows, loading_pill_skips: skips };
  shows = longShows = skips = 0;
  return taken;
}
