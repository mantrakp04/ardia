let shows = 0;
let longShows = 0;

export const noteLoadingPillShown = () => void shows++;
export const noteLoadingPillLong = () => void longShows++;

export function takeLoadingPillCounts() {
  const taken = { loading_pill_shows: shows, loading_pill_long_shows: longShows };
  shows = longShows = 0;
  return taken;
}
