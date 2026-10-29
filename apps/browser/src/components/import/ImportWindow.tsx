import { useEffect, type ComponentType } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { space, useTheme, VisualEffect, WindowDragRegion } from "../ui";
import { ChooseBody, ChooseFooter } from "./steps/ChooseStep";
import { DoneBody, DoneFooter } from "./steps/DoneStep";
import { ProfilesBody, ProfilesFooter } from "./steps/ProfilesStep";
import { ProgressBody, ProgressFooter } from "./steps/ProgressStep";
import { AccessBody, AccessFooter, SafariBody, SafariFooter } from "./steps/SafariStep";
import { UnlockBody, UnlockFooter } from "./steps/UnlockStep";
import { startImport, useImportFlow, type ImportFlow, type ImportStepName } from "../../state/import/flow";
import { useImportDevHandle } from "./importDevHandle";
import { importColors, importLayout, importMotion } from "./tokens";

type StepView = ComponentType<{ flow: ImportFlow }>;

function Loading() {
  return <ActivityIndicator style={{ marginTop: importLayout.loadingTop }} />;
}

const STEPS: Record<ImportStepName, { Body: StepView; Footer: StepView | null }> = {
  loading: { Body: Loading, Footer: null },
  choose: { Body: ChooseBody, Footer: ChooseFooter },
  profiles: { Body: ProfilesBody, Footer: ProfilesFooter },
  unlock: { Body: UnlockBody, Footer: UnlockFooter },
  safari: { Body: SafariBody, Footer: SafariFooter },
  access: { Body: AccessBody, Footer: AccessFooter },
  progress: { Body: ProgressBody, Footer: ProgressFooter },
  done: { Body: DoneBody, Footer: DoneFooter },
};

export function ImportWindow() {
  const theme = useTheme();
  const flow = useImportFlow();
  useEffect(() => startImport(importMotion.doneDelay), []);
  useImportDevHandle(flow);
  const { Body, Footer } = STEPS[flow.step.name];
  return (
    <View style={{ flex: 1, backgroundColor: theme.dark ? importColors.windowFill.dark : importColors.windowFill.light }}>
      <VisualEffect material="windowBackground" blendingMode="behindWindow" style={StyleSheet.absoluteFill} />
      <WindowDragRegion style={{ position: "absolute", left: 0, right: 0, top: 0, height: importLayout.dragRegion }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: importLayout.padX, paddingTop: importLayout.padTop, paddingBottom: space.xxl }}>
        <Body flow={flow} />
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.m,
          paddingHorizontal: space.xxl,
          height: importLayout.footerHeight,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: theme.divider,
        }}
      >
        {Footer ? <Footer flow={flow} /> : null}
      </View>
    </View>
  );
}
