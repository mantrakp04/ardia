import { setSiteSetting } from "../../state/site/siteSettings";
import { answerExternalApp } from "../../state/site/prompts";
import {
  type AutofillPromptAnswer,
  type PasswordPromptAnswer,
  patchPage,
  pageOf,
  setPopover,
  usePage,
} from "../../state/tabs/pageState";
import { useState } from "react";
import { Image, Pressable, View } from "react-native";
import { useTheme } from "../ui/theme";
import { webviews } from "../../state/tabs/webviewHandles";
import { currentEngineProfile, currentTab } from "../../state/browser/current";
import { Button, MenuRow, MenuSeparator, PANEL, PanelCloseButton, Popover, Symbol, Text, useHover } from "../ui";
import { answerPermission, describePermission } from "../../state/site/permissions";
import { hostOrOrigin } from "../../lib/url";
import { CheckRow, IconTile, usePromptInputGuard } from "./PromptParts";
import { useSiteTokens } from "./tokens";

export function PromptBody({
  icons,
  image,
  title,
  message,
  detail,
  children,
}: {
  icons: string[];
  image?: string | null;
  title: string;
  message?: string | null;
  detail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ padding: PANEL.inset, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {image ? <Image source={{ uri: image }} style={{ width: 32, height: 32, marginLeft: -1, marginVertical: -1 }} /> : null}
        {icons.map((icon) => (
          <IconTile key={icon} icon={icon} />
        ))}
      </View>
      <View style={{ gap: 3 }}>
        <Text weight="semibold">{title}</Text>
        {message ? (
          <Text size="small" tone="textSecondary">
            {message}
          </Text>
        ) : null}
      </View>
      {detail}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>{children}</View>
    </View>
  );
}

export const PERMISSION_PROMPT_WIDTH = 300;
export const EXTERNAL_APP_WIDTH = 340;

