import { View } from "react-native";
import { plural } from "../../../state/browser/model";
import { Button, space, Text } from "../../ui";
import { APP } from "../model";
import { Spacer, TargetPicker, Title } from "../Parts";
import { Monogram, ProfileAvatar, SelectRow, SpaceIcon } from "../Rows";
import type { ImportFlow } from "../useImportFlow";

const toggled = (id: string) => (v: boolean) => (prev: string[]) => (v ? [...prev, id] : prev.filter((x) => x !== id));

export function ProfilesBody({ flow }: { flow: ImportFlow }) {
  const { source, bySpaces, allSpaces, spaceless, spaces, sourceProfiles } = flow;
  if (!source) return null;
  if (bySpaces)
    return (
      <>
        <Title title="Select spaces to import" subtitle={`We'll import your ${source.name} spaces, tabs, and folders to ${APP}.`} />
        <Text size="small" tone="textSecondary" style={{ marginBottom: space.ml }}>{`Customize which spaces to bring over to ${APP}. Each space becomes a profile, and the spaces of one ${source.name} profile share its logins, cookies, extensions and history, as in ${source.name}.`}</Text>
        <View style={{ gap: space.s }}>
          {allSpaces.map((s) => (
            <SelectRow
              key={s.id}
              selected={spaces.includes(s.id)}
              onToggle={(v) => flow.setSpaces(toggled(s.id)(v))}
              icon={<SpaceIcon space={s} />}
              title={s.name || "Space"}
              subtitle={`${plural(s.pinnedCount, "pinned tab")} · ${plural(s.tabCount, "tab")}`}
            />
          ))}
          {source.sidebar !== "zen"
            ? null
            : spaceless.map((p) => (
                <SelectRow
                  key={p.id}
                  selected={sourceProfiles.includes(p.id)}
                  onToggle={(v) => flow.setSourceProfiles(toggled(p.id)(v))}
                  icon={<Monogram name={p.name} color={p.color} />}
                  title={p.name}
                  subtitle={p.isDefault ? "Default profile" : undefined}
                />
              ))}
        </View>
      </>
    );
  return (
    <>
      <Title title="Unlock your data for import" subtitle="Select the profiles you want to import." />
      <Text size="small" tone="textSecondary" style={{ marginBottom: space.ml }}>{`Customize which profiles to bring over to ${APP}. The first goes into your selected profile; the others become new profiles.`}</Text>
      <View style={{ gap: space.s }}>
        {source.profiles.map((p) => (
          <SelectRow
            key={p.id}
            selected={sourceProfiles.includes(p.id)}
            onToggle={(v) => flow.setSourceProfiles(toggled(p.id)(v))}
            icon={<ProfileAvatar path={p.avatarPath} name={p.name} color={p.color} />}
            title={p.name}
            subtitle={p.email ?? (p.isDefault ? "Default profile" : undefined)}
          />
        ))}
      </View>
    </>
  );
}

export function ProfilesFooter({ flow }: { flow: ImportFlow }) {
  const { source, bySpaces, spaces, spaceless, sourceProfiles } = flow;
  if (!source) return null;
  return (
    <>
      <Button title="Back" onPress={() => flow.setStep("choose")} />
      <Spacer />
      <TargetPicker target={flow.target} onChange={flow.setTarget} />
      <Button
        title="Continue"
        kind="primary"
        disabled={bySpaces ? !spaces.length && (source.sidebar !== "zen" || !spaceless.some((p) => sourceProfiles.includes(p.id))) : !sourceProfiles.length}
        onPress={flow.next}
      />
    </>
  );
}
