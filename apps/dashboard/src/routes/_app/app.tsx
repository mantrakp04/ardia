import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/app")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/health", search });
  },
});
