export type DownloadState = "downloading" | "finished" | "failed" | "cancelled";

export type Download = {
  id: string;
  url: string;
  filename: string;
  path: string;
  state: DownloadState;
  paused: boolean;
  dangerous?: boolean;
  received: number;
  total: number;
  speed: number;
  mimeType: string;
  profile?: string;
  offTheRecord?: boolean;
  staging?: string | null;
};

export type DownloadSettings = { folder: string; askWhereToSave: boolean; managed: boolean };
