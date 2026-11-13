import type { ViewProps } from "react-native";

export type PageNavigationState = {
  url: string | null;
  title: string;
  progress: number;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type PageTone = { top: string | null; bottom: string | null };

export type PageToneInsets = { top: number; bottom: number };

export type PageViewProps = ViewProps & {
  pageId: string;
  initialUrl?: string;
  toneInsets?: PageToneInsets;
  onPageState?: (state: PageNavigationState) => void;
  onPageTone?: (tone: PageTone) => void;
};

export type PageViewHandle = {
  loadUrl(url: string): Promise<void>;
  goBack(): Promise<boolean>;
  goForward(): Promise<boolean>;
  reload(): Promise<void>;
  stopLoading(): Promise<void>;
};

export type PageEventPayload =
  | ({ name: "state" } & Omit<PageNavigationState, "url"> & { url?: string })
  | { name: "tone"; top?: string; bottom?: string };
