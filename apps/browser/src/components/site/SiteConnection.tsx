import type { PageState } from "../../state/tabs/pageState";
import { useTheme, type Theme } from "../ui/theme";
import { Box, MenuRow, PANEL, Text } from "../ui";
import { FooterChip } from "./SiteControlsParts";
import { connectionColor, useSiteTokens } from "./tokens";

type Security = PageState["security"];

function connectionLook(security: Security, theme: Theme) {
  const level = security?.level ?? "none";
  if (level === "secure") return { level, chip: "Secure", icon: "lock.fill", color: undefined };
  if (level === "local" || level === "none") return { level, chip: "Local Page", icon: "info.circle", color: undefined };
  if (level === "mixed") return { level, chip: "Not Fully Secure", icon: "lock.open.trianglebadge.exclamationmark.fill", color: connectionColor.caution };
  return { level, chip: "Not Secure", icon: "lock.open.trianglebadge.exclamationmark.fill", color: theme.destructive };
}

export function ConnectionChip({ security, open, onPress }: { security: Security; open: boolean; onPress: () => void }) {
  const look = connectionLook(security, useTheme());
  return <FooterChip icon={look.icon} title={look.chip} color={look.color} open={open} onPress={onPress} />;
}

export function ConnectionRow({ security }: { security: Security }) {
  const theme = useTheme();
  const look = connectionLook(security, theme);
  const { level } = look;
  const secure = level === "secure";
  const local = level === "local" || level === "none";
  const title = secure ? "Connection is secure" : local ? "This is a local or internal page" : "Connection is not secure";
  const detail =
    level === "certificateError"
      ? "The site's certificate isn't valid. Don't enter passwords or payment details."
      : level === "mixed"
        ? "Parts of this page aren't secure (such as images)."
        : level === "insecure"
          ? "Don't enter sensitive information on this site."
          : secure && security?.certificate
            ? `Certificate issued by ${security.certificate.issuer.organizations[0] || security.certificate.issuer.commonName}`
            : undefined;
  return <MenuRow icon={look.icon} iconColor={look.color ?? theme.icon} title={title} detail={detail} />;
}

const CERTIFICATE_KEY_WIDTH = 82;

export function CertificateDetails({ security }: { security: NonNullable<Security> }) {
  const site = useSiteTokens();
  const cert = security.certificate!;
  const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const rows: [string, string][] = [
    ["Issued to", cert.subject.commonName || cert.subject.displayName],
    ["Organization", cert.subject.organizations.join(", ") || "—"],
    ["Issued by", cert.issuer.commonName || cert.issuer.displayName],
    ["Valid from", date(cert.validFrom)],
    ["Expires", date(cert.validUntil)],
    ...(security.protocol ? [["Protocol", security.protocol] as [string, string]] : []),
    ...(cert.sha256 ? [["SHA-256", cert.sha256.replace(/[^0-9a-f]/gi, "").replace(/(.{2})(?!$)/g, "$1 ").slice(0, 47) + "…"] as [string, string]] : []),
  ];
  return (
    <Box radius="l" style={{ marginHorizontal: PANEL.inset, marginTop: 2, marginBottom: 4, padding: PANEL.rowPadding, backgroundColor: site.certificateWell, gap: 3 }}>
      {rows.map(([k, v]) => (
        <Box key={k} row gap="m">
          <Text size="caption" tone="textSecondary" style={{ width: CERTIFICATE_KEY_WIDTH }}>
            {k}
          </Text>
          <Text size="caption" lines={2} selectable style={{ flex: 1 }}>
            {v}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
