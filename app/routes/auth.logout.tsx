import { handleLogout } from "~/auth.server";
import type { Route } from "./+types/auth.logout";

// POST — form action from the sign-out button
export async function action({ request, context }: Route.ActionArgs) {
  return handleLogout(request, context.cloudflare.env);
}

// GET — direct navigation fallback
export async function loader({ request, context }: Route.LoaderArgs) {
  return handleLogout(request, context.cloudflare.env);
}