export function PermissionPrompt({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const request = usePage(tabId, (p) => p.permission);
  const guard = usePromptInputGuard(request?.id);
  if (!request) return null;
  const { icons, question } = describePermission(request);
  return (
    <Popover key={request.id} width={PERMISSION_PROMPT_WIDTH} top={top} left={left} modal={false}>
      <View>
        <PromptBody icons={icons} title={question} message="Click the lock to change this any time">
          <Button variant="pill" title="Don't Allow" onPress={guard(() => answerPermission(tabId, request.id, "deny"))} />
          <Button variant="pill" title="Allow" primary onPress={guard(() => answerPermission(tabId, request.id, "accept"))} />
        </PromptBody>
        <PanelCloseButton onPress={guard(() => answerPermission(tabId, request.id, "dismiss"))} />
      </View>
    </Popover>
  );
}

export const BLOCKED_POPUPS_WIDTH = 360;

export function BlockedPopupsPrompt({ tabId, right, left, top }: { tabId: string; right?: number; left?: number; top: number }) {
  const popups = usePage(tabId, (p) => p.popups);
  if (!popups.length) return null;
  const origin = popups[0]!.origin;
  const site = hostOrOrigin(origin);
  const web = () => webviews.get(tabId);
  const close = () => setPopover(tabId, null);
  const done = () => {
    patchPage(tabId, { popups: [] });
    close();
  };
  const profile = () => currentEngineProfile(currentTab(tabId)?.profileId ?? "");
  return (
    <Popover width={BLOCKED_POPUPS_WIDTH} top={top} right={right} left={left} onDismiss={close}>
      <View style={{ paddingBottom: PANEL.listPadding }}>
        <PromptBody
          icons={["macwindow.badge.plus"]}
          title={`Always allow pop-ups from ${site}?`}
          message={`Allow ${site} to always open pop-up windows, choose every time, or always deny pop-ups.`}
        >
          <Button variant="pill"
            title="Always Deny"
            onPress={() => {
              void setSiteSetting(profile(), origin, "popups", "block");
              done();
            }}
          />
          <Button variant="pill"
            title="Only Once"
            onPress={() => {
              for (const p of popups) void web()?.openBlockedPopup(p.id, false);
              done();
            }}
          />
          <Button variant="pill"
            title="Always Allow"
            primary
            onPress={() => {
              for (const p of popups) void web()?.openBlockedPopup(p.id, true);
              done();
            }}
          />
        </PromptBody>
        <MenuSeparator />
        {popups.slice(-5).map((p) => (
          <MenuRow
            key={p.id}
            icon="arrow.up.forward.app"
            title={p.url.replace(/^https?:\/\//, "") || "about:blank"}
            onPress={() => {
              void web()?.openBlockedPopup(p.id, false);
              const rest = pageOf(tabId).popups.filter((x) => x.id !== p.id);
              patchPage(tabId, { popups: rest });
              if (!rest.length) close();
            }}
          />
        ))}
        {popups.length > 5 ? (
          <Text size="caption" tone="textSecondary" style={{ paddingLeft: PANEL.textColumn, paddingTop: 2 }}>{`and ${popups.length - 5} more`}</Text>
        ) : null}
      </View>
    </Popover>
  );
}

export function PasswordPrompt({ tabId, right, top }: { tabId: string; right: number; top: number }) {
  const { well } = useSiteTokens();
  const prompt = usePage(tabId, (p) => p.passwordPrompt);
  const [chosen, setChosen] = useState<string | null>(null);
  const guard = usePromptInputGuard(prompt ? `${prompt.origin}|${prompt.username}|${prompt.state}` : null);
  if (!prompt) return null;
  const site = hostOrOrigin(prompt.origin);
  const update = prompt.state === "update";
  const username = chosen ?? prompt.username;
  const answer = guard((action: PasswordPromptAnswer) => {
    void webviews.get(tabId)?.resolvePasswordPrompt(action, action === "save" || action === "update" ? { username } : undefined);
    setChosen(null);
    patchPage(tabId, { passwordPrompt: null });
  });
  const choices = update && prompt.usernames.length > 1 ? prompt.usernames : [];
  return (
    <Popover key={`${prompt.origin}|${prompt.username}|${prompt.state}`} width={update ? 310 : 350} top={top} right={right} modal={false}>
      <View>
        <PromptBody
          icons={["key.fill"]}
          title={update ? "Update saved password?" : `Save password for ${site}?`}
          message={update ? `It will be auto-filled on ${site}` : "That way, it'll be auto-filled next time"}
          detail={
            choices.length ? (
              <View style={{ borderRadius: 8, paddingVertical: 3, backgroundColor: well }}>
                {choices.map((name) => (
                  <UsernameChoice key={name} name={name} selected={name === username} onPress={() => setChosen(name)} />
                ))}
              </View>
            ) : (
              <View style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 3, backgroundColor: well }}>
                <Text lines={1} size="small" weight="medium">
                  {username || (prompt.federation ? `Signed in with ${hostOrOrigin(prompt.federation)}` : "No username")}
                </Text>
                {prompt.passwordLength > 0 && (
                  <Text lines={1} size="small" tone="textSecondary" style={{ letterSpacing: 1 }}>
                    {"•".repeat(Math.min(prompt.passwordLength, 16))}
                  </Text>
                )}
              </View>
            )
          }
        >
          {!update && <Button variant="pill" title="Never on This Site" onPress={() => answer("never")} />}
          <Button variant="pill" title="Not Now" onPress={() => answer(update ? "nope" : "dismiss")} />
          <Button variant="pill" title={update ? "Update" : "Save"} primary onPress={() => answer(update ? "update" : "save")} />
        </PromptBody>
        <PanelCloseButton onPress={() => answer("dismiss")} />
      </View>
    </Popover>
  );
}

export function AutofillPrompt({ tabId, right, top }: { tabId: string; right: number; top: number }) {
  const { well } = useSiteTokens();
  const prompt = usePage(tabId, (p) => p.autofillPrompt);
  const guard = usePromptInputGuard(prompt?.id);
  if (!prompt) return null;
  const answer = guard((action: AutofillPromptAnswer) => {
    void webviews.get(tabId)?.resolveAutofillPrompt(prompt.id, action);
    patchPage(tabId, { autofillPrompt: null });
  });
  const changes = prompt.changes ?? [];
  const values = (key: "to" | "from") => changes.filter((c) => c[key]).map((c) => c[key]);
  const section = (lines: string[], label?: string) => (
    <View key={label ?? "lines"} style={{ gap: 3 }}>
      {label ? (
        <Text size="caption" tone="textSecondary">
          {label}
        </Text>
      ) : null}
      {lines.map((line, i) => (
        <Text key={i} lines={2} size="small" weight={i === 0 && !label ? "medium" : "regular"} tone={i === 0 || label ? "textPrimary" : "textSecondary"}>
          {line}
        </Text>
      ))}
    </View>
  );
  const sections =
    prompt.kind !== "updateAddress"
      ? [section(prompt.lines)]
      : prompt.newLabel
        ? [section(values("to"), prompt.newLabel), section(values("from"), prompt.oldLabel)]
        : [section(values("to"))];
  return (
    <Popover key={prompt.id} width={350} top={top} right={right} modal={false}>
      <View>
        <PromptBody
          icons={[prompt.kind === "saveCard" ? "creditcard.fill" : "mappin.and.ellipse"]}
          title={prompt.title}
          message={prompt.message || null}
          detail={
            <>
              <View style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 8, backgroundColor: well }}>{sections}</View>
              {prompt.footer ? (
                <Text size="caption" tone="textSecondary">
                  {prompt.footer}
                </Text>
              ) : null}
            </>
          }
        >
          <Button variant="pill" title={prompt.decline} onPress={() => answer("decline")} />
          <Button variant="pill" title={prompt.accept} primary onPress={() => answer("accept")} />
        </PromptBody>
        <PanelCloseButton onPress={() => answer("dismiss")} />
      </View>
    </Popover>
  );
}

