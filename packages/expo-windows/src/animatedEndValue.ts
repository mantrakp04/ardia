type EndResult = { finished: boolean; value?: number; offset?: number };
type Config = { toValue?: unknown };
type End = (result: EndResult) => void;
type Api = { startAnimatingNode(animationId: number, nodeTag: number, config: Config, end?: End): void };

const helper: { default: { API: Api } } = require("react-native/src/private/animated/NativeAnimatedHelper");

const landed = (config: Config, result: EndResult): EndResult =>
  result.finished && result.value == null && typeof config.toValue === "number" ? { ...result, value: config.toValue } : result;

export function installAnimatedEndValue() {
  const api = helper.default.API;
  const start = api.startAnimatingNode;
  api.startAnimatingNode = (animationId, nodeTag, config, end) => start(animationId, nodeTag, config, end && ((result) => end(landed(config, result))));
}
