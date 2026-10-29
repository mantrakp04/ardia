import { Children, isValidElement, useContext, type ComponentProps } from "react";
import * as shared from "../../browser/src/components/settings/Form.tsx";
import { sectionUnavailable, setting, settingUnavailable } from "./settingsIndex.ts";

export * from "../../browser/src/components/settings/Form.tsx";

export function Group(props: ComponentProps<typeof shared.Group>) {
  if (settingUnavailable(props.of)) return null;
  const rows = Children.toArray(props.children).filter(
    (child) => !(isValidElement<{ anchor?: unknown }>(child) && typeof child.props.anchor === "string" && settingUnavailable(child.props.anchor)),
  );
  return rows.length ? <shared.Group {...props}>{rows}</shared.Group> : null;
}

export function Anchor(props: ComponentProps<typeof shared.Anchor>) {
  return settingUnavailable(props.id) ? null : <shared.Anchor {...props} />;
}

export function Row(props: ComponentProps<typeof shared.Row>) {
  return settingUnavailable(props.anchor) ? null : <shared.Row {...props} />;
}

export function SectionHeader(props: ComponentProps<typeof shared.SectionHeader>) {
  const pane = useContext(shared.SettingsPaneContext);
  const entry = props.anchor ? setting(props.anchor) : undefined;
  if (settingUnavailable(props.anchor) || sectionUnavailable(entry?.pane ?? pane, entry?.section ?? props.title)) return null;
  return <shared.SectionHeader {...props} />;
}
