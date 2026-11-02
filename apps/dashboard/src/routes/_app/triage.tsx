import { Outlet, createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/blocks";
import { TriageTabs } from "@/components/triage/shared";

export const Route = createFileRoute("/_app/triage")({
  head: () => ({ meta: [{ title: "Triage · Ardia" }] }),
  component: TriageLayout,
});

function TriageLayout() {
  return (
    <>
      <PageHeader title="Triage" description="Feedback from X, Discord and GitHub: what people asked for, where it stands, and the replies still to send." />
      <TriageTabs />
      <Outlet />
    </>
  );
}
