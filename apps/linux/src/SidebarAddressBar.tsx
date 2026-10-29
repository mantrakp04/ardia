import { SidebarHeaderTools as NavigationTools } from "../../browser/src/components/sidebar/AddressBar";
import { ProfileIndicator } from "./ProfileIndicator";

export { SidebarAddressRow } from "../../browser/src/components/sidebar/AddressBar";

export function SidebarHeaderTools({ width }: { width: number }) {
  const navigationWidth = Math.max(114, width - 136);
  return (
    <>
      <NavigationTools width={navigationWidth} />
      <div style={{ position: "absolute", left: navigationWidth + 2, top: 7 }}>
        <ProfileIndicator room={Math.max(36, width - navigationWidth - 9)} />
      </div>
    </>
  );
}
