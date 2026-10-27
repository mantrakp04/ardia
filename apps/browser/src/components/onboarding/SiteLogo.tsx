import { Image } from "react-native";
import { radius, useTheme } from "../ui";
import { Favicon } from "../favicon/Favicon";
import { bundledSiteIcon } from "../favicon/siteIcons";

export function SiteLogo({ url, size }: { url: string; size: number }) {
  const theme = useTheme();
  const bundled = bundledSiteIcon(url, theme.dark);
  if (bundled === undefined) return <Favicon url={url} size={size} />;
  return <Image source={bundled} style={{ width: size, height: size, borderRadius: size > 18 ? radius.s : radius.xs }} />;
}
