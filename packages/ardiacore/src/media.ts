export type DeviceChooser = {
  id: number;
  tabId: string | null;
  open: boolean;
  title: string;
  okLabel: string;
  cancelLabel: string;
  noOptionsText: string;
  scanningText: string;
  refreshing: boolean;
  canRefresh: boolean;
  adapterOff: boolean;
  unauthorized: boolean;
  bothButtonsEnabled: boolean;
  showSignal: boolean;
  options: { name: string; connected: boolean; paired: boolean; signal: number }[];
};

export const CastMode = { presentation: 1, tab: 2, screen: 4, remotePlayback: 8 } as const;

export type CastSink = {
  id: string;
  name: string;
  status: string;
  state: "available" | "connecting" | "connected" | "disconnecting" | "unavailable";
  icon: number;
  modes: number;
  routeId: string;
  issue: string;
};

export type CastDialog = {
  id: number;
  tabId: string | null;
  open: boolean;
  header: string;
  permissionRejected: boolean;
  castingStarted: boolean;
  sinks: CastSink[];
};

export type CastRoute = { id: string; sink: string; description: string; source: string };
