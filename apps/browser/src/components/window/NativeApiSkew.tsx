import { AppRegistry, Text, View } from "react-native";
import { answerWithSkew, openSkewWindow } from "../../state/app/nativeApiSkew";
import { space } from "../ui/tokens";
import { DEV_ERROR, NATIVE_SKEW_PAD_TOP } from "./tokens";

export function startSkewed(message: string) {
  console.error(`[ardia] ${message}`);
  AppRegistry.registerComponent("main", () => () => (
    <View style={{ flex: 1, backgroundColor: DEV_ERROR.background, padding: space.xxxl, paddingTop: NATIVE_SKEW_PAD_TOP }}>
      <Text selectable style={{ color: DEV_ERROR.text, fontSize: DEV_ERROR.fontSize, fontFamily: DEV_ERROR.fontFamily }}>
        {message}
      </Text>
    </View>
  ));
  openSkewWindow();
  if (__DEV__) answerWithSkew(message);
}
