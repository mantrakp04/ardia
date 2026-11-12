import { approveAutomationRule, removeAutomationRule, useAutomationRules, type AutomationRuleRow } from "../../../state/automation/approvalRows";
import { Button } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

function RuleRow({ rule, pending }: { rule: AutomationRuleRow; pending: boolean }) {
  return (
    <Row title={rule.name} description={rule.summary}>
      {pending ? <Button title="Approve" onPress={() => approveAutomationRule(rule)} /> : null}
      <Button variant="icon" icon="trash" size="m" onPress={() => removeAutomationRule(rule)} tooltip={pending ? "Remove" : "Revoke"} />
    </Row>
  );
}

export function AutomationRules() {
  const { pending, approved } = useAutomationRules();
  return (
    <>
      <SectionHeader anchor="advanced.automationRules" />
      <Group of="advanced.automationRules">
        {pending.length === 0 && approved.length === 0 ? <Row anchor="advanced.automationRules" description="Nothing is waiting for approval." /> : null}
        {pending.map((rule) => (
          <RuleRow key={rule.key} rule={rule} pending />
        ))}
        {approved.map((rule) => (
          <RuleRow key={rule.key} rule={rule} pending={false} />
        ))}
      </Group>
    </>
  );
}
