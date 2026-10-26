import { Component, type ReactNode } from "react";
import { ScrollView, Text } from "react-native";
import { DEV_ERROR } from "./tokens";

export class DevErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    (globalThis as { __lastRenderError?: string }).__lastRenderError = `${error.message}\n${error.stack ?? ""}`;
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: DEV_ERROR.background, padding: 24 }}>
        <Text style={{ color: DEV_ERROR.text, fontSize: DEV_ERROR.fontSize, fontFamily: DEV_ERROR.fontFamily }}>
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </Text>
      </ScrollView>
    );
  }
}
