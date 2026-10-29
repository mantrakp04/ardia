import { AppRegistry, Text, View } from "react-native";
import { answerWithSkew, openSkewWindow } from "../../state/app/nativeApiSkew";
import { DEV_ERROR } from "./tokens";

export function startSkewed(message: string) {
  console.error(`[ardia] ${message}`);
  AppRegistry.registerComponent("main", () => () => (
    <View style={{ flex: 1, backgroundColor: DEV_ERROR.background, padding: 24, paddingTop: 48 }}>
      <Text selectable style={{ color: DEV_ERROR.text, fontSize: DEV_ERROR.fontSize, fontFamily: DEV_ERROR.fontFamily }}>
        {message}
      </Text>
    </View>
  ));
  openSkewWindow();
  if (__DEV__) answerWithSkew(message);
}
