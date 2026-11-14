import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { answerRequest, dismissPress, pressAction } from "../../state/page/actions";
import { usePageRequest, usePress } from "../../state/page/hooks";
import { confirmAnswer, pressHeading, pressMenuGroups, PRESS_TITLES, requestPlan, type PressAction, type Request, type RequestChoice } from "../../state/page/pagePrompts";
import { dialogLayout, Dialog, font, Menu, radius, space, Symbol, useTheme, type MenuItem, type SymbolName } from "../ui";

export function PageRequestHost({ tabId }: { tabId: string }) {
  const request = usePageRequest(tabId);
  if (!request) return null;
  return <RequestDialog key={request.id} tabId={tabId} request={request} />;
}

function RequestDialog({ tabId, request }: { tabId: string; request: Request }) {
  const theme = useTheme();
  const plan = requestPlan(request);
  const [text, setText] = useState(plan.kind === "dialog" ? plan.dialog.defaultText : "");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (plan.kind === "answer") answerRequest(tabId, request, plan.answer);
  }, []);
  if (plan.kind === "answer") return null;
  const dialog = plan.dialog;
  const dismiss = () => answerRequest(tabId, request, { type: "dismiss" });
  const confirm = () => answerRequest(tabId, request, confirmAnswer(request, text, user, password));
  const field = (value: string, onChange: (value: string) => void, label: string, secure = false) => (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder={label}
      placeholderTextColor={theme.foregroundTertiary}
      selectionColor={theme.formAccent}
      secureTextEntry={secure}
      autoCapitalize="none"
      autoCorrect={false}
      style={[font.body, styles.field, { color: theme.label, borderColor: theme.separator }]}
    />
  );
  if (dialog.choices.length) {
    return (
      <Dialog title={dialog.title} message={null} onDismiss={dismiss} buttons={[{ title: dialog.cancel ?? "Cancel", onPress: dismiss }]}>
        {dialog.choices.map((choice) => (
          <Pressable
            key={choice.title}
            accessibilityRole="button"
            onPress={() => answerRequest(tabId, request, choice.answer)}
            style={({ pressed }) => [styles.choice, pressed ? { backgroundColor: theme.rowHighlight } : null]}
          >
            <Symbol name={CHOICE_ICONS[choice.icon]} size={20} color={theme.formAccent} />
            <Text style={[font.body, { color: theme.formAccent }]}>{choice.title}</Text>
          </Pressable>
        ))}
      </Dialog>
    );
  }
  return (
    <Dialog
      title={dialog.title}
      message={dialog.message}
      onDismiss={dialog.cancel ? dismiss : confirm}
      buttons={[...(dialog.cancel ? [{ title: dialog.cancel, onPress: dismiss }] : []), { title: dialog.confirm, onPress: confirm }]}
    >
      {dialog.field === "text" ? field(text, setText, "Text") : null}
      {dialog.field === "credentials" ? (
        <>
          {field(user, setUser, "User Name")}
          {field(password, setPassword, "Password", true)}
        </>
      ) : null}
    </Dialog>
  );
}

const CHOICE_ICONS: Record<RequestChoice["icon"], SymbolName> = { camera: "camera", video: "video", folder: "folderFill" };

const PRESS_ICONS: Record<PressAction, SymbolName> = {
  openInNewTab: "plusSquareOnSquare",
  openInBackground: "squareOnSquare",
  copyLink: "link",
  share: "squareAndArrowUp",
  download: "arrowDownCircle",
  saveImage: "arrowDownCircle",
};

export function PressMenu({ width, height }: { width: number; height: number }) {
  const press = usePress();
  const insets = useSafeAreaInsets();
  if (!press) return null;
  const items: MenuItem[] = [{ heading: pressHeading(press.target) }];
  for (const group of pressMenuGroups(press.target)) {
    items.push("divider");
    for (const action of group) items.push({ label: PRESS_TITLES[action], icon: PRESS_ICONS[action], onPress: () => pressAction(press, action) });
  }
  const left = Math.min(Math.max(press.x, space.s), width - PRESS_MENU_WIDTH - space.s);
  const top = Math.min(Math.max(press.y + insets.top, insets.top + space.s), height - PRESS_MENU_HEIGHT);
  return <Menu items={items} place={{ left, top, width: PRESS_MENU_WIDTH }} onDismiss={dismissPress} />;
}

const PRESS_MENU_WIDTH = 280;
const PRESS_MENU_HEIGHT = 380;

const styles = StyleSheet.create({
  choice: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: dialogLayout.choiceHeight, paddingHorizontal: space.s, borderRadius: radius.row },
  field: { minHeight: dialogLayout.fieldHeight, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.row, paddingHorizontal: space.m },
});
