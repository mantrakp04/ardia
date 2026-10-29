import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { PopUp } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

export function BookmarksBarSection() {
  const mode = useSettings((s) => s.bookmarksBar);
  const size = useSettings((s) => s.bookmarksBarSize);
  return (
    <>
      <SectionHeader title="Bookmarks Bar" />
      <Group>
        <Row anchor="appearance.bookmarksBar">
          <PopUp
            value={mode}
            options={[
              { value: "always", title: "Always" },
              { value: "newTab", title: "On New Tab Only" },
              { value: "never", title: "Never" },
            ]}
            onChange={(v) => updateSettings({ bookmarksBar: v })}
            minWidth={160}
          />
        </Row>
        <Row anchor="appearance.bookmarksBarSize">
          <PopUp
            value={size}
            options={[
              { value: "default", title: "Default" },
              { value: "large", title: "Large" },
            ]}
            onChange={(v) => updateSettings({ bookmarksBarSize: v })}
            minWidth={160}
          />
        </Row>
      </Group>
    </>
  );
}
