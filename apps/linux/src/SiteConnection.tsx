import type { ComponentProps } from "react";
import { ConnectionChip as SharedChip, ConnectionRow as SharedRow } from "../../browser/src/components/site/SiteConnection";
import { ChipButton } from "../../browser/src/components/site/SiteControlsParts";
import { MenuRow } from "../../browser/src/components/ui";

export { CertificateDetails } from "../../browser/src/components/site/SiteConnection";

export function ConnectionChip(props: ComponentProps<typeof SharedChip>) {
  if (props.security && props.security.level !== "none") return <SharedChip {...props} />;
  return <ChipButton icon="info.circle" title="Connection information unavailable" open={props.open} onPress={props.onPress} tooltip={props.open ? "Hide Connection Details" : "Connection Details"} />;
}

export function ConnectionRow(props: ComponentProps<typeof SharedRow>) {
  if (props.security && props.security.level !== "none") return <SharedRow {...props} />;
  return <MenuRow icon="info.circle" title="Connection information unavailable" />;
}