export function ExternalAppPrompt({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const request = usePage(tabId, (p) => p.externalApp);
  const [always, setAlways] = useState(false);
  const guard = usePromptInputGuard(request?.id);
  if (!request) return null;
  const answer = guard((open: boolean) => {
    answerExternalApp(tabId, open, open && always);
    setAlways(false);
  });
  return (
    <Popover key={request.id} width={EXTERNAL_APP_WIDTH} top={top} left={left} modal={false}>
      <View>
        <PromptBody
          icons={request.icon ? [] : [request.app ? "app" : "questionmark.app.dashed"]}
          image={request.icon}
          title={request.title}
          message={request.message}
          detail={
            request.remember ? <CheckRow value={always} onChange={guard(setAlways)} label={request.remember} /> : undefined
          }
        >
          {request.app ? (
            <>
              <Button variant="pill" title="Cancel" onPress={() => answer(false)} />
              <Button variant="pill" title="Open" primary onPress={() => answer(true)} />
            </>
          ) : (
            <Button variant="pill" title="OK" primary onPress={() => answer(false)} />
          )}
        </PromptBody>
        <PanelCloseButton onPress={() => answer(false)} />
      </View>
    </Popover>
  );
}

function UsernameChoice({ name, selected, onPress }: { name: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View style={{ height: 28, marginHorizontal: 3, paddingHorizontal: 7, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: hovered ? theme.rowHover : undefined }}>
          {selected ? (
            <Symbol name="checkmark" size={10} weight="semibold" color={theme.textPrimary} style={{ width: 14, height: 14 }} />
          ) : (
            <View style={{ width: 14, height: 14 }} />
          )}
          <Text lines={1} size="small" style={{ flex: 1 }}>
            {name || "No username"}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
