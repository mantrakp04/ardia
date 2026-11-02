import { useEffect, useMemo } from "react";
import { setBoostEnabled } from "../../../state/boosts/actions";
import { hideImportBoost, useImportBoostSheet } from "../../../state/boosts/importSheet";
import { useProfileBoosts } from "../../../state/boosts/hooks";
import type { Boost } from "../../../state/boosts/types";
import { boostChanges } from "../../../state/boostUi/describe";
import { deleteBoostAfterConfirm } from "../../../state/boostUi/actions";
import { showSettingsSheet } from "../../../state/settings/sheet";
import { SETTINGS_WINDOW_ID } from "../../../state/settings/settingsWindows";
import { Button, Symbol, Toggle, useTheme } from "../../ui";
import { ImportBoostSheet } from "../../boosts/ImportBoostSheet";
import { Group, ProfilePicker, Row, SectionHeader, useSettingsProfile } from "../Form";

function bySite(boosts: Boost[]): [string, Boost[]][] {
  const sites = new Map<string, Boost[]>();
  for (const boost of [...boosts].sort((a, b) => a.name.localeCompare(b.name))) sites.set(boost.domain, [...(sites.get(boost.domain) ?? []), boost]);
  return [...sites].sort(([a], [b]) => a.localeCompare(b));
}

export function BoostsPane({ profileId: chosen }: { profileId: string | null }) {
  const theme = useTheme();
  const [profileId, setProfileId] = useSettingsProfile(chosen);
  const boosts = useProfileBoosts(profileId);
  const sites = useMemo(() => bySite(boosts), [boosts]);
  const pendingCode = useImportBoostSheet((s) => s.code);
  useEffect(() => {
    if (pendingCode === null) return;
    showSettingsSheet(<ImportBoostSheet profileId={profileId} initialCode={pendingCode} />);
    hideImportBoost();
  }, [pendingCode, profileId]);
  return (
    <>
      <SectionHeader anchor="boosts.list" action={<ProfilePicker value={profileId} onChange={setProfileId} />} />
      {sites.length ? (
        sites.map(([domain, list]) => (
          <Group key={domain}>
            <Row icon={<Symbol name="globe" size={13} color={theme.icon} style={{ width: 20, height: 20 }} />} title={domain} />
            {list.map((boost) => (
              <Row key={boost.id} title={boost.name} description={boostChanges(boost).join(" · ") || "No changes yet"}>
                <Button title="Delete…" kind="plain" onPress={() => void deleteBoostAfterConfirm(profileId, boost, SETTINGS_WINDOW_ID)} />
                <Toggle value={boost.enabled} onChange={(on) => setBoostEnabled(profileId, boost.id, on)} />
              </Row>
            ))}
          </Group>
        ))
      ) : (
        <Group>
          <Row title="No Boosts yet" description="Open Site Controls on any page and choose New Boost." />
        </Group>
      )}
      <SectionHeader anchor="boosts.import" />
      <Group>
        <Row anchor="boosts.import">
          <Button title="Import Boost…" onPress={() => showSettingsSheet(<ImportBoostSheet profileId={profileId} />)} />
        </Row>
      </Group>
    </>
  );
}
