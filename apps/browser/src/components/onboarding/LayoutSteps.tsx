import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import { durationTitle } from "../../lib/time";
import { DEFAULT_SETTINGS, type PeekModifier, type Settings } from "../../state/settings/settings";
import { ChoiceList, useMockFocus, type ChoiceOption } from "./ChoiceList";
import { MockPanel, useScreen } from "./Screen";
import { confirmAnswer, previewLive, PRESET_NAMES, PRESETS, questionsFor, setOnboardingDraft, skipStep, useOnboarding, type Preset, type QuestionId } from "../../state/onboarding/onboarding";
import { StepActions, StepLayout } from "./StepLayout";
import { CheckRow, OptionRow, Tag } from "./Parts";

export function Page({
  id,
  title,
  subtitle,
  tag,
  patch,
  picked,
  preview,
  onConfirm,
  children,
}: {
  id: QuestionId;
  title: string;
  subtitle: string;
  tag?: ReactNode;
  patch: Partial<Settings>;
  picked: string[];
  preview: ReactNode;
  onConfirm?: () => void;
  children: ReactNode;
}) {
  return (
    <StepLayout
      pageKey={id}
      title={title}
      subtitle={subtitle}
      tag={tag}
      actions={<StepActions onContinue={() => {
            onConfirm?.();
            confirmAnswer(id, patch, picked);
          }} onSkip={() => skipStep()} />}
      preview={preview}
    >
      {children}
    </StepLayout>
  );
}

export function useQuestion(step: "layout" | "tabs" | "look") {
  const sub = useOnboarding((s) => s.sub);
  useOnboarding((s) => s.draft);
  const id = questionsFor(step)[sub]?.id;
  return { id, focus: useMockFocus(id) };
}

export function change(patch: Partial<Settings>, live = false) {
  setOnboardingDraft(patch);
  if (live) previewLive(patch);
}

const LAYOUT_KEYS = ["tabLayout", "addressBar", "commandBarPlacement"] as const;

const TAB_CHOICES: ChoiceOption<Settings["tabLayout"]>[] = [
  { value: "sidebar", preview: "tabs-sidebar", title: "In the sidebar", subtitle: "A tall list down the side, as in Arc" },
  { value: "top", preview: "tabs-top", title: "Along the top", subtitle: "Classic tabs above the page" },
];
const ADDRESS_CHOICES: ChoiceOption<Settings["addressBar"]>[] = [
  { value: "toolbar", preview: "address-toolbar", title: "In the toolbar", subtitle: "Above the page, as in Dia" },
  { value: "sidebar", preview: "address-sidebar", title: "In the sidebar", subtitle: "On top of your tabs, as in Arc" },
];
const CMDL_CHOICES: ChoiceOption<Settings["commandBarPlacement"]>[] = [
  { value: "field", preview: "cmdl-field", title: "Under the address", subtitle: "Drops down from the field, as in Dia" },
  { value: "centred", preview: "cmdl-centred", title: "In the centre", subtitle: "Floats over the page, as in Arc" },
];

function styleOf(values: Pick<Settings, (typeof LAYOUT_KEYS)[number]>, preset: Preset) {
  const keys = values.tabLayout === "top" ? (["tabLayout", "commandBarPlacement"] as const) : LAYOUT_KEYS;
  const matches = (p: Preset) => keys.every((k) => values[k] === (PRESETS[p][k] ?? DEFAULT_SETTINGS[k]));
  const match = ([preset, "arc", "dia"] as const).find(matches);
  return match ? `${PRESET_NAMES[match]}-style` : "Your mix";
}

