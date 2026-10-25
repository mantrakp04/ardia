import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

type Props = {
  host: string;
  domain: string;
  textStyle: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function HostLabel({ host, domain, textStyle, style, accessibilityLabel }: Props) {
  const subdomain = domain && host.length > domain.length && host.endsWith(domain) ? host.slice(0, host.length - domain.length) : "";
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? host} style={[{ flexDirection: "row", flexShrink: 1, maxWidth: "100%" }, style]}>
      {subdomain ? (
        <Text numberOfLines={1} ellipsizeMode="head" style={[textStyle, { flexShrink: 1 }]}>
          {subdomain}
        </Text>
      ) : null}
      <Text numberOfLines={1} style={[textStyle, { flexShrink: 0, maxWidth: "100%" }]}>
        {subdomain ? domain : host}
      </Text>
    </View>
  );
}
