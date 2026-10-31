import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { endCreateSpaceRequest, requestCreateSpace, takeCreateSpaceSheet, useCreateSpaceRequest } from "./createSpaceRequest.ts";
import { useSettingsSheet } from "../settings/sheet.ts";

test("replacing a pending Create Space request settles the earlier caller", async () => {
  useCreateSpaceRequest.setState({ request: null, sheet: null });
  let earlier = "pending";
  requestCreateSpace().then((id) => { earlier = id; });
  const next = requestCreateSpace(undefined, { name: "Work" });
  await Promise.resolve();
  assert.equal(earlier, null);
  const request = takeCreateSpaceSheet();
  assert.equal(request.preset.name, "Work");
  assert.equal(useCreateSpaceRequest.getState().request, request);
  assert.equal(useCreateSpaceRequest.getState().sheet, null);
  endCreateSpaceRequest(request, "work");
  assert.equal(await next, "work");
  assert.equal(useCreateSpaceRequest.getState().request, null);
});

test("replacing a taken Create Space request settles it and ignores late completion", async () => {
  useCreateSpaceRequest.setState({ request: null, sheet: null });
  let earlier = "pending";
  requestCreateSpace().then((id) => { earlier = id; });
  const previous = takeCreateSpaceSheet();
  const next = requestCreateSpace();
  await Promise.resolve();
  assert.equal(earlier, null);
  const current = takeCreateSpaceSheet();
  endCreateSpaceRequest(previous, "stale");
  assert.equal(useCreateSpaceRequest.getState().request, current);
  endCreateSpaceRequest(current, null);
  assert.equal(await next, null);
  assert.equal(useCreateSpaceRequest.getState().request, null);
});

test("a replaced Create Space sheet cannot close or complete its replacement", async () => {
  const ui = "data:text/javascript,export const Box=null,Button=null,PROFILE_COLORS=null,PopUp=null,Sheet=null,space=null,Swatch=null,swatch=null,Text=null,TextField=null,useTheme=null;";
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/components/spaces/CreateSpace.tsx")) {
      if (specifier === "../ui") return { url: ui, shortCircuit: true };
      if (specifier === "react-native") return { url: "data:text/javascript,export const Pressable=null,View=null;", shortCircuit: true };
    }
    return next(specifier, context);
  } });
  try { await import("../../components/spaces/CreateSpace.tsx"); }
  finally { hooks.deregister(); }
  useCreateSpaceRequest.setState({ request: null, sheet: null });
  useSettingsSheet.setState({ sheet: null });
  let earlier = "pending";
  requestCreateSpace().then((id) => { earlier = id; });
  const previous = useSettingsSheet.getState().sheet;
  const next = requestCreateSpace();
  const current = useSettingsSheet.getState().sheet;
  await Promise.resolve();
  assert.equal(earlier, null);
  assert.notEqual(previous, current);
  previous.props.onDone("stale");
  assert.equal(useSettingsSheet.getState().sheet, current);
  current.props.onDone("created");
  assert.equal(await next, "created");
  assert.equal(useSettingsSheet.getState().sheet, null);
  assert.equal(useCreateSpaceRequest.getState().request, null);
});