export function LayoutStep() {
  const { id, focus } = useQuestion("layout");
  const { values, mock } = useScreen(LAYOUT_KEYS);
  const preset = useOnboarding((s) => s.preset);
  useEffect(() => previewLive(values), []);
  const preview = <MockPanel settings={mock} focus={focus.focus} />;
  const tag = <Tag title={styleOf(values, preset)} />;
  const top = values.tabLayout === "top";

  if (id === "address")
    return (
      <Page
        id={id}
        title="Where's the address bar?"
        subtitle="Your window changes as you pick."
        tag={tag}
        patch={{ addressBar: values.addressBar }}
        picked={[values.addressBar === "sidebar" ? "Address in the sidebar" : "Address in the toolbar"]}
        preview={preview}
      >
        <ChoiceList options={ADDRESS_CHOICES} value={values.addressBar} onChange={(addressBar) => change({ addressBar }, true)} mock={focus} />
      </Page>
    );
  if (id === "cmdl")
    return (
      <Page
        id={id}
        title="Where does ⌘L open?"
        subtitle="The command bar, for going anywhere."
        tag={tag}
        patch={{ commandBarPlacement: values.commandBarPlacement }}
        picked={[values.commandBarPlacement === "centred" ? "⌘L opens in the centre" : "⌘L opens under the address"]}
        preview={preview}
      >
        <ChoiceList
          options={CMDL_CHOICES}
          value={values.commandBarPlacement}
          onChange={(commandBarPlacement) => change({ commandBarPlacement }, true)}
          mock={focus}
        />
      </Page>
    );
  return (
    <Page
      id="tabs"
      title="Where do your tabs go?"
      subtitle="Your window changes as you pick."
      tag={tag}
      patch={{ tabLayout: values.tabLayout }}
      picked={[top ? "Tabs along the top" : "Tabs in the sidebar"]}
      preview={preview}
    >
      <ChoiceList options={TAB_CHOICES} value={values.tabLayout} onChange={(tabLayout) => change({ tabLayout }, true)} mock={focus} />
    </Page>
  );
}

const TABS_KEYS = ["newTabOpens", "newTabPosition", "newTabButtonPosition", "cleanUpInactiveTabsAfterMinutes", "restoreSession", "shareTabsAcrossWindows"] as const;
const TABS_MORE = ["balancedTopApps", "peekModifier", "undoReopensClosedTab", "cmdClickCreatesTabGroup"] as const;

const NEW_TAB_CHOICES: ChoiceOption<Settings["newTabOpens"]>[] = [
  { value: "page", preview: "newtab-page", title: "The New Tab page", subtitle: "Your apps and a search box, as in Dia" },
  { value: "commandBar", preview: "newtab-commandbar", title: "The command bar", subtitle: "Start typing right away, as in Arc" },
];
const TIDY_CHOICES: ChoiceOption<"keep" | "tidy">[] = [
  { value: "keep", preview: "tidy-keep", title: "Keep them", subtitle: "Tabs stay until you close them" },
  { value: "tidy", preview: "tidy-auto", title: "Tidy them up", subtitle: "Close the ones you haven't used in a while" },
];
const QUIT_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "quit-restore", title: "Restore my tabs", subtitle: "Pick up where you left off" },
  { value: false, preview: "quit-fresh", title: "Start fresh", subtitle: "Open to a clean window" },
];
const WINDOW_CHOICES: ChoiceOption<boolean>[] = [
  { value: false, preview: "windows-separate", title: "Separate", subtitle: "Each window has its own tabs" },
  { value: true, preview: "windows-shared", title: "Shared", subtitle: "Every window shows the same tabs, as in Arc" },
];
const TIDY_AFTER = [
  { value: 12 * 60, title: "12 h" },
  { value: 24 * 60, title: "1 day" },
  { value: 7 * 24 * 60, title: "1 week" },
];
const PEEK_WITH: { value: PeekModifier; title: string }[] = [
  { value: "shift", title: "⇧-click" },
  { value: "alt", title: "⌥-click" },
  { value: "off", title: "Off" },
];

const tidyLabel = (minutes: number) => (minutes !== TIDY_AFTER[0]!.value && TIDY_AFTER.find((o) => o.value === minutes)?.title) || durationTitle(minutes);

