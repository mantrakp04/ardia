import { orWarn } from "../../../lib/fallback";
import { confirm } from "../../../state/app/system";
import { useSettings } from "../../../state/browser/hooks";
import { shortensHistory, type KeepHistory } from "../../../state/history/history";
import { keepHistoryFor } from "../../../state/history/retention";
import { PopUp } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

const PERIODS: { value: KeepHistory; title: string; alert: string }[] = [
  { value: "forever", title: "Forever", alert: "" },
  { value: "year", title: "1 year", alert: "1 Year" },
  { value: "threeMonths", title: "3 months", alert: "3 Months" },
  { value: "month", title: "1 month", alert: "1 Month" },
];

export function HistoryRetentionSection() {
  const keepHistory = useSettings((s) => s.keepHistory);

  const choose = async (next: KeepHistory) => {
    if (next === keepHistory) return;
    if (shortensHistory(keepHistory, next)) {
      const { confirmed } = await confirm({
        title: `Delete History Older Than ${PERIODS.find((p) => p.value === next)!.alert}?`,
        message: "Ardia deletes it from every profile on this Mac now, and again each day. Your other Macs keep theirs. You can't undo this.",
        confirmTitle: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
    }
    await keepHistoryFor(next).catch(orWarn([]));
  };

  return (
    <>
      <SectionHeader anchor="privacy.keepHistory" description={null} />
      <Group>
        <Row anchor="privacy.keepHistory">
          <PopUp value={keepHistory} options={PERIODS.map(({ value, title }) => ({ value, title }))} onChange={(v) => void choose(v)} minWidth={120} />
        </Row>
      </Group>
    </>
  );
}
