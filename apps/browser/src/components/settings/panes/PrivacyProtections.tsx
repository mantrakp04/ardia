import { Text, View } from "react-native";
import { useState } from "react";
import { usePrivacySettings } from "../../../lib/privacySettings";
import { useTheme } from "../../../lib/theme";
import { useBrowser } from "../../../store/browser";
import { useProfiles } from "../../../store/hooks";
import { engineProfile } from "../../../store/model";
import { Button, Group, PopUp, Row, SectionHeader, Toggle } from "../controls";

export function PrivacyProtections() {
  const theme = useTheme();
  const profiles = useProfiles();
  const [selected, select] = useState(() => useBrowser.getState().settings.defaultProfileId);
  const { state, busy, error, set } = usePrivacySettings(engineProfile(selected));
  return <View>
    <SectionHeader title="Browsing privacy" description="These protections apply to Chromium pages in this profile. Open a site's controls for exceptions. Refresh open pages after changes." action={profiles.length > 1 ? <PopUp value={selected} options={profiles.map(p => ({ value: p.id, title: p.name }))} disabled={busy} onChange={select} /> : undefined} />
    <Group>
      <Row anchor="privacy.globalPrivacyControl" title="Global Privacy Control" description="Ask websites not to sell or share your personal data. This sends a preference; it does not itself block tracking.">
        <Toggle label="Global Privacy Control" value={!!state?.globalPrivacyControl} disabled={!state || busy || state.managed} onChange={v => void set("globalPrivacyControl", v)} />
      </Row>
      <Row anchor="privacy.cleanLinks" title="Clean navigation links" description="Clean known tracking tags when opening links. Known authentication, checkout and signed-link patterns, plus form submissions, are left alone. Site exceptions are available if a link fails.">
        <Toggle label="Clean navigation links" value={!!state?.cleanLinks} disabled={!state || busy} onChange={v => void set("cleanLinks", v)} />
      </Row>
      <Row anchor="privacy.cname" title="Uncloak DNS aliases" description={state && !state.cnameAvailable ? "Unavailable with this engine build." : "Check DNS aliases against blocking rules. Uses the browser's DNS and proxy settings, preserves filter exceptions, and leaves the main page alone."}>
        <Toggle label="Uncloak DNS aliases" value={!!state?.cname && !!state?.cnameAvailable} disabled={!state || busy || !state.cnameAvailable} onChange={v => void set("cname", v)} />
      </Row>
      <Row anchor="privacy.forgetSites" title="Forget selected sites after closing" description="Off unless you enable it in a site's controls. Clears its cookies and stored data after its last normal tab closes; this signs you out. Private tabs never trigger deletion in your normal profile." />
    </Group>
    {!!state?.managed && <Text style={{ color: theme.textSecondary, marginTop: 8 }}>Global Privacy Control is managed by your organization.</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: theme.textSecondary, marginTop: 8 }}>{error}</Text>}
    {state && ([['cleanExceptions', 'Links kept unchanged'], ['cnameExceptions', 'DNS alias exceptions'], ['forgetSites', 'Sites forgotten after closing']] as const).map(([key, title]) => state[key].length ? <View key={key}>
      <SectionHeader title={title} />
      <Group>{state[key].map(site => <Row key={site} title={site} description={state.forgetErrors[site] ? `Couldn't clear site data: ${state.forgetErrors[site]}` : key === "forgetSites" ? "Includes cookies shared by subdomains." : "Includes subdomains."}>
        <Button title={key === "forgetSites" ? "Keep Site Data" : "Remove Exception"} disabled={busy} onPress={() => void set(key, false, `https://${site}`)} />
      </Row>)}</Group>
    </View> : null)}
  </View>;
}
