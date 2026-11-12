import { forgetAnimation, installFramePacing, noteAnimation } from "./motion";
import { aroundCentre } from "./pivot";

type Config = { useNativeDriver?: boolean; iterations?: number };
type Helper = { default: { shouldUseNativeDriver(config: Config): boolean } };
type AnimatedValue = { __makeNative(platformConfig?: unknown): void };
type NodeClass = { default: { prototype: AnimatedValue } };
type Running = {
  __active: boolean;
  __isLooping?: boolean | null;
  start(...args: unknown[]): void;
  __startAnimationIfNative(value: AnimatedValue): boolean;
  __notifyAnimationEnd(result: unknown): void;
};
type AnimationClass = { default: { prototype: Running } };
type StyleAttributes = { default: { transform: { process(transform: unknown): unknown } } };

const helper: Helper = require("react-native/src/private/animated/NativeAnimatedHelper");
const animatedValue: NodeClass = require("react-native/Libraries/Animated/nodes/AnimatedValue");
const animatedColor: NodeClass = require("react-native/Libraries/Animated/nodes/AnimatedColor");
const animation: AnimationClass = require("react-native/Libraries/Animated/animations/Animation");
const styleAttributes: StyleAttributes = require("react-native/Libraries/Components/View/ReactNativeStyleAttributes");

const repeatsNatively = (config: Config) => config.useNativeDriver === true && typeof config.iterations === "number";

export function installAnimation() {
  installFramePacing();

  helper.default.shouldUseNativeDriver = repeatsNatively;

  let startingNatively = false;
  for (const node of [animatedValue.default.prototype, animatedColor.default.prototype]) {
    const makeNative = node.__makeNative;
    node.__makeNative = function (this: AnimatedValue, platformConfig?: unknown) {
      if (startingNatively) makeNative.call(this, platformConfig);
    };
  }

  const running = animation.default.prototype;
  const startNatively = running.__startAnimationIfNative;
  running.__startAnimationIfNative = function (this: Running, target: AnimatedValue) {
    startingNatively = true;
    try {
      const native = startNatively.call(this, target);
      if (native) forgetAnimation(this);
      return native;
    } finally {
      startingNatively = false;
    }
  };
  const notifyEnd = running.__notifyAnimationEnd;
  running.__notifyAnimationEnd = function (this: Running, result: unknown) {
    forgetAnimation(this);
    notifyEnd.call(this, result);
  };
  const start = running.start;
  running.start = function (this: Running, ...args: unknown[]) {
    start.apply(this, args);
    if (this.__isLooping !== true) noteAnimation(this);
  };

  const process = styleAttributes.default.transform.process;
  styleAttributes.default.transform = { process: (transform) => aroundCentre(process(transform)) };
}
