import { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, View } from "react-native";
import { Button, curve, radius, space, Symbol, Text, useTheme } from "../../ui";
import { KINDS, type Status } from "../model";
import { Spacer, Title } from "../Parts";
import { accentAlpha, importColors, importLayout, importMotion } from "../tokens";
import type { ImportFlow } from "../useImportFlow";

export function ProgressBody({ flow }: { flow: ImportFlow }) {
  const { status, source, preparing } = flow;
  return (
    <>
      <Title title={`Importing from ${source?.name ?? "file"}`} subtitle={preparing > 1 ? `Preparing ${preparing} profiles` : "Preparing your profile"} spinner />
      <Text size="small" tone="textSecondary" style={{ marginBottom: space.l }}>
        Hold on while we fetch your data...
      </Text>
      <View style={{ gap: space.s }}>
        {KINDS.filter((k) => status[k.kind]).map((k, i) => (
          <CategoryRow key={k.kind} title={k.title} icon={k.icon} status={status[k.kind]!} index={i} />
        ))}
      </View>
    </>
  );
}

export function ProgressFooter({ flow }: { flow: ImportFlow }) {
  return (
    <>
      <Spacer />
      <Button
        title="Cancel"
        onPress={() => {
          flow.abort.current?.abort();
          flow.close();
        }}
      />
    </>
  );
}

function CategoryRow({ title, icon, status, index }: { title: string; icon: string; status: Status; index: number }) {
  const theme = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const { rowAppear } = importMotion;
  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: rowAppear.duration, delay: index * rowAppear.stagger, easing: curve.outCubic, useNativeDriver: true }).start();
  }, []);
  useEffect(() => {
    if (status === "done" || status === "failed") Animated.spring(check, { toValue: 1, ...importMotion.check, useNativeDriver: true }).start();
  }, [status]);
  const active = status === "active";
  return (
    <Animated.View
      style={{
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [rowAppear.rise, 0] }) }],
        height: importLayout.categoryRow,
        borderRadius: radius.card,
        paddingHorizontal: space.l,
        flexDirection: "row",
        alignItems: "center",
        gap: space.l,
        backgroundColor: active ? `${theme.formAccent}${accentAlpha.active}` : theme.groupFill,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: active ? `${theme.formAccent}${accentAlpha.activeBorder}` : theme.groupBorder,
      }}
    >
      <Symbol name={icon} size={13} color={status === "pending" ? theme.textTertiary : theme.icon} style={{ width: 20, height: 20 }} />
      <Text tone={status === "pending" ? "textSecondary" : "textPrimary"} style={{ flex: 1 }}>
        {title}
      </Text>
      {active ? (
        <ActivityIndicator size="small" />
      ) : status === "pending" ? null : (
        <Animated.View style={{ transform: [{ scale: check }] }}>
          <Symbol
            name={status === "done" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
            size={15}
            color={status === "done" ? theme.success : theme.warning}
            style={{ width: 20, height: 20 }}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}
