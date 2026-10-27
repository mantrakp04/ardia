import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/installs")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/users", search });
  },
});
