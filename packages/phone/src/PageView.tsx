import { requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef, type Ref } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { normalizeState } from "./normalize";
import { pages } from "./pages";
import type { PageEventPayload, PageViewHandle, PageViewProps } from "./pageTypes";

type NativeHandle = PageViewHandle;

type NativeProps = ViewProps & {
  ref?: Ref<NativeHandle>;
  pageId: string;
  initialUrl?: string;
  title?: string;
  isPrivate?: boolean;
  savedState?: string;
  toneInsets?: [number, number];
  onPageEvent?: (event: NativeSyntheticEvent<PageEventPayload>) => void;
};

const NativePageView = requireNativeViewManager<NativeProps>("ArdiaPageView");

export const closePage = (pageId: string) => pages.close(pageId);

export const PageView = forwardRef<PageViewHandle, PageViewProps>(function PageView(props, ref) {
  const { onPageState, onPageTone, onPageError, toneInsets, ...rest } = props;
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
      onPageState?.(normalizeState(state, props.isPrivate ?? false));
    } else if (nativeEvent.name === "tone") {
      onPageTone?.({ top: nativeEvent.top ?? null, bottom: nativeEvent.bottom ?? null });
    } else {
      onPageError?.({ code: nativeEvent.code, message: nativeEvent.message });
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
