import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/users_/$id")({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: "/people/$id", params: { id: params.id }, search });
  },
});
