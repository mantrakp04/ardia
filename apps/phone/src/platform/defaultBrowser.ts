export type DefaultBrowserStatus = { isDefault: boolean; canAsk: boolean };

export type DefaultBrowserModule = {
  status(): Promise<DefaultBrowserStatus>;
  requestRole(): Promise<boolean>;
  openDefaultAppsSettings(): Promise<void>;
};
