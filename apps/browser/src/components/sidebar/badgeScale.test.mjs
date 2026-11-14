import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
const boundary = 'data:text/javascript,export const useTheme=()=>({badgeFill:"gray",textTab:"black"});export const Text=()=>null;';
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith("/ui/Badge.tsx") && ["./theme", "./Text"].includes(specifier)) return { url: boundary, shortCircuit: true };
  return next(specifier, context);
} });
const { Badge } = await import("../ui/Badge.tsx");
const { sidebarScale } = await import("./scale.ts");

test("sidebar counts scale their frame and text together without changing other badges", () => {
  const baseline = Badge({ text: 12 });
  assert.deepEqual(Badge({ text: 12, scale: 1 }).props, baseline.props);
  assert.equal(baseline.props.style.height, 18);
  for (const percent of [80, 90, 100, 120]) {
    const m = sidebarScale(percent);
    const badge = Badge({ text: 12, scale: m.scale });
    assert.equal(badge.props.style.height, m.px(18));
    assert.equal(badge.props.children.props.style.fontSize, m.px(baseline.props.children.props.style.fontSize));
    assert.ok(badge.props.style.height < m.rowHeight);
  }
});
