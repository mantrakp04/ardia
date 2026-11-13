import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef, type Ref } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import type { PageEventPayload, PageViewHandle, PageViewProps } from "./pageTypes";

type NativeHandle = PageViewHandle;

type NativeProps = ViewProps & {
  ref?: Ref<NativeHandle>;
  pageId: string;
  initialUrl?: string;
  toneInsets?: [number, number];
  onPageEvent?: (event: NativeSyntheticEvent<PageEventPayload>) => void;
};

const NativePageView = requireNativeViewManager<NativeProps>("ArdiaPageView");

type PageViewModule = { closePage(pageId: string): Promise<void> };

let pageViewModule: PageViewModule | undefined;
const nativeModule = () => (pageViewModule ??= requireNativeModule<PageViewModule>("ArdiaPageView"));

export const closePage = (pageId: string) => nativeModule().closePage(pageId);

export const PageView = forwardRef<PageViewHandle, PageViewProps>(function PageView(props, ref) {
  const { onPageState, onPageTone, toneInsets, ...rest } = props;
  const native = useRef<NativeHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      loadUrl: async (url) => native.current?.loadUrl(url),
      goBack: async () => (await native.current?.goBack()) ?? false,
      goForward: async () => (await native.current?.goForward()) ?? false,
      reload: async () => native.current?.reload(),
      stopLoading: async () => native.current?.stopLoading(),
    }),
    [],
  );
  const onPageEvent = ({ nativeEvent }: NativeSyntheticEvent<PageEventPayload>) => {
    if (nativeEvent.name === "state") {
      const { name, ...state } = nativeEvent;
      onPageState?.({ ...state, url: state.url ?? null });
    } else {
      onPageTone?.({ top: nativeEvent.top ?? null, bottom: nativeEvent.bottom ?? null });
    }
  };
  return (
    <NativePageView
      {...rest}
      ref={native}
      toneInsets={toneInsets ? [toneInsets.top, toneInsets.bottom] : undefined}
      onPageEvent={onPageEvent}
    />
  );
});