export function TabsStep() {
  const { id, focus } = useQuestion("tabs");
  const { values, mock } = useScreen([...TABS_KEYS, ...TABS_MORE]);
  const top = mock.tabLayout === "top";
  const tidy = values.cleanUpInactiveTabsAfterMinutes;
  const preview = <MockPanel settings={mock} focus={focus.focus} />;

  if (id === "newTabPosition") {
    const options: ChoiceOption<Settings["newTabPosition"]>[] = [
      { value: "bottom", preview: "newtabpos-bottom", title: top ? "On the right" : "At the bottom", subtitle: top ? "After your other tabs, as in Dia" : "Under your other tabs, as in Dia" },
      { value: "top", preview: "newtabpos-top", title: top ? "On the left" : "At the top", subtitle: top ? "Before your other tabs, as in Arc" : "Above your other tabs, as in Arc" },
      { value: "nextToCurrent", preview: "newtabpos-next", title: top ? "Next to the current tab" : "Below the current tab", subtitle: top ? "Right after the tab you're on" : "Right under the tab you're on" },
    ];
    return (
      <Page
        id={id}
        title="Where do new tabs go?"
        subtitle="Where a tab lands when you open it."
        patch={{ newTabPosition: values.newTabPosition, newTabButtonPosition: values.newTabButtonPosition }}
        picked={[]}
        preview={preview}
      >
        <ChoiceList options={options} value={values.newTabPosition} onChange={(newTabPosition) => change({ newTabPosition, newTabButtonPosition: newTabPosition === "top" ? "top" : "bottom" })} mock={focus} />
      </Page>
    );
  }
  if (id === "tidy")
    return (
      <Page
        id={id}
        title="What about old tabs?"
        subtitle="Tabs you opened and forgot."
        patch={{ cleanUpInactiveTabsAfterMinutes: tidy }}
        picked={[tidy === null ? "Old tabs stay until you close them" : `Old tabs tidy up after ${tidyLabel(tidy)}`]}
        preview={preview}
      >
        <ChoiceList
          options={TIDY_CHOICES}
          value={tidy === null ? "keep" : "tidy"}
          onChange={(v) => change({ cleanUpInactiveTabsAfterMinutes: v === "keep" ? null : (tidy ?? TIDY_AFTER[0]!.value) })}
          mock={focus}
        />
        {tidy === null ? null : (
          <OptionRow
            title="Tidy after"
            value={tidy}
            options={TIDY_AFTER.some((o) => o.value === tidy) ? TIDY_AFTER : [...TIDY_AFTER, { value: tidy, title: tidyLabel(tidy) }]}
            onChange={(cleanUpInactiveTabsAfterMinutes) => change({ cleanUpInactiveTabsAfterMinutes })}
          />
        )}
      </Page>
    );
  if (id === "quit")
    return (
      <Page
        id={id}
        title="When you quit and come back?"
        subtitle="What Ardia opens to."
        patch={{ restoreSession: values.restoreSession }}
        picked={values.restoreSession ? [] : ["Ardia starts fresh each launch"]}
        preview={preview}
      >
        <ChoiceList options={QUIT_CHOICES} value={values.restoreSession} onChange={(restoreSession) => change({ restoreSession })} mock={focus} />
      </Page>
    );
  if (id === "windows")
    return (
      <Page
        id={id}
        title="Two windows, same tabs?"
        subtitle="How windows share what's open."
        patch={{ shareTabsAcrossWindows: values.shareTabsAcrossWindows }}
        picked={values.shareTabsAcrossWindows ? ["Windows share their tabs"] : []}
        preview={preview}
      >
        <ChoiceList
          options={WINDOW_CHOICES}
          value={values.shareTabsAcrossWindows}
          onChange={(shareTabsAcrossWindows) => change({ shareTabsAcrossWindows })}
          mock={focus}
        />
      </Page>
    );
  if (id === "tabsMore")
    return (
      <Page
        id={id}
        title="A few more tab habits"
        subtitle="Small things Arc and Dia do differently."
        patch={Object.fromEntries(TABS_MORE.map((k) => [k, values[k]]))}
        picked={[]}
        preview={preview}
      >
        <View style={{ gap: 8 }}>
          <CheckRow title="Top Apps grow with the sidebar" subtitle="Up to four across, as in Arc" value={values.balancedTopApps} onChange={(balancedTopApps) => change({ balancedTopApps })} />
          <OptionRow title="Peek a link with" value={values.peekModifier} options={PEEK_WITH} onChange={(peekModifier) => change({ peekModifier })} />
          <CheckRow title="⌘Z reopens closed tabs" subtitle="Outside text fields, as in Arc" value={values.undoReopensClosedTab} onChange={(undoReopensClosedTab) => change({ undoReopensClosedTab })} />
          <CheckRow
            title="⌘-click on a link makes a tab group"
            subtitle="Keeps related tabs together"
            value={values.cmdClickCreatesTabGroup}
            onChange={(cmdClickCreatesTabGroup) => change({ cmdClickCreatesTabGroup })}
          />
        </View>
      </Page>
    );
  return (
    <Page
      id="newTab"
      title="What does ⌘T open?"
      subtitle="What you see when you open a tab."
      patch={{ newTabOpens: values.newTabOpens }}
      picked={[values.newTabOpens === "commandBar" ? "⌘T opens the command bar" : "⌘T opens the New Tab page"]}
      preview={preview}
    >
      <ChoiceList options={NEW_TAB_CHOICES} value={values.newTabOpens} onChange={(newTabOpens) => change({ newTabOpens })} mock={focus} />
    </Page>
  );
}
