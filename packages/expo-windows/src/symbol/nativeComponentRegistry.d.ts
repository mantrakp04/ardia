declare module "react-native/Libraries/NativeComponent/NativeComponentRegistry" {
  import type { HostComponent } from "react-native";

  type AttributeConfiguration = true | { process?: (value: never) => unknown; diff?: (previous: never, next: never) => boolean };

  export type PartialViewConfig = {
    uiViewClassName: string;
    validAttributes?: Record<string, AttributeConfiguration>;
    bubblingEventTypes?: Record<string, unknown>;
    directEventTypes?: Record<string, unknown>;
  };

  export function get<Config extends object>(name: string, viewConfigProvider: () => PartialViewConfig): HostComponent<Config>;
}
