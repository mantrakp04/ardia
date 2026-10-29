import { startBookmarks } from "../../browser/src/state/bookmarks/engineSync";
import { reloadHistory, startHistory } from "../../browser/src/state/history/engineSync";
import { startFavicons } from "../../browser/src/state/favicons/favicons";
import { startProfileDataCleanup } from "../../browser/src/state/profiles/profileData";
import { ardiaHost } from "./host";
import { watchHistoryImports } from "./hostHistoryImports";

export function startHostData() {
  const stops = [startFavicons(), startHistory(), startBookmarks(), startProfileDataCleanup()];
  if (ardiaHost) stops.push(watchHistoryImports(ardiaHost, reloadHistory));
  return () => { for (const stop of stops) stop(); };
}
