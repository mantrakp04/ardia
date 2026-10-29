import type { ComponentProps } from "react";
import { ConnectionChip as SharedChip, ConnectionRow as SharedRow } from "../../browser/src/components/site/SiteConnection";
import { FooterChip } from "../../browser/src/components/site/SiteControlsParts";
import { MenuRow } from "../../browser/src/components/ui";

export { CertificateDetails } from "../../browser/src/components/site/SiteConnection";

export function ConnectionChip(props: ComponentProps<typeof SharedChip>) {
  if (props.security && props.security.level !== "none") return <SharedChip {...props} />;
  return <FooterChip icon="info.circle" title="Connection information unavailable" open={props.open} onPress={props.onPress} />;
}

export function ConnectionRow(props: ComponentProps<typeof SharedRow>) {
  if (props.security && props.security.level !== "none") return <SharedRow {...props} />;
  return <MenuRow icon="info.circle" title="Connection information unavailable" />;
}
