import { setBoostEnabled } from "../../state/boosts/actions";
import { useSiteBoosts } from "../../state/boosts/hooks";
import { editBoostForTab, showBoostMenu } from "../../state/boostUi/actions";
import { Button, MenuRow, Toggle } from "../ui";
import { SectionTitle } from "./SiteControlsParts";

export function SiteBoosts({ windowId, tabId, profileId, host, onClose }: { windowId: string; tabId: string; profileId: string; host: string; onClose: () => void }) {
  const boosts = useSiteBoosts(profileId, host);
  if (!boosts.length) return null;
  return (
    <>
      <SectionTitle title="Boosts" />
      {boosts.map((boost) => (
        <MenuRow
          key={boost.id}
          icon="paintbrush"
          title={boost.name}
          detail={boost.enabled ? undefined : "Off"}
          onPress={() => {
            onClose();
            editBoostForTab(windowId, tabId, boost.id);
          }}
          accessory={
            <>
              <Button variant="icon" icon="ellipsis" size={12} box={24} tooltip="Boost Options" onPress={() => void showBoostMenu(profileId, boost, windowId)} />
              <Toggle look="panel" value={boost.enabled} onChange={(on) => setBoostEnabled(profileId, boost.id, on)} />
            </>
          }
        />
      ))}
    </>
  );
}
