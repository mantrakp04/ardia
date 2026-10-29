import { deleteLiveFolder, manualRefresh, newProfileLiveFolder, statusText } from "../../browser/src/state/live/engine";
import { connectGoogleDrive } from "../../browser/src/state/live/googleAuth";
import { useLive } from "../../browser/src/state/live/store";
import { connectBitbucket, connectConfluence, connectGithub, connectNotion, disconnect, startGithubDeviceFlow } from "./liveSources.ts";

export const linuxLiveHooks = {
  store: useLive,
  newFolder: newProfileLiveFolder,
  refresh: manualRefresh,
  deleteFolder: deleteLiveFolder,
  statusText,
  connectGithub,
  startGithubDeviceFlow,
  connectBitbucket,
  connectNotion,
  connectConfluence,
  connectGoogleDrive,
  disconnect,
};
